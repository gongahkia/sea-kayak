# orchestration file

# ----- required imports -----

import superfeed
import unstructured

# ----- execution code -----

OUTPUT_FILENAME = './../data/routes.json'
RSS_URL_ARRAY = [
    'https://www.singaporelawwatch.sg/Portals/0/RSS/SuperFeed.xml',
    'https://www.singaporelawwatch.sg/Portals/0/RSS/Judgments.xml',
    'https://www.singaporelawwatch.sg/Portals/0/RSS/Commentaries.xml',
    'https://www.singaporelawwatch.sg/Portals/0/RSS/Notices.xml',
    'https://www.singaporelawwatch.sg/Portals/0/RSS/Headlines.xml'
]


if __name__ == "__main__":
    urls = superfeed.remove_duplicates(superfeed.flatten(list(map(superfeed.scrape_rss_urls, RSS_URL_ARRAY))))
    superfeed.write_urls_to_file(urls, OUTPUT_FILENAME)