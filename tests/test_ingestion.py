"""Independent synthetic boundary cases; no third-party HTTP or data writes."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import superfeed


class IngestionBoundaries(unittest.TestCase):
    def setUp(self):
        superfeed.OUTCOMES.records.clear()

    def test_non_latin_legal_description_is_preserved(self):
        self.assertEqual(
            superfeed._clean_desc("<p>新加坡法院裁定：保障个人资料。</p>"), "新加坡法院裁定：保障个人资料。"
        )

    def test_malformed_entries_cannot_abort_deduplication(self):
        valid = {"url": "https://example.test/article", "title": "Synthetic legal news"}
        self.assertEqual(
            superfeed.remove_duplicates([None, {}, {"url": []}, valid, valid]), [valid]
        )

    def test_fragment_variants_identify_one_news_document(self):
        first = {"url": "https://example.test/article#first", "title": "Original"}
        second = {"url": "https://example.test/article#second", "title": "Duplicate"}
        self.assertEqual(superfeed.remove_duplicates([first, second]), [first])

    def test_a_corrupt_duplicate_cannot_hide_a_later_valid_news_record(self):
        valid = {
            "url": "https://example.test/news",
            "title": "Valid news",
            "description": "",
            "published": "",
            "citation": "",
        }
        self.assertEqual(
            superfeed.normalize_items([{**valid, "title": {}}, valid]), [valid]
        )

    def test_html_error_page_is_not_a_successful_feed(self):
        class Response:
            content = b"<!doctype html><html><body><h1>Temporary maintenance</h1></body></html>"
            headers = {"Content-Type": "text/html"}

        with patch.object(
            superfeed, "fetch_feed_bytes", return_value=Response()
        ), patch("drift.record_fetch"):
            self.assertEqual(superfeed.scrape_rss_urls("https://example.test/feed"), [])
        self.assertNotEqual(
            superfeed.OUTCOMES.records["https://example.test/feed"]["status"],
            "first_try",
        )

    def test_keyboard_interrupt_stops_ingestion(self):
        with patch.object(superfeed, "fetch_feed_bytes", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                superfeed.scrape_rss_urls("https://example.test/feed")


if __name__ == "__main__":
    unittest.main()
