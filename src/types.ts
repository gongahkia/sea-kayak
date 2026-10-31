/** The public routes.json contract, also used by persisted per-feed caches. */
export interface NewsItem {
  url: string;
  title: string;
  description: string;
  published: string;
  citation: string;
}

export interface FeedResponse {
  content: Buffer;
  url: string;
  headers: Record<string, string>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function utcIso(date = new Date()): string {
  return date.toISOString().replace(/\.000Z$/, "+00:00").replace(/Z$/, "+00:00");
}
