import { fetchPublicFeed } from "./feed_http.ts";
import type { FetchOptions } from "./feed_http.ts";
import { parseFeedResponse } from "./superfeed.ts";
import { parseDocument } from "./unstructured.ts";
import { retry, RetryableError, errorText } from "./retry.ts";
import type { FeedOutcomes, RetryOptions } from "./retry.ts";
import type { DriftMonitor } from "./drift.ts";
import type { NewsItem } from "./types.ts";

export async function scrapeFeed(url: string, kind: "rss" | "html", outcomes: FeedOutcomes,
  options: FetchOptions & { drift?: DriftMonitor; retry?: RetryOptions } = {}): Promise<NewsItem[]> {
  let attempts = 0;
  try {
    const { response, items } = await retry(async attempt => {
      attempts = attempt;
      const response = await fetchPublicFeed(url, options);
      if (response.content.length < 32) throw new RetryableError("Feed response is empty or incomplete");
      const items = (kind === "rss" ? parseFeedResponse : parseDocument)(response, url);
      return { response, items };
    }, { ...options.retry, onRetry: (error, attempt, delay) => outcomes.recordAttempt(url, attempt, error, delay) });
    try { options.drift?.recordFetch(url, response.content, response.headers["content-type"]); }
    catch { /* Optional monitoring cannot make a valid fetch fail. */ }
    outcomes.recordResult(url, attempts > 1 ? "retried_ok" : "first_try", attempts);
    return items;
  } catch (error) {
    outcomes.recordResult(url, error instanceof RetryableError ? "retried_fail" : "terminal", attempts, errorText(error));
    return [];
  }
}
