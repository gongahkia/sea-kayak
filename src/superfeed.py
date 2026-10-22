# ----- required imports -----

import calendar
import io
import datetime
import json
import re
import feedparser
import requests
from bs4 import BeautifulSoup
from urllib.parse import unquote, urlsplit, urljoin

from retry import retry, FeedOutcomes, classify_exception, TerminalError, RetryableError
from feed_http import fetch_public_feed

# module-level outcome tracker; main.py reads this after the run
OUTCOMES = FeedOutcomes()

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

# ----- helper functions -----

DESC_MAX = 200  # chars

# matches SG court neutral citations: [YYYY] SGCA/SGHC/SGHCR/SGFC/SGDC/SGMC,
# with optional bracketed division suffix like (A), (I), (Appeal), and trailing number
_CITATION_RE = re.compile(
    r"\[(?:19|20)\d{2}\]\s+SG(?:CA|HC|HCR|FC|DC|MC|HCF)(?:\s*\([A-Za-z]+\))?\s+\d+",
)


def _extract_citation(*texts):
    for t in texts:
        if not t:
            continue
        m = _CITATION_RE.search(unquote(t))
        if m:
            # collapse internal whitespace
            return re.sub(r"\s+", " ", m.group(0)).strip()
    return ""


def _clean_desc(raw):
    if not raw:
        return ""
    # strip HTML and collapse whitespace
    text = BeautifulSoup(raw, "html.parser").get_text(" ", strip=True)
    # treat purely-ellipsis/punctuation placeholders as empty
    if not any(char.isalnum() for char in text):
        return ""
    if len(text) > DESC_MAX:
        text = text[: DESC_MAX - 1].rstrip() + "…"
    return text


def _published_iso(entry):
    p = entry.get("published_parsed") or entry.get("updated_parsed")
    if not p:
        return ""
    try:
        ts = calendar.timegm(p)  # feedparser yields struct_time in UTC
        return datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).isoformat()
    except Exception:
        return ""


def fetch_feed_bytes(rss_url, **limits):
    response = fetch_public_feed(rss_url, _HEADERS, **limits)
    if not response.content or len(response.content) < 32:
        raise RetryableError("Feed response is empty or incomplete")
    return response


def parse_feed_response(response, base_url):
    final_url = getattr(response, "url", None) or base_url
    headers = {key.lower(): value for key, value in response.headers.items()}
    headers["content-location"] = final_url
    feed = feedparser.parse(io.BytesIO(response.content), response_headers=headers)
    if feed.get("bozo") or not feed.get("version"):
        raise RetryableError("Response is not a complete RSS or Atom document")
    if len(feed.entries) > 5000:
        raise TerminalError("Feed exceeds the entry-count limit")
    items = []
    for entry in feed.entries:
        link = entry.get("link")
        if not isinstance(link, str):
            continue
        link = urljoin(final_url, link)
        if _url_identity(link) is None:
            continue
        title = entry.get("title") or ""
        raw_desc = entry.get("summary") or entry.get("description") or ""
        if not isinstance(title, str) or not isinstance(raw_desc, str):
            continue
        title, desc = title.strip(), _clean_desc(raw_desc)
        items.append(
            {
                "url": link,
                "title": title,
                "description": desc,
                "published": _published_iso(entry),
                "citation": _extract_citation(link, title, desc),
            }
        )
    return items


def scrape_rss_urls(rss_url):
    attempts = {"n": 0}

    def _on_retry(exc, attempt, delay):
        OUTCOMES.record_attempt(rss_url, attempt, exc, delay)

    @retry(max_attempts=3, base_delay=1.0, max_delay=30.0, on_retry=_on_retry)
    def _fetch():
        attempts["n"] += 1
        response = fetch_feed_bytes(rss_url)
        return response, parse_feed_response(response, rss_url)

    try:
        response, items = _fetch()
        n = attempts["n"]
        # publish raw bytes so drift monitor can fingerprint w/o a second fetch
        try:
            from drift import record_fetch  # lazy import: drift is optional

            record_fetch(
                rss_url, response.content, response.headers.get("Content-Type", "")
            )
        except Exception:
            pass  # drift monitoring must never break scraping
        OUTCOMES.record_result(rss_url, "retried_ok" if n > 1 else "first_try", n)
        return items
    except Exception as e:
        cls = classify_exception(e)
        status = "terminal" if cls is TerminalError else "retried_fail"
        OUTCOMES.record_result(
            rss_url, status, attempts["n"], error=f"{type(e).__name__}: {e}"
        )
        return []  # preserve original contract: failure -> empty list


def _url_identity(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or any(
        char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value
    ):
        return None
    try:
        parts = urlsplit(value)
        if (
            parts.scheme not in ("http", "https")
            or not parts.hostname
            or parts.username
            or parts.password
        ):
            return None
        _ = parts.port  # reject invalid port spellings
        return parts._replace(
            netloc=parts.netloc.lower(), path=parts.path or "/", fragment=""
        ).geturl()
    except ValueError:
        return None


def remove_duplicates(items):
    # Fragments identify sections of one news document; keep its first original link.
    seen = set()
    out = []
    for item in items:
        url = item.get("url") if isinstance(item, dict) else item
        identity = _url_identity(url)
        if identity is None or identity in seen:
            continue
        seen.add(identity)
        out.append(item)
    return out


def normalize_items(items):
    if not isinstance(items, list):
        return []
    normalized = []
    for item in items:
        raw = {"url": item} if isinstance(item, str) else item
        if not isinstance(raw, dict) or _url_identity(raw.get("url")) is None:
            continue
        fields = ("title", "description", "published", "citation")
        if any(
            raw.get(key) is not None and not isinstance(raw.get(key), str)
            for key in fields
        ):
            continue
        normalized.append(
            {"url": raw["url"].strip(), **{key: raw.get(key) or "" for key in fields}}
        )
    return remove_duplicates(normalized)


def flatten(nested_list):
    return [item for sublist in nested_list for item in sublist]


def write_urls_to_file(items, filename):
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=4, ensure_ascii=False)
