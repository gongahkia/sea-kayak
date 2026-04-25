# ----- required imports -----

import calendar
import datetime
import json
import feedparser
import requests
from bs4 import BeautifulSoup

# ----- helper functions -----

DESC_MAX = 200  # chars


def _clean_desc(raw):
    if not raw:
        return ""
    # strip HTML and collapse whitespace
    text = BeautifulSoup(raw, "html.parser").get_text(" ", strip=True)
    if len(text) > DESC_MAX:
        text = text[: DESC_MAX - 1].rstrip() + "…"
    return text


def _published_iso(entry):
    p = entry.get("published_parsed") or entry.get("updated_parsed")
    if not p:
        return ""
    try:
        ts = calendar.timegm(p)  # feedparser yields struct_time in UTC
        return datetime.datetime.fromtimestamp(
            ts, tz=datetime.timezone.utc
        ).isoformat()
    except Exception:
        return ""


def scrape_rss_urls(rss_url):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    try:
        response = requests.get(rss_url, headers=headers, timeout=15)
        response.raise_for_status()

        feed = feedparser.parse(response.content)
        items = []
        for entry in feed.entries:
            if "link" in entry:
                items.append(
                    {
                        "url": entry.link,
                        "title": (entry.get("title") or "").strip(),
                        "description": _clean_desc(
                            entry.get("summary") or entry.get("description") or ""
                        ),
                        "published": _published_iso(entry),
                    }
                )
        return items
    except Exception:
        return []


def remove_duplicates(items):
    # dedupe by url, preserve first-seen order; tolerate legacy string entries
    seen = set()
    out = []
    for it in items:
        url = it["url"] if isinstance(it, dict) else it
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(it)
    return out


def flatten(nested_list):
    return [item for sublist in nested_list for item in sublist]


def write_urls_to_file(items, filename):
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=4, ensure_ascii=False)
