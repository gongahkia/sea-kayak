"""Targeted parsers for official legal publication and decision listings."""

import datetime
import json
import re
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from retry import RetryableError
from superfeed import _extract_citation, _url_identity, remove_duplicates


def _date(value):
    if not isinstance(value, str):
        raise RetryableError("Legal listing has a missing or invalid publication date")
    for pattern in ("%d %b %Y", "%d %B %Y"):
        try:
            date = datetime.datetime.strptime(value.strip(), pattern)
            return (
                date.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
                .astimezone(datetime.timezone.utc)
                .isoformat()
            )
        except ValueError:
            pass
    raise RetryableError("Legal listing has a missing or invalid publication date")


def _text(node):
    return " ".join(node.get_text(" ", strip=True).split()) if node else ""


def _item(base_url, href, title, published, citation=""):
    if not isinstance(href, str) or not isinstance(title, str) or not title.strip():
        return None
    url = urljoin(base_url, href)
    if (
        _url_identity(url) is None
        or urlsplit(url).hostname != urlsplit(base_url).hostname
    ):
        return None
    return {
        "url": url,
        "title": title.strip(),
        "description": "",
        "published": _date(published),
        "citation": citation or _extract_citation(url, title),
    }


def _judgments(soup, base_url):
    items = []
    for card in soup.select(".gd-card-body"):
        link = card.select_one('a[href^="/gd/s/"]')
        date = _text(card.select_one(".decision-date-link"))
        match = re.search(r"Decision Date:\s*(\d{1,2} \w+ \d{4})", date)
        if link and match:
            items.append(
                _item(
                    base_url,
                    link["href"],
                    _text(link),
                    match[1],
                    citation=_extract_citation(
                        _text(card.select_one(".citation-num-link"))
                    ),
                )
            )
    return items


def _sal(soup, base_url):
    items = []
    for card in soup.select(".artListItem"):
        link = card.select_one('a[href$="/Citation/JournalsOnlinePDF"]')
        if not link:
            continue
        paragraphs = card.select(":scope > p")
        items.append(
            _item(
                base_url,
                link["href"].replace("http://", "https://", 1),
                _text(card.select_one("p b")),
                _text(card.select_one(".eFirstListHead")),
                citation=_text(paragraphs[-1]) if paragraphs else "",
            )
        )
    return items


def _ccs(soup, base_url):
    items = []
    path = urlsplit(base_url).path.rstrip("/") + "/"
    for link in soup.select("a[href]:has(h2)"):
        target = urlsplit(urljoin(base_url, link["href"]))
        if not target.path.startswith(path) or target.path == path:
            continue
        date = link.find("p")
        items.append(_item(base_url, link["href"], _text(link.find("h2")), _text(date)))
    return items


def _pdpc(body, base_url):
    try:
        data = json.loads(body)
    except (ValueError, UnicodeError) as error:
        raise RetryableError("PDPC did not return its decision listing") from error
    if not isinstance(data, dict) or not isinstance(data.get("data"), list):
        raise RetryableError("PDPC decision listing has an unexpected schema")
    if len(data["data"]) > 5000:
        raise RetryableError("PDPC decision listing exceeds the entry-count limit")
    items = []
    for record in data["data"]:
        if not isinstance(record, dict):
            continue
        href = record.get("href")
        if not isinstance(href, str) or _url_identity(urljoin(base_url, href)) is None:
            continue
        item = _item(
            base_url,
            href,
            record.get("title"),
            record.get("date", ""),
        )
        if item and urlsplit(item["url"]).path.startswith(
            "/organisations/regulations-decisions/enforcement-decisions/"
        ):
            items.append(item)
    return items


def parse_source(response, original_url):
    """Return None for generic HTML; recognised sources must yield usable records."""
    parts = urlsplit(original_url)
    host = (parts.hostname or "").removeprefix("www.")
    if host == "pdpc.gov.sg" and parts.path == "/api/listing-api":
        items = _pdpc(response.content, original_url)
    else:
        if host == "elitigation.sg" and parts.path.rstrip("/") == "/gd":
            parser = _judgments
        elif host == "journalsonline.academypublishing.org.sg":
            parser = _sal
        elif host == "ccs.gov.sg" and parts.path.startswith(
            "/case-register/public-register/"
        ):
            parser = _ccs
        else:
            return None
        soup = BeautifulSoup(response.content, "html.parser")
        items = parser(soup, original_url)
    items = remove_duplicates([item for item in items if item is not None])
    if not items:
        raise RetryableError("Legal listing contains no usable articles or decisions")
    if len(items) > 5000:
        raise RetryableError("Legal listing exceeds the entry-count limit")
    return items
