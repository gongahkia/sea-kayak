"""Publication metadata and failure boundaries for official source adapters."""

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import main
import superfeed
import unstructured
from retry import RetryableError


def response(body, url, content_type="text/html; charset=utf-8"):
    result = requests.Response()
    result.status_code = 200
    result.url = url
    result.headers["Content-Type"] = content_type
    result._content = body.encode("utf-8")
    return result


class FeedRepairs(unittest.TestCase):
    def test_valid_utf8_feed_survives_an_ascii_http_encoding_default(self):
        body = """<?xml version="1.0"?><rss version="2.0"><channel>
        <title>Legal news</title><link>https://example.test/</link><description>News</description>
        <item><title>法院 — Judgment</title><link>https://example.test/2026 SGHC 226.pdf</link>
        <pubDate>Fri, 30 Oct 2026 00:00:00 +0800</pubDate></item></channel></rss>"""
        result = superfeed.parse_feed_response(
            response(body, "https://example.test/feed", "text/xml"),
            "https://example.test/feed",
        )
        self.assertEqual(result[0]["title"], "法院 — Judgment")
        self.assertEqual(result[0]["url"], "https://example.test/2026%20SGHC%20226.pdf")
        self.assertEqual(result[0]["published"], "2026-10-29T16:00:00+00:00")

    def test_malformed_utf8_xml_is_still_rejected(self):
        body = '<rss version="2.0"><channel><title>法院</title><item><title>Broken</title></rss>'
        with self.assertRaises(RetryableError):
            superfeed.parse_feed_response(
                response(body, "https://example.test/feed", "text/xml"),
                "https://example.test/feed",
            )

    def test_encoding_warning_does_not_hide_malformed_xml(self):
        parsed = {
            "bozo": True,
            "bozo_exception": superfeed.feedparser.CharacterEncodingOverride("UTF-8"),
            "version": "rss20",
            "entries": [],
        }
        with patch.object(superfeed.feedparser, "parse", return_value=parsed):
            with self.assertRaises(RetryableError):
                superfeed.parse_feed_response(
                    response("<rss><channel>", "https://example.test/feed"),
                    "https://example.test/feed",
                )

    def test_unsafe_rss_hosts_and_protocols_are_not_repaired_into_links(self):
        body = """<rss version="2.0"><channel><title>News</title>
        <item><title>Invalid host</title><link>https://bad host.test/news</link></item>
        <item><title>Script</title><link>javascript:alert(1)</link></item>
        </channel></rss>"""
        self.assertEqual(
            superfeed.parse_feed_response(
                response(body, "https://example.test/feed", "application/rss+xml"),
                "https://example.test/feed",
            ),
            [],
        )

    def test_default_configuration_keeps_smu_and_uses_repaired_sources(self):
        self.assertIn("https://smulexicon.com/feed/", main.RSS_URL_ARRAY)
        self.assertIn(
            "https://sso.agc.gov.sg/What's-New/New-Legislation/RSS", main.RSS_URL_ARRAY
        )
        self.assertNotIn(
            "https://www.singaporelawwatch.sg/Portals/0/RSS/Notices.xml",
            main.RSS_URL_ARRAY,
        )
        self.assertFalse(
            any(
                "hungryhippo" in url and "academypublishing" in url
                for url in main.RSS_URL_ARRAY
            )
        )


