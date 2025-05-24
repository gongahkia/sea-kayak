# ----- required imports -----

import json
import feedparser

# ----- helper functions -----

def scrape_rss_urls(rss_url):
    feed = feedparser.parse(rss_url)
    urls = []
    for entry in feed.entries:
        if 'link' in entry:
            urls.append(entry.link)
    return urls

def remove_duplicates(lst):
    return list(set(lst))

def flatten(nested_list):
    return [item for sublist in nested_list for item in sublist]

def write_urls_to_file(urls, filename):
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(urls, f, indent=4)