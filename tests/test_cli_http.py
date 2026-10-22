"""Real CLI subprocesses and owned HTTP; no mocked scraper/network calls."""
import http.server
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import superfeed
import unstructured


class Handler(http.server.BaseHTTPRequestHandler):
    phase = 1

    def log_message(self, *args):
        pass

    def do_GET(self):
        base = f"http://127.0.0.1:{self.server.server_port}"
        if self.phase == 3 or self.phase == 2 and self.path == "/b.xml":
            self.send_response(404)
            self.end_headers()
            return
        if self.path == "/html":
            body = '<html><nav><a href="/privacy">Privacy</a></nav><main><article><a href="/news/a#section">A news</a><a href="/event">Legal event</a></article><form><a href="/private-account">Private account link</a></form></main><footer><a href="/contact">Contact</a></footer></html>'
            content_type = "text/html; charset=utf-8"
        else:
            name = "b" if self.path == "/b.xml" else "a"
            link = (
                "../news/relative"
                if self.path == "/deep/relative.xml"
                else base + "/news/" + name
            )
            body = f'<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Synthetic legal news</title><link>{base}</link><description>Owned fixture</description><item><title>{name}-{self.phase}</title><link>{link}</link><description><![CDATA[<p>新加坡法律消息。</p><script>synthetic-script-secret</script>]]></description><pubDate>Thu, 22 Oct 2026 00:15:00 +0800</pubDate></item></channel></rss>'
            content_type = "application/rss+xml; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body.encode())))
        self.end_headers()
        self.wfile.write(body.encode())


class CLIWithHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        Handler.phase = 1

    def run_cli(self, directory):
        config = directory / "feeds.json"
        config.write_text(
            json.dumps(
                {
                    "rss": [self.base + "/a.xml", self.base + "/b.xml"],
                    "html": [self.base + "/html"],
                }
            )
        )
        work = directory / "unrelated-cwd"
        work.mkdir(exist_ok=True)
        return subprocess.run(
            [
                sys.executable,
                str(ROOT / "src/main.py"),
                "--data-dir",
                str(directory / "data"),
                "--feeds-json",
                str(config),
                "--timeout",
                "1",
            ],
            cwd=work,
            text=True,
            capture_output=True,
            timeout=20,
        )

    def test_html_excludes_navigation_footer_and_private_form_links(self):
        items = unstructured.extract_urls(self.base + "/html")
        self.assertEqual(
            {item["url"] for item in items},
            {self.base + "/news/a#section", self.base + "/event"},
        )

    def test_relative_feed_links_and_singapore_publication_offset_survive(self):
        item = superfeed.scrape_rss_urls(self.base + "/deep/relative.xml")[0]
        self.assertEqual(item["url"], self.base + "/news/relative")
        self.assertEqual(item["description"], "新加坡法律消息。")
        self.assertEqual(item["published"], "2026-10-21T16:15:00+00:00")

    def test_separate_cli_runs_preserve_failed_feed_news_and_global_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            first = self.run_cli(directory)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            news = json.loads((directory / "data/routes.json").read_text())
            self.assertEqual(
                {item["url"] for item in news},
                {self.base + "/news/a", self.base + "/news/b", self.base + "/event"},
            )
            self.assertEqual(len(news), 3)
            Handler.phase = 2
            second = self.run_cli(directory)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            news = json.loads((directory / "data/routes.json").read_text())
            self.assertEqual(
                next(item for item in news if item["url"].endswith("/a"))["title"],
                "a-2",
            )
            self.assertEqual(
                next(item for item in news if item["url"].endswith("/b"))["title"],
                "b-1",
            )
            summary = json.loads(
                (directory / "data/scrape_metadata/run_summary.json").read_text()
            )
            self.assertEqual(summary["status"], "partial")
            self.assertEqual(summary["retained_feeds"], [self.base + "/b.xml"])
            original = (directory / "data/routes.json").read_bytes()
            Handler.phase = 3
            failed = self.run_cli(directory)
            self.assertEqual(failed.returncode, 1, failed.stdout + failed.stderr)
            self.assertEqual((directory / "data/routes.json").read_bytes(), original)
