# ----- required imports -----

import os
import requests
from yarl import URL
from bs4 import BeautifulSoup

# ----- helper functions -----


def process_xml(url_list):
    all_urls = []
    if isinstance(url_list, str):
        url_list = [url_list]
    for url in url_list:
        temp_file = None
        try:
            if not URL(url).is_absolute():
                print(f"Skipping invalid URL: {url}")
                continue
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            domain = URL(url).host.replace(".", "_")
            temp_file = f"temp_{domain}.xml"
            with open(temp_file, "w", encoding="utf-8") as f:
                f.write(response.text)
            with open(temp_file, "r", encoding="utf-8") as f:
                soup = BeautifulSoup(f.read(), "xml")
                urls = [link.text for link in soup.find_all("link")]
                all_urls.extend(urls)
        except Exception as e:
            print(f"Error processing {url}: {type(e).__name__} - {str(e)}")
        finally:
            if temp_file and os.path.exists(temp_file):
                os.remove(temp_file)
    return list(set(all_urls))
