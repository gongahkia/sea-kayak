import type { AnyNode } from "domhandler";
import * as cheerio from "cheerio";
import { parseSource } from "./legal_sources.ts";
import { parseFeedResponse } from "./superfeed.ts";
import { extractCitation, removeDuplicates, urlIdentity } from "./items.ts";
import { TerminalError } from "./retry.ts";
import type { FeedResponse, NewsItem } from "./types.ts";

export function parseDocument(response: FeedResponse, originalUrl: string): NewsItem[] {
  const specialized = parseSource(response, originalUrl);
  if (specialized !== null) return specialized;
  if (/^\s*(?:<\?xml|<rss|<feed)/.test(response.content.toString("utf8"))) return parseFeedResponse(response, originalUrl);
  const $ = cheerio.loadBuffer(response.content);
  const selected = $("main, article, [role=main]").first();
  const root: cheerio.Cheerio<AnyNode> = selected.length ? selected : $("body").length ? $("body") : $.root();
  root.find("nav,header,footer,aside,form,script,style,noscript,template,[hidden],[aria-hidden=true],[role=navigation],.nav,.sidebar,.footer,.header").remove();
  const items: NewsItem[] = [];
  for (const anchor of root.find("a[href]")) {
    let url: string;
    try { url = new URL($(anchor).attr("href")!, response.url || originalUrl).href; } catch { continue; }
    const title = $(anchor).text().replace(/\s+/g, " ").trim();
    if (!urlIdentity(url) || !title) continue;
    items.push({ url, title, description: "", published: "", citation: extractCitation(url, title) });
  }
  if (items.length > 5000) throw new TerminalError("HTML feed exceeds the entry-count limit");
  return removeDuplicates(items);
}
