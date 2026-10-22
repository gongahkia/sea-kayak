# ----- required imports -----

import json
import os
import sys
import argparse
import datetime
from pathlib import Path
from persistence import atomic_json, ingestion_lock, read_json

# import local
import drift
import superfeed
import unstructured
import feed_http

# ----- variable initialization -----

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
OUTPUT_FILENAME = str(DEFAULT_DATA_DIR / "routes.json")
METADATA_DIR = str(DEFAULT_DATA_DIR / "scrape_metadata")
RUN_SUMMARY_PATH = os.path.join(METADATA_DIR, "run_summary.json")
PREV_SNAPSHOT_PATH = os.path.join(METADATA_DIR, "fingerprints.prev.json")
RSS_URL_ARRAY = [
    "https://www.singaporelawwatch.sg/Portals/0/RSS/SuperFeed.xml",
    "https://www.singaporelawwatch.sg/Portals/0/RSS/Judgments.xml",
    "https://www.singaporelawwatch.sg/Portals/0/RSS/Commentaries.xml",
    "https://www.singaporelawwatch.sg/Portals/0/RSS/Notices.xml",
    "https://www.singaporelawwatch.sg/Portals/0/RSS/Headlines.xml",
    "https://www.mlaw.gov.sg/feed.xml",
    "https://sso.agc.gov.sg/RSS/NewLegislation.aspx",
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
        print(
            f"::warning title=Feed drift::{d['url']} - {len(d['diffs'])} structural change(s)"
        )
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


def run_ingestion(data_dir, rss_urls, html_urls, timeout_seconds=15):
    data_dir = Path(data_dir).resolve()
    metadata = data_dir / "scrape_metadata"
    configured = [(url, superfeed.scrape_rss_urls) for url in rss_urls] + [
        (url, unstructured.extract_urls) for url in html_urls
    ]
    if not configured or any(
        superfeed._url_identity(url) is None for url, _ in configured
    ):
        raise ValueError("Configure 1 to 100 valid HTTP(S) feed URLs")
    configured = list(
        {
            superfeed._url_identity(url): (url, scraper) for url, scraper in configured
        }.values()
    )
    if len(configured) > 100:
        raise ValueError("Configure 1 to 100 valid HTTP(S) feed URLs")
    if not 0 < timeout_seconds <= 60:
        raise ValueError("Timeout must be between zero and 60 seconds")
    with ingestion_lock(data_dir):
        feed_http.DEFAULT_TIMEOUT_SECONDS = timeout_seconds
        metadata.mkdir(parents=True, exist_ok=True)
        drift.configure(metadata)
        superfeed.OUTCOMES.records.clear()
        previous = superfeed.normalize_items(read_json(data_dir / "routes.json", []))
        state = read_json(metadata / "feed_items.json", {})
        raw_feeds = state.get("feeds", {}) if isinstance(state, dict) else {}
        if not isinstance(raw_feeds, dict):
            raw_feeds = {}
        feeds = {}
        for url, _ in configured:
            record = raw_feeds.get(url)
            if isinstance(record, dict) and isinstance(record.get("items"), list):
                feeds[url] = {
                    "items": superfeed.normalize_items(record["items"]),
                    "last_success_utc": record.get("last_success_utc")
                    if isinstance(record.get("last_success_utc"), str)
                    else "",
                }
        legacy = superfeed.normalize_items(
            state.get("legacy", [])
            if isinstance(state, dict) and state.get("version") == 1
            else previous
        )
        # A missing/corrupt feed cache cannot attribute the public snapshot.
        # Keep that snapshot until every configured feed has recovered its cache.
        if not all(url in feeds for url, _ in configured):
            legacy = superfeed.normalize_items(legacy + previous)
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        successful = 0
        for url, scraper in configured:
            try:
                items = superfeed.normalize_items(scraper(url))
            except Exception as error:
                superfeed.OUTCOMES.record_result(
                    url, "terminal", 1, type(error).__name__
                )
                items = []
            outcome = superfeed.OUTCOMES.records.get(url, {})
            if outcome.get("status") in ("first_try", "retried_ok"):
                successful += 1
                # Empty successful feeds do not discard the most recent known news.
                if items or url not in feeds:
                    feeds[url] = {"items": items, "last_success_utc": now}
        if all(url in feeds for url, _ in configured):
            legacy = []
        candidate = superfeed.normalize_items(
            [
                item
                for url, _ in configured
                for item in feeds.get(url, {}).get("items", [])
            ]
            + legacy
        )
        if not candidate:
            candidate = previous
        outcomes = superfeed.OUTCOMES.summary()
        prev_path = metadata / "fingerprints.prev.json"
        drift.snapshot_previous(prev_path)
        try:
            drift_summary = drift.finalize(prev_state_path=prev_path)
            status = (
                "failed"
                if not successful or not candidate
                else "complete"
                if successful == len(configured)
                else "partial"
            )
            changed = bool(successful and candidate and candidate != previous)
            summary = {
                "attempted_at_utc": now,
                "status": "prepared" if changed else status,
                "published": False,
                "items_written": len(previous),
                "candidate_items": len(candidate),
                "feeds": outcomes,
                "retained_feeds": [
                    url
                    for url, _ in configured
                    if outcomes.get("details", {}).get(url, {}).get("status")
                    not in ("first_try", "retried_ok")
                    and url in feeds
                ],
                "drift": {
                    "checked_count": drift_summary["checked_count"],
                    "drift_count": len(drift_summary["drift"]),
                    "silent_count": len(drift_summary["silent"]),
                    "floor_count": len(drift_summary["floor"]),
                },
            }
            # Complete the sidecars before replacing the public news file.
            atomic_json(
                metadata / "feed_items.json",
                {"version": 1, "feeds": feeds, "legacy": legacy},
            )
            atomic_json(metadata / "run_summary.json", summary)
            if changed:
                atomic_json(data_dir / "routes.json", candidate)
                summary.update(
                    status=status, published=True, items_written=len(candidate)
                )
                atomic_json(metadata / "run_summary.json", summary)
            _emit_gh_annotations(drift_summary, outcomes)
            print(
                f"ingestion: {status}; {len(candidate)} news items; {successful}/{len(configured)} valid feeds"
            )
            return 1 if status == "failed" else 0
        finally:
            if prev_path.exists():
                prev_path.unlink()


def main():
    parser = argparse.ArgumentParser(
        description="Collate legal news without discarding last-good feed data"
    )
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument(
        "--feeds-json",
        type=Path,
        help="JSON object containing rss/html URL arrays; use owned loopback URLs for tests",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15,
        help="Total seconds per feed attempt, including headers and body",
    )
    args = parser.parse_args()
    # Legacy local-parser URLs are not enabled; one returns HTTP404 in the live smoke.
    rss, html = RSS_URL_ARRAY, UNSTRUCT_URL_ARRAY
    if args.feeds_json:
        config = read_json(args.feeds_json, None)
        if not isinstance(config, dict) or any(
            not isinstance(config.get(key, []), list) for key in ("rss", "html")
        ):
            parser.error("Feed configuration must contain rss/html URL arrays")
        rss, html = config.get("rss", []), config.get("html", [])
    try:
        return run_ingestion(args.data_dir, rss, html, args.timeout)
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Ingestion failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
