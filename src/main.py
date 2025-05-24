# ----- required imports -----

import local
import superfeed
import unstructured

# ----- variable initialization -----

OUTPUT_FILENAME = "./../data/routes.json"
RSS_URL_ARRAY = [
    "https://www.singaporelawwatch.sg/Portals/0/RSS/SuperFeed.xml",
    "https://www.singaporelawwatch.sg/Portals/0/RSS/Judgments.xml",
    "https://www.singaporelawwatch.sg/Portals/0/RSS/Commentaries.xml",
    "https://www.singaporelawwatch.sg/Portals/0/RSS/Notices.xml",
    "https://www.singaporelawwatch.sg/Portals/0/RSS/Headlines.xml",
    "https://www.mlaw.gov.sg/feed.xml",
]
UNSTRUCT_URL_ARRAY = [
    "https://www.singaporelawwatch.sg/Results/rss/category/426/continuing-legal-education"
]
LOCAL_RSS_ARRAY = [
    "https://www.lawgazette.com.sg/feed",
    "https://www.singaporeinternationalarbitration.com/feed",
]

# ----- execution code -----

if __name__ == "__main__":
    urls = (
        superfeed.remove_duplicates(
            superfeed.flatten(list(map(superfeed.scrape_rss_urls, RSS_URL_ARRAY)))
        )
        + superfeed.remove_duplicates(
            superfeed.flatten(list(map(unstructured.extract_urls, UNSTRUCT_URL_ARRAY)))
        )
        + superfeed.remove_duplicates(
            superfeed.flatten(list(map(local.process_xml, LOCAL_RSS_ARRAY)))
        )
    )
    superfeed.write_urls_to_file(urls, OUTPUT_FILENAME)
