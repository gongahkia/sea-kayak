# ----- required imports -----

import warnings
import requests
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from urllib.parse import urljoin

from superfeed import _extract_citation

# Suppress warning when parsing XML with HTML parser (intentional for mixed content)
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

# ----- helper functions -----


def extract_urls(url):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    try:
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()

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

        return items
    except Exception:
        return []
