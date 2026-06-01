# ----- required imports -----

import json
import os
import sys

# import local
import drift
import superfeed
import unstructured

# ----- variable initialization -----

OUTPUT_FILENAME = "./../data/routes.json"
METADATA_DIR = "./../data/scrape_metadata"
RUN_SUMMARY_PATH = os.path.join(METADATA_DIR, "run_summary.json")
PREV_SNAPSHOT_PATH = os.path.join(METADATA_DIR, "fingerprints.prev.json")
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

def _emit_gh_annotations(drift_summary, outcomes_summary):
    # GitHub Actions workflow commands; harmless if run outside CI
    for d in drift_summary.get("drift", []):
        print(f"::warning title=Feed drift::{d['url']} - {len(d['diffs'])} structural change(s)")
    for s in drift_summary.get("silent", []):
        print(f"::warning title=Silent feed::{s['url']} silent for {s['age_days']}d")
    for f in drift_summary.get("floor", []):
        print(
            f"::warning title=Entry-count drop::{f['url']} {f['current']} vs avg {f['rolling_avg']}"
        )
    for url in outcomes_summary.get("retried_fail", []):
        print(f"::warning title=Feed retry exhausted::{url}")
    for url in outcomes_summary.get("terminal", []):
        print(f"::warning title=Feed terminal failure::{url}")


if __name__ == "__main__":
    os.makedirs(METADATA_DIR, exist_ok=True)
    # snapshot pre-run fingerprints so drift.finalize() can diff
    drift.snapshot_previous(PREV_SNAPSHOT_PATH)

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

    # finalize sidecar artifacts (drift report + run summary)
    drift_summary = drift.finalize(prev_state_path=PREV_SNAPSHOT_PATH)
    outcomes = superfeed.OUTCOMES.summary()
    run_summary = {
        "items_written": len(urls),
        "feeds": outcomes,
        "drift": {
            "checked_count": drift_summary["checked_count"],
            "drift_count": len(drift_summary["drift"]),
            "silent_count": len(drift_summary["silent"]),
            "floor_count": len(drift_summary["floor"]),
        },
    }
    with open(RUN_SUMMARY_PATH, "w", encoding="utf-8") as f:
        json.dump(run_summary, f, indent=2, ensure_ascii=False)
    if os.path.exists(PREV_SNAPSHOT_PATH):
        os.remove(PREV_SNAPSHOT_PATH)  # transient diff artifact, not committed

    _emit_gh_annotations(drift_summary, outcomes)

    # console summary for local runs
    print(
        f"feeds: {len(outcomes['first_try'])} first-try, "
        f"{len(outcomes['retried_ok'])} retried-ok, "
        f"{len(outcomes['retried_fail'])} retried-fail, "
        f"{len(outcomes['terminal'])} terminal; "
        f"drift: {len(drift_summary['drift'])}, "
        f"silent: {len(drift_summary['silent'])}, "
        f"floor: {len(drift_summary['floor'])}"
    )
