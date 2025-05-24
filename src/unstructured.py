# ----- required imports -----

import re

# ----- helper functions -----

def extract_urls_from_file(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        file_content = f.read()
    url_pattern = r'https?://[^\s\"\'>]+'
    raw_urls = re.findall(url_pattern, file_content)
    cleaned_urls = []
    for url in raw_urls:
        url = re.sub(r'[\)\]\}\.,;:!]+$', '', url)
        url = re.sub(r'(Fri|Kenneth|Tue|GMT|document|CPD points|public|TBC|newsletter|bed6df78-[\w-]+)$', '', url)
        cleaned_urls.append(url)
    return cleaned_urls

