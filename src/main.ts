import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { atomicJson, ingestionLock, readJson } from "./persistence.ts";
import { normalizeItems, urlIdentity } from "./items.ts";
import { DriftMonitor } from "./drift.ts";
import type { DriftSummary } from "./drift.ts";
import { scrapeFeed } from "./scraper.ts";
import { FeedOutcomes } from "./retry.ts";
import type { RetryOptions } from "./retry.ts";
import { isRecord, utcIso } from "./types.ts";
import type { NewsItem } from "./types.ts";
import { RSS_URL_ARRAY, UNSTRUCT_URL_ARRAY } from "./config.ts";

export const DEFAULT_DATA_DIR = fileURLToPath(new URL("../data", import.meta.url));
const success = (status?: string) => status === "first_try" || status === "retried_ok";
interface FeedCache { items: NewsItem[]; last_success_utc: string }
export interface IngestionOptions { timeoutSeconds?: number; concurrency?: number; retry?: RetryOptions }

function annotations(drift: DriftSummary, outcomes: ReturnType<FeedOutcomes["summary"]>): void {
  const escape = (value: string) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  for (const finding of drift.drift) console.log(`::warning title=Feed drift::${escape(finding.url)} - ${finding.diffs.length} structural change(s)`);
  for (const finding of drift.silent) console.log(`::warning title=Silent feed::${escape(finding.url)} silent for ${finding.age_days}d`);
  for (const finding of drift.floor) console.log(`::warning title=Entry-count drop::${escape(finding.url)} ${finding.current} vs avg ${finding.rolling_avg}`);
  for (const url of outcomes.retried_fail) console.log(`::warning title=Feed retry exhausted::${escape(url)}`);
  for (const url of outcomes.terminal) console.log(`::warning title=Feed terminal failure::${escape(url)}`);
}

export async function runIngestion(directory: string, rssUrls: unknown[], htmlUrls: unknown[], options: IngestionOptions = {}): Promise<number> {
  const dataDir = resolve(directory), metadata = join(dataDir, "scrape_metadata");
  const { timeoutSeconds = 15, concurrency = 4 } = options;
  const feedsByIdentity = new Map<string, { url: string; kind: "rss" | "html" }>();
  for (const [urls, kind] of [[rssUrls, "rss"], [htmlUrls, "html"]] as const) {
    for (const url of urls) {
      const identity = urlIdentity(url);
      if (!identity) throw new Error("Configure 1 to 100 valid HTTP(S) feed URLs");
      feedsByIdentity.set(identity, { url: url as string, kind });
    }
  }
  const configured = [...feedsByIdentity.values()];
  if (!configured.length || configured.length > 100) throw new Error("Configure 1 to 100 valid HTTP(S) feed URLs");
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 60) throw new Error("Timeout must be between zero and 60 seconds");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("Concurrency must be between 1 and 16");
  const release = await ingestionLock(dataDir);
  try {
    const drift = await DriftMonitor.load(metadata), outcomes = new FeedOutcomes();
    const previous = normalizeItems(await readJson(join(dataDir, "routes.json"), []));
    const state = await readJson(join(metadata, "feed_items.json"), {});
    const rawFeeds = isRecord(state) && isRecord(state.feeds) ? state.feeds : {};
    const feeds: Record<string, FeedCache> = Object.create(null);
    for (const { url } of configured) {
      const record = rawFeeds[url];
      if (isRecord(record) && Array.isArray(record.items)) feeds[url] = {
        items: normalizeItems(record.items), last_success_utc: typeof record.last_success_utc === "string" ? record.last_success_utc : "",
      };
    }
    let legacy = normalizeItems(isRecord(state) && state.version === 1 ? state.legacy : previous);
    if (!configured.every(({ url }) => url in feeds)) legacy = normalizeItems([...legacy, ...previous]);
    const now = utcIso();
    // Workers overlap network waits; index-based results retain configured source priority.
    const results: NewsItem[][] = new Array(configured.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, configured.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= configured.length) break;
        const { url, kind } = configured[index];
        results[index] = normalizeItems(await scrapeFeed(url, kind, outcomes, { timeoutSeconds, drift, retry: options.retry }));
      }
    }));
    let successful = 0;
    for (const [index, { url }] of configured.entries()) {
      if (success(outcomes.records[url]?.status)) {
        successful++;
        if (results[index].length || !(url in feeds)) feeds[url] = { items: results[index], last_success_utc: now };
      }
    }
    if (configured.every(({ url }) => url in feeds)) legacy = [];
    let candidate = normalizeItems([...configured.flatMap(({ url }) => feeds[url]?.items ?? []), ...legacy]);
    if (!candidate.length) candidate = previous;
    // Stable reports as well as stable public data, independent of response order.
    const summaryOutcomes = new FeedOutcomes();
    for (const { url } of configured) summaryOutcomes.records[url] = outcomes.records[url];
    const report = summaryOutcomes.summary(), driftSummary = await drift.finalize();
    const status = !successful || !candidate.length ? "failed" : successful === configured.length ? "complete" : "partial";
    const changed = Boolean(successful && candidate.length && JSON.stringify(candidate) !== JSON.stringify(previous));
    const summary = {
      attempted_at_utc: now, status: changed ? "prepared" : status, published: false,
      items_written: previous.length, candidate_items: candidate.length, feeds: report,
      retained_feeds: configured.filter(({ url }) => !success(outcomes.records[url]?.status) && url in feeds).map(({ url }) => url),
      drift: { checked_count: driftSummary.checked_count, drift_count: driftSummary.drift.length, silent_count: driftSummary.silent.length, floor_count: driftSummary.floor.length },
    };
    // Prepare all sidecars before atomically replacing the public snapshot.
    await atomicJson(join(metadata, "feed_items.json"), { version: 1, feeds, legacy });
    await atomicJson(join(metadata, "run_summary.json"), summary);
    if (changed) {
      await atomicJson(join(dataDir, "routes.json"), candidate);
      Object.assign(summary, { status, published: true, items_written: candidate.length });
      await atomicJson(join(metadata, "run_summary.json"), summary);
    }
    annotations(driftSummary, report);
    console.log(`ingestion: ${status}; ${candidate.length} news items; ${successful}/${configured.length} valid feeds`);
    return status === "failed" ? 1 : 0;
  } finally { await release(); }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const { values } = parseArgs({ args, options: {
      "data-dir": { type: "string", default: DEFAULT_DATA_DIR }, "feeds-json": { type: "string" },
      timeout: { type: "string", default: "15" }, help: { type: "boolean", short: "h" },
    } });
    if (values.help) {
      console.log("Collate legal news without discarding last-good feed data\nUsage: npm start -- [--data-dir PATH] [--feeds-json PATH] [--timeout SECONDS]\nFeed configuration: {\"rss\": [\"https://…\"], \"html\": [\"https://…\"]}");
      return 0;
    }
    let rss: unknown[] = RSS_URL_ARRAY, html: unknown[] = UNSTRUCT_URL_ARRAY;
    if (values["feeds-json"]) {
      const config = await readJson(resolve(values["feeds-json"]), null);
      if (!isRecord(config) || ["rss", "html"].some(key => key in config && !Array.isArray(config[key]))) throw new Error("Feed configuration must contain rss/html URL arrays");
      rss = config.rss as unknown[] ?? [];
      html = config.html as unknown[] ?? [];
    }
    return await runIngestion(values["data-dir"], rss, html, { timeoutSeconds: Number(values.timeout) });
  } catch (error) {
    console.error(`Ingestion failed: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
