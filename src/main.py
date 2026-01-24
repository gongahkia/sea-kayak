# ----- required imports -----

# import local
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
    "https://blog.nus.edu.sg/lawresearch/feed/",
    "https://singaporeinternationalarbitration.wordpress.com/feed/",
    "https://lawgazette.com.sg/category/notices/disciplinary-tribunal-reports/feed/",
    "https://lawgazette.com.sg/feed/",
    "https://www.singaporelawwatch.sg/Results/rss/category/426/judgments-1",
    "https://www.singaporelawwatch.sg/Results/rss/category/426/notices-and-directions",
    "https://www.singaporelawwatch.sg/Results/rss/category/426/commentaries",
    "https://hungryhippo.huey.xyz/individual-site/academypublishing.org.sg/sal-practitioner/?area=Advocacy-and-Procedure",
    "https://hungryhippo.huey.xyz/individual-site/academypublishing.org.sg/sal-practitioner/?area=Construction-and-Infrastructure",
    "https://hungryhippo.huey.xyz/individual-site/academypublishing.org.sg/sal-practitioner/?area=Corporate",
    "https://hungryhippo.huey.xyz/individual-site/academypublishing.org.sg/sal-practitioner/?area=Crime",
    "https://hungryhippo.huey.xyz/individual-site/academypublishing.org.sg/sal-practitioner/?area=Employment-Law",
    "https://hungryhippo.huey.xyz/individual-site/academypublishing.org.sg/sal-practitioner/?area=Family-and-Personal-Law",
    "https://hungryhippo.huey.xyz/individual-site/academypublishing.org.sg/sal-practitioner/?area=Fintech",
    "https://hungryhippo.huey.xyz/individual-site/academypublishing.org.sg/sal-practitioner/?area=Insolvency-and-Restructuring",
    "https://hungryhippo.huey.xyz/individual-site/academypublishing.org.sg/sal-practitioner/?area=Transportation",
    "https://hungryhippo.huey.xyz/individual-site/academypublishing.org.sg/sal-journal",
    "https://www.lexology.com/email/rss.aspx?tagType=5&tagRef=155&tagTitle=%20Singapore&extrajr=&extrawr=",
    "https://hungryhippo.huey.xyz/individual-site/law.nus.edu.sg/trail",
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
        # + superfeed.remove_duplicates(
        #     superfeed.flatten(list(map(local.process_xml, LOCAL_RSS_ARRAY)))
        # )
    )
    superfeed.write_urls_to_file(urls, OUTPUT_FILENAME)
