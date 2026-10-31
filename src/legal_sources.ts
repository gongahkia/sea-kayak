/** Explicit adapters prevent navigation and loading pages becoming legal news. */
import type { AnyNode } from "domhandler";
import * as cheerio from "cheerio";
import { RetryableError } from "./retry.ts";
import { extractCitation, removeDuplicates, urlIdentity, htmlText } from "./items.ts";
import { isRecord, utcIso } from "./types.ts";
import type { FeedResponse, NewsItem } from "./types.ts";

export function listingDate(value: unknown): string {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const match = typeof value === "string" ? /^(\d{1,2}) ([a-z]+) (\d{4})$/i.exec(value.trim()) : null;
  if (match) {
    const month = months.findIndex(name => name === match[2].toLowerCase() || name.slice(0, 3) === match[2].toLowerCase());
    const day = Number(match[1]), year = Number(match[3]);
    const date = new Date(Date.UTC(year, month, day));
    if (month >= 0 && date.getUTCDate() === day && date.getUTCFullYear() === year && year >= 100) {
      return utcIso(new Date(date.getTime() - 8 * 3_600_000));
    }
  }
  throw new RetryableError("Legal listing has a missing or invalid publication date");
}

function item(baseUrl: string, href: unknown, title: unknown, published: unknown, citation = ""): NewsItem | null {
  if (typeof href !== "string" || typeof title !== "string" || !title.trim()) return null;
  let url: URL;
  try { url = new URL(href, baseUrl); } catch { return null; }
  if (!urlIdentity(url.href) || url.hostname !== new URL(baseUrl).hostname) return null;
  return { url: url.href, title: title.trim(), description: "", published: listingDate(published), citation: citation || extractCitation(url.href, title) };
}

export function parseSource(response: FeedResponse, originalUrl: string): NewsItem[] | null {
  const parts = new URL(originalUrl), host = parts.hostname.replace(/^www\./, "");
  const items: (NewsItem | null)[] = [];
  if (host === "pdpc.gov.sg" && parts.pathname === "/api/listing-api") {
    let data: unknown;
    try { data = JSON.parse(response.content.toString("utf8")); }
    catch { throw new RetryableError("PDPC did not return its decision listing"); }
    if (!isRecord(data) || !Array.isArray(data.data)) throw new RetryableError("PDPC decision listing has an unexpected schema");
    if (data.data.length > 5000) throw new RetryableError("PDPC decision listing exceeds the entry-count limit");
    for (const record of data.data) {
      if (!isRecord(record)) continue;
      const result = item(originalUrl, record.href, record.title, record.date);
      if (result && new URL(result.url).pathname.startsWith("/organisations/regulations-decisions/enforcement-decisions/")) items.push(result);
    }
  } else {
    const judgments = host === "elitigation.sg" && parts.pathname.replace(/\/$/, "") === "/gd";
    const sal = host === "journalsonline.academypublishing.org.sg";
    const ccs = host === "ccs.gov.sg" && parts.pathname.startsWith("/case-register/public-register/");
    if (!judgments && !sal && !ccs) return null;
    const $ = cheerio.loadBuffer(response.content);
    const text = (selection: cheerio.Cheerio<AnyNode>) => htmlText(selection.get(0)).replace(/\s+/g, " ").trim();
    if (judgments) {
      for (const card of $(".gd-card-body")) {
        const link = $(card).find('a[href^="/gd/s/"]').first();
        const date = /Decision Date:\s*(\d{1,2} \w+ \d{4})/.exec(text($(card).find(".decision-date-link").first()));
        if (link.length && date) items.push(item(originalUrl, link.attr("href"), text(link), date[1], extractCitation(text($(card).find(".citation-num-link").first()))));
      }
    } else if (sal) {
      for (const card of $(".artListItem")) {
        const link = $(card).find('a[href$="/Citation/JournalsOnlinePDF"]').first();
        if (!link.length) continue;
        items.push(item(originalUrl, link.attr("href")?.replace(/^http:\/\//, "https://"), text($(card).find("p b").first()),
          text($(card).find(".eFirstListHead").first()), text($(card).children("p").last())));
      }
    } else {
      const path = parts.pathname.replace(/\/$/, "") + "/";
      for (const link of $("a[href]:has(h2)")) {
        let target: URL;
        try { target = new URL($(link).attr("href")!, originalUrl); } catch { continue; }
        if (!target.pathname.startsWith(path) || target.pathname === path) continue;
        items.push(item(originalUrl, target.href, text($(link).find("h2").first()), text($(link).find("p").first())));
      }
    }
  }
  const result = removeDuplicates(items.filter((value): value is NewsItem => value !== null));
  if (!result.length) throw new RetryableError("Legal listing contains no usable articles or decisions");
  if (result.length > 5000) throw new RetryableError("Legal listing exceeds the entry-count limit");
  return result;
}
