# ----- required imports -----

import warnings
import requests
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from urllib.parse import urljoin

from superfeed import (
    _extract_citation,
    OUTCOMES,
    _url_identity,
    remove_duplicates,
    parse_feed_response,
)
from feed_http import fetch_public_feed
from retry import retry, classify_exception, TerminalError, RetryableError

# Suppress warning when parsing XML with HTML parser (intentional for mixed content)
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

# ----- helper functions -----


def parse_document(response, original_url):
    body = response.content.lstrip()
    if body.startswith((b"<?xml", b"<rss", b"<feed")):
        return parse_feed_response(response, original_url)
    soup = BeautifulSoup(response.content, "html.parser")
    root = soup.select_one("main, article, [role=main]") or soup.body or soup
    for node in root.select(
        "nav,header,footer,aside,form,script,style,noscript,template,[hidden],[aria-hidden=true],[role=navigation],.nav,.sidebar,.footer,.header"
    ):
        node.decompose()
    items = []
    for anchor in root.select("a[href]"):
        url = urljoin(getattr(response, "url", None) or original_url, anchor["href"])
        title = " ".join(anchor.get_text().split())
        if _url_identity(url) is None or not title:
            continue
        items.append(
            {
                "url": url,
                "title": title,
                "description": "",
                "published": "",
                "citation": _extract_citation(url, title),
            }
        )
    if len(items) > 5000:
        raise TerminalError("HTML feed exceeds the entry-count limit")
    return remove_duplicates(items)


def extract_urls(url):
    attempts = {"n": 0}

    def _on_retry(exc, attempt, delay):
        OUTCOMES.record_attempt(url, attempt, exc, delay)

    @retry(max_attempts=3, base_delay=1.0, max_delay=30.0, on_retry=_on_retry)
    def _fetch():
        attempts["n"] += 1
        r = fetch_public_feed(url, _HEADERS)
        r.raise_for_status()
        if not r.content or len(r.content) < 32:
            raise RetryableError(f"empty/short body from {url}")
        return r, parse_document(r, url)

    try:
        response, items = _fetch()
        try:
            from drift import record_fetch

            record_fetch(
                url, response.content, response.headers.get("Content-Type", "")
            )
        except Exception:
            pass
        n = attempts["n"]
        OUTCOMES.record_result(url, "retried_ok" if n > 1 else "first_try", n)
        return items
    except Exception as e:
        cls = classify_exception(e)
        status = "terminal" if cls is TerminalError else "retried_fail"
        OUTCOMES.record_result(
            url, status, attempts["n"], error=f"{type(e).__name__}: {e}"
        )
        return []  # preserve original contract
