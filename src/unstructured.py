# ----- required imports -----

import warnings
import requests
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from urllib.parse import urljoin

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
        urls = []
        
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            # Join relative URLs with base URL
            absolute_url = urljoin(url, href)
            # Basic validation to ensure it's a web link
            if absolute_url.startswith(("http://", "https://")):
                urls.append(absolute_url)
                
        return list(set(urls))
    except Exception:
        # Return empty list on failure to avoid breaking flattening logic
        return []
