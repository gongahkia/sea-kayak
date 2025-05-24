# ----- required imports -----

import re
import requests

# ----- helper functions -----


def extract_urls(url):
    try:
        response = requests.get(url)
        response.raise_for_status()
        content = response.text
        url_pattern = r'https?://[\w\-\.\~:/\?#\[\]@!\$&"\'\(\)\*\+,;=%]+'
        urls = re.findall(url_pattern, content)
        cleaned_urls = [u.rstrip('"\',;:!') for u in urls]
        unique_urls = list(set(cleaned_urls))
        return unique_urls
    except Exception as e:
        return str(e)