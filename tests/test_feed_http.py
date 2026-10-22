"""Actual owned HTTP transport, including drip bodies and compressed size limits."""
import gzip
import http.server
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from feed_http import fetch_public_feed, MAX_FEED_BYTES
from retry import RetryableError, TerminalError
import requests
import superfeed

BODY = b'<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><link>https://example.test</link><description>Legal news</description><item><title>Synthetic news</title><link>https://example.test/news</link></item></channel></rss>'


class Handler(http.server.BaseHTTPRequestHandler):
    counts = {}

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.counts[self.path] = self.counts.get(self.path, 0) + 1
        try:
            if self.path == "/headers":
                time.sleep(1)
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/deep/feed.xml")
                self.end_headers()
                return
            if self.path == "/credentials":
                self.send_response(302)
                self.send_header(
                    "Location",
                    f"http://user:secret@127.0.0.1:{self.server.server_port}/must-not-fetch",
                )
                self.end_headers()
                return
            status = int(self.path[7:]) if self.path.startswith("/status") else 200
            self.send_response(status)
            self.send_header("Content-Type", "application/rss+xml; charset=utf-8")
            if self.path == "/body":
                self.send_header("Content-Length", "999999")
                self.end_headers()
                while True:
                    self.wfile.write(b"x")
                    self.wfile.flush()
                    time.sleep(0.04)
            payload = BODY
            if self.path == "/large":
                payload = b"x" * (MAX_FEED_BYTES + 1)
            if self.path in (
                "/gzip",
                "/gzip-large",
                "/gzip-truncated",
                "/gzip-members",
            ):
                self.send_header("Content-Encoding", "gzip")
                payload = gzip.compress(
                    b"x" * (MAX_FEED_BYTES + 1) if self.path == "/gzip-large" else BODY
                )
                if self.path == "/gzip-truncated":
                    payload = payload[:-5]
                if self.path == "/gzip-members":
                    payload = gzip.compress(BODY[:50]) + gzip.compress(BODY[50:])
            if self.path != "/stream-large":
                self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.path == "/stream-large":
                for _ in range(MAX_FEED_BYTES // 65536 + 1):
                    self.wfile.write(b"x" * 65536)
            else:
                self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass


class FeedHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_plain_gzip_and_multiple_members_preserve_exact_original_bytes(self):
        for path in ("/plain", "/gzip", "/gzip-members"):
            with self.subTest(path=path):
                self.assertEqual(fetch_public_feed(self.base + path).content, BODY)

    def test_redirect_preserves_the_final_document_location(self):
        self.assertEqual(
            fetch_public_feed(self.base + "/redirect").url, self.base + "/deep/feed.xml"
        )

    def test_credentials_in_a_redirect_are_rejected_before_the_next_request(self):
        with self.assertRaises(TerminalError):
            fetch_public_feed(self.base + "/credentials")
        self.assertEqual(Handler.counts.get("/must-not-fetch", 0), 0)

    def test_header_and_continuous_body_deadlines_are_absolute(self):
        for path in ("/headers", "/body"):
            with self.subTest(path=path):
                start = time.monotonic()
                with self.assertRaises(requests.Timeout):
                    fetch_public_feed(self.base + path, timeout_seconds=0.2)
                self.assertLess(time.monotonic() - start, 1)

    def test_declared_streamed_and_decompressed_body_limits(self):
        for path in ("/large", "/stream-large", "/gzip-large"):
            with self.subTest(path=path), self.assertRaises(TerminalError):
                fetch_public_feed(self.base + path)

    def test_truncated_gzip_never_becomes_a_successful_partial_document(self):
        with self.assertRaises(RetryableError):
            fetch_public_feed(self.base + "/gzip-truncated")

    def test_native_http_statuses_use_bounded_retry_classification(self):
        # Only backoff sleeping is mocked; requests and server responses are real.
        for status, attempts in ((404, 1), (500, 3), (429, 3)):
            path = f"/status{status}"
            with self.subTest(status=status), patch("retry.time.sleep"):
                self.assertEqual(superfeed.scrape_rss_urls(self.base + path), [])
                self.assertEqual(Handler.counts[path], attempts)
