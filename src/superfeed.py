# ----- required imports -----

import json
import feedparser
import requests

# ----- helper functions -----


def scrape_rss_urls(rss_url):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    try:
        # Use requests to get the content first to apply headers and timeout
        response = requests.get(rss_url, headers=headers, timeout=15)
        response.raise_for_status()
        
        feed = feedparser.parse(response.content)
        urls = []
        for entry in feed.entries:
            if "link" in entry:
                urls.append(entry.link)
        return urls
    except Exception:
        # Return empty list on failure
        return []


def remove_duplicates(lst):
    return list(set(lst))


def flatten(nested_list):
    return [item for sublist in nested_list for item in sublist]


def write_urls_to_file(urls, filename):
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(urls, f, indent=4)
