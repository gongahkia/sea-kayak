# orchestration file

# ----- required imports -----

import superfeed

# ----- execution code -----

OUTPUT_FILENAME = './../data/routes.json'

if __name__ == "__main__":
    rss_url = 'https://www.singaporelawwatch.sg/Portals/0/RSS/SuperFeed.xml'
    urls = superfeed.scrape_rss_urls(rss_url)
    superfeed.write_urls_to_file(urls, OUTPUT_FILENAME)