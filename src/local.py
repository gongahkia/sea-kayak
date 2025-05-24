# ----- required imports -----

import os
import requests
from bs4 import BeautifulSoup

# ----- helper functions -----


def process_xml(url_list):
    all_urls = []
    for url in url_list:
        try:
            response = requests.get(url)
            response.raise_for_status()
            temp_file = f"temp_{url.split('//')[1].replace('/', '_')}.xml"
            with open(temp_file, "w", encoding="utf-8") as f:
                f.write(response.text)
            with open(temp_file, "r", encoding="utf-8") as f:
                soup = BeautifulSoup(f.read(), "xml")
                urls = (
                    [link.text for link in soup.find_all("link")]
                    + [guid.text for guid in soup.find_all("guid")]
                    + [loc.text for loc in soup.find_all("loc")]
                )
                unique_urls = list(set(filter(None, urls)))
                all_urls.extend(unique_urls)
            os.remove(temp_file)
        except Exception as e:
            print(f"Error processing {url}: {str(e)}")
            if os.path.exists(temp_file):
                os.remove(temp_file)
    return list(set(all_urls))
