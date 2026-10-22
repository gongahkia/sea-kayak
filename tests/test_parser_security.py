"""Feed body bytes are data, including when they spell a valid local filename."""
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from superfeed import parse_feed_response
from retry import RetryableError


class ParserBoundary(unittest.TestCase):
    def test_a_downloaded_filename_cannot_open_a_local_feed(self):
        with tempfile.TemporaryDirectory() as tmp:
            secret = Path(tmp) / "synthetic-private-news.xml"
            secret.write_text(
                '<rss version="2.0"><channel><title>Private</title><item><title>synthetic-private-sentinel</title><link>https://example.test/private</link></item></channel></rss>'
            )
            response = SimpleNamespace(
                content=str(secret).encode(),
                headers={"Content-Type": "application/rss+xml"},
                url="https://example.test/feed",
            )
            with self.assertRaises(RetryableError):
                parse_feed_response(response, response.url)
