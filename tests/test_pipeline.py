"""Orchestration regressions: real script/file writes, explicitly mocked feed calls."""
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import drift
import superfeed
import unstructured

A = "https://www.singaporelawwatch.sg/Portals/0/RSS/SuperFeed.xml"
B = "https://www.singaporelawwatch.sg/Portals/0/RSS/Judgments.xml"
H = "https://www.singaporelawwatch.sg/Results/rss/category/426/continuing-legal-education"


def article(name):
    return {
        "url": f"https://example.test/news/{name}",
        "title": name,
        "description": "Synthetic legal news",
        "published": "2026-10-22T00:00:00+00:00",
        "citation": "",
    }


class PipelineIntegrity(unittest.TestCase):
    def run_script(self, data, answers, corrupt_metadata=False):
        metadata = data / "scrape_metadata"
        metadata.mkdir(exist_ok=True)
        if corrupt_metadata:
            (metadata / "fingerprints.json").write_text('{"feeds": []}')
        config = data.parent / "feeds.json"
        config.write_text(json.dumps({"rss": [A, B], "html": [H]}))
        work = data.parent / "src"
        work.mkdir(exist_ok=True)

        def fetch(url):
            items = answers.get(url, answers.get("*"))
            superfeed.OUTCOMES.record_result(
                url, "first_try" if items is not None else "terminal", 1
            )
            return items or []

        previous_cwd = Path.cwd()
        try:
            os.chdir(work)
            with patch.object(
                sys,
                "argv",
                [
                    str(ROOT / "src/main.py"),
                    "--data-dir",
                    str(data),
                    "--feeds-json",
                    str(config),
                ],
            ), patch.object(
                superfeed, "scrape_rss_urls", side_effect=fetch
            ), patch.object(
                unstructured, "extract_urls", side_effect=fetch
            ), patch.multiple(
                drift,
                FINGERPRINT_PATH=str(metadata / "fingerprints.json"),
                DRIFT_REPORT_PATH=str(metadata / "drift_report.md"),
                _state={"feeds": {}},
                _loaded=False,
            ), contextlib.redirect_stdout(
                io.StringIO()
            ):
                try:
                    runpy.run_path(str(ROOT / "src/main.py"), run_name="__main__")
                    return 0
                except SystemExit as error:
                    return error.code
        finally:
            os.chdir(previous_cwd)

    def test_total_failure_keeps_the_previous_snapshot_and_reports_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            data.mkdir()
            original = json.dumps([article("previous")]).encode()
            (data / "routes.json").write_bytes(original)
            code = self.run_script(data, {})
            self.assertEqual((data / "routes.json").read_bytes(), original)
            self.assertNotEqual(code, 0)

    def test_deduplication_spans_structured_and_html_feeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            data.mkdir()
            code = self.run_script(data, {"*": [article("same")]})
            self.assertEqual(code, 0)
            self.assertEqual(
                json.loads((data / "routes.json").read_text()), [article("same")]
            )

    def test_partial_failure_keeps_known_news_for_the_failed_feed(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            data.mkdir()
            self.run_script(
                data, {A: [article("a-before")], B: [article("b-before")], H: []}
            )
            self.run_script(data, {A: [article("a-after")], H: []})
            links = {
                item["url"] for item in json.loads((data / "routes.json").read_text())
            }
            self.assertIn(article("a-after")["url"], links)
            self.assertIn(article("b-before")["url"], links)

    def test_corrupt_drift_state_cannot_break_usable_news(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            data.mkdir()
            code = self.run_script(
                data, {"*": [article("valid")]}, corrupt_metadata=True
            )
            self.assertEqual(code, 0)
            self.assertEqual(
                json.loads((data / "routes.json").read_text()), [article("valid")]
            )

    def test_corrupt_feed_cache_preserves_previous_news_until_every_feed_recovers(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            data.mkdir()
            self.run_script(
                data, {A: [article("a-before")], B: [article("b-before")], H: []}
            )
            cache = data / "scrape_metadata/feed_items.json"
            cache.write_text('{"version": 1, "feeds": [], "legacy": []}')
            self.assertEqual(self.run_script(data, {A: [article("a-after")], H: []}), 0)
            links = {
                item["url"] for item in json.loads((data / "routes.json").read_text())
            }
            self.assertIn(article("a-after")["url"], links)
            self.assertIn(article("b-before")["url"], links)
            self.assertEqual(
                self.run_script(
                    data,
                    {A: [article("a-recovered")], B: [article("b-recovered")], H: []},
                ),
                0,
            )
            self.assertEqual(
                {
                    item["url"]
                    for item in json.loads((data / "routes.json").read_text())
                },
                {article("a-recovered")["url"], article("b-recovered")["url"]},
            )

    def test_failed_news_publication_never_reports_success_or_erases_previous_bytes(
        self,
    ):
        import persistence

        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            data.mkdir()
            original = json.dumps([article("previous")]).encode()
            (data / "routes.json").write_bytes(original)
            replace = persistence.os.replace

            def fail_publication(source, target):
                if Path(target).resolve() == (data / "routes.json").resolve():
                    raise OSError("synthetic publication failure")
                return replace(source, target)

            with patch("persistence.os.replace", side_effect=fail_publication):
                self.assertEqual(self.run_script(data, {"*": [article("new")]}), 1)
            self.assertEqual((data / "routes.json").read_bytes(), original)
            summary = json.loads(
                (data / "scrape_metadata/run_summary.json").read_text()
            )
            self.assertFalse(summary["published"])
            self.assertNotEqual(summary["status"], "complete")