class LegalListings(unittest.TestCase):
    def test_judgment_cards_keep_case_metadata_and_exclude_search_links(self):
        url = "https://www.elitigation.sg/gd"
        body = """<a href="/gd/Home/Index">Search</a><div class="gd-card-body">
        <a href="/gd/s/2026_SGYC_8">Public Prosecutor v YLT</a>
        <a class="citation-num-link" href="#">[2026] SGYC 8 |</a>
        <a class="decision-date-link" href="#">Decision Date: 29 Oct 2026 |</a>
        </div>"""
        items = unstructured.parse_document(response(body, url), url)
        self.assertEqual(
            items,
            [
                {
                    "url": "https://www.elitigation.sg/gd/s/2026_SGYC_8",
                    "title": "Public Prosecutor v YLT",
                    "description": "",
                    "published": "2026-10-28T16:00:00+00:00",
                    "citation": "[2026] SGYC 8",
                }
            ],
        )

    def test_sal_lists_one_pdf_per_article_with_title_date_and_citation(self):
        url = "https://journalsonline.academypublishing.org.sg/Journals/SAL-Practitioner/Crime"
        prefix = "http://journalsonline.academypublishing.org.sg/Journals/SAL-Practitioner/Crime/ctl/eFirstSALPDFJournalView/mid/1/ArticleId/2/Citation/"
        body = f"""<nav><a href="/privacy">Privacy</a></nav><div class="artListItem">
        <h4 class="eFirstListHead">3 August 2026</h4>
        <p><b>Sentencing <i>principles</i></b></p><p class="small">An Author</p>
        <p>[2026] SAL Prac 22</p><ul class="downloadLinks">
        <a href="{prefix}JournalsOnlinePDF">Text (PDF)</a>
        <a href="{prefix}HtmlDocument">Text (HTML)</a><a href="/abstract">View Abstract</a>
        </ul></div>"""
        items = unstructured.parse_document(response(body, url), url)
        self.assertEqual(len(items), 1)
        self.assertEqual(
            items[0]["url"], prefix.replace("http:", "https:") + "JournalsOnlinePDF"
        )
        self.assertEqual(items[0]["title"], "Sentencing principles")
        self.assertEqual(items[0]["citation"], "[2026] SAL Prac 22")
        self.assertEqual(items[0]["published"], "2026-08-02T16:00:00+00:00")

    def test_ccs_uses_dated_case_cards_and_excludes_other_categories(self):
        url = "https://www.ccs.gov.sg/case-register/public-register/mergers-and-acquisitions/"
        body = f"""<a href="{url}"><h2>All mergers</h2></a>
        <a href="{url}proposed-acquisition/"><p>9 October 2026</p>
        <div><p>9 October 2026</p><h2>Proposed Acquisition</h2></div></a>
        <a href="/case-register/public-register/market-studies/study/"><h2>Other</h2></a>
        <a href="https://evil.test{urlsplit(url).path}fake/"><p>9 October 2026</p><h2>Fake</h2></a>"""
        items = unstructured.parse_document(response(body, url), url)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["title"], "Proposed Acquisition")
        self.assertEqual(items[0]["published"], "2026-10-08T16:00:00+00:00")

    def test_pdpc_public_api_keeps_decisions_and_undertakings_only(self):
        url = next(url for url in main.UNSTRUCT_URL_ARRAY if "pdpc.gov.sg" in url)
        data = {
            "totalItems": 2,
            "data": [
                {
                    "href": "/organisations/regulations-decisions/enforcement-decisions/case",
                    "title": "Breach of Protection",
                    "date": "26 Oct 2026",
                },
                {
                    "href": "https://evil.test/organisations/regulations-decisions/enforcement-decisions/fake",
                    "title": "Fake",
                    "date": "26 Oct 2026",
                },
                {"href": "/privacy", "title": "Privacy", "date": "26 Oct 2026"},
                None,
            ],
        }
        items = unstructured.parse_document(response(json.dumps(data), url), url)
        self.assertEqual(len(items), 1)
        self.assertEqual(
            items[0]["url"],
            "https://www.pdpc.gov.sg/organisations/regulations-decisions/enforcement-decisions/case",
        )
        self.assertEqual(items[0]["published"], "2026-10-25T16:00:00+00:00")

    def test_loading_pages_and_changed_schemas_are_not_successful_listings(self):
        for url, body in [
            ("https://www.elitigation.sg/gd", '<nav><a href="/help">Help</a></nav>'),
            (
                "https://www.ccs.gov.sg/case-register/public-register/mergers-and-acquisitions/",
                "<h1>Maintenance</h1>",
            ),
            ("https://www.pdpc.gov.sg/api/listing-api", '{"data": []}'),
            ("https://www.pdpc.gov.sg/api/listing-api", '{"results": []}'),
            ("https://www.pdpc.gov.sg/api/listing-api", "<html>Loading</html>"),
        ]:
            with self.subTest(url=url, body=body), self.assertRaises(RetryableError):
                unstructured.parse_document(response(body, url), url)

    def test_pdpc_loading_page_retains_last_good_decisions_in_the_pipeline(self):
        url = next(url for url in main.UNSTRUCT_URL_ARRAY if "pdpc.gov.sg" in url)
        data = {
            "data": [
                {
                    "href": "/organisations/regulations-decisions/enforcement-decisions/case",
                    "title": "Breach of Protection",
                    "date": "26 Oct 2026",
                }
            ]
        }
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / "routes.json"
            with patch.object(
                unstructured,
                "fetch_public_feed",
                return_value=response(json.dumps(data), url),
            ):
                self.assertEqual(main.run_ingestion(directory, [], [url]), 0)
            previous = snapshot.read_bytes()
            loading = response(
                "<html><body>Loading enforcement decisions...</body></html>", url
            )
            with patch.object(
                unstructured, "fetch_public_feed", return_value=loading
            ), patch("retry.time.sleep"):
                self.assertEqual(main.run_ingestion(directory, [], [url]), 1)
            self.assertEqual(snapshot.read_bytes(), previous)
