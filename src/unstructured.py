# ----- required imports -----

import warnings
import requests
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from urllib.parse import urljoin

from superfeed import _extract_citation, OUTCOMES
from retry import retry, classify_exception, TerminalError, RetryableError

# Suppress warning when parsing XML with HTML parser (intentional for mixed content)
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

# ----- helper functions -----


def extract_urls(url):
    attempts = {"n": 0}

    def _on_retry(exc, attempt, delay):
        OUTCOMES.record_attempt(url, attempt, exc, delay)

    @retry(max_attempts=3, base_delay=1.0, max_delay=30.0, on_retry=_on_retry)
    def _fetch():
        attempts["n"] += 1
        r = requests.get(url, headers=_HEADERS, timeout=15)
        r.raise_for_status()
        if not r.content or len(r.content) < 32:
            raise RetryableError(f"empty/short body from {url}")
        return r

    try:
        response = _fetch()
        try:
            from drift import record_fetch

            record_fetch(url, response.content, response.headers.get("Content-Type", ""))
        except Exception:
            pass
        soup = BeautifulSoup(response.content, "html.parser")
        items = []
        seen = set()

        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            absolute_url = urljoin(url, href)
            if not absolute_url.startswith(("http://", "https://")):
                continue
            if absolute_url in seen:
                continue
            seen.add(absolute_url)
            # use anchor text as a best-effort title; description left empty
            title = (a_tag.get_text() or "").strip()
            items.append(
                {
                    "url": absolute_url,
                    "title": title,
                    "description": "",
                    "published": "",
                    "citation": _extract_citation(absolute_url, title),
                }
            )

        n = attempts["n"]
        OUTCOMES.record_result(url, "retried_ok" if n > 1 else "first_try", n)
        return items
    except BaseException as e:
        cls = classify_exception(e)
        status = "terminal" if cls is TerminalError else "retried_fail"
        OUTCOMES.record_result(url, status, attempts["n"], error=f"{type(e).__name__}: {e}")
        return []  # preserve original contract
