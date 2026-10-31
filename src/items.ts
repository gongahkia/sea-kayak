import * as cheerio from "cheerio";
import { isRecord, utcIso } from "./types.ts";
import type { NewsItem } from "./types.ts";

export const DESC_MAX = 200;
const citationPattern = /\[(?:19|20)\d{2}\]\s+SG(?:CA|HC|HCR|FC|DC|MC|HCF|YC|PDPC)(?:\s*\([A-Za-z]+\))?\s+\d+/;

export function extractCitation(...texts: string[]): string {
  for (const text of texts) {
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch { /* Match usable undecoded text. */ }
    const match = citationPattern.exec(decoded);
    if (match) return match[0].replace(/\s+/g, " ").trim();
  }
  return "";
}

export function htmlText(node: unknown): string {
  function parts(value: unknown): string[] {
    if (!isRecord(value)) return [];
    if (value.type === "text" && typeof value.data === "string") return [value.data.trim()].filter(Boolean);
    return Array.isArray(value.children) ? value.children.flatMap(parts) : [];
  }
  return parts(node).join(" ");
}

export function cleanDescription(raw: string): string {
  if (!raw) return "";
  const $ = cheerio.load(raw, {}, false);
  $("script,style,template").remove();
  const text = htmlText($.root().get(0));
  if (!/[\p{L}\p{N}]/u.test(text)) return "";
  const characters = Array.from(text);
  return characters.length > DESC_MAX ? characters.slice(0, DESC_MAX - 1).join("").trimEnd() + "…" : text;
}

export function urlIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) return null;
    // Keep the Python identity rules: lowercase authority, empty path '/', no fragment.
    // WHATWG serialization would additionally normalize ports and encoded paths.
    const match = /^(https?):\/\/([^/?#]+)([^#]*)/i.exec(trimmed);
    if (!match || match[2].includes("@")) return null;
    const suffix = match[3].startsWith("/") ? match[3] : "/" + match[3];
    return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${suffix}`;
  } catch { return null; }
}

export function removeDuplicates<T>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const identity = urlIdentity(isRecord(item) ? item.url : item);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function normalizeItems(value: unknown): NewsItem[] {
  if (!Array.isArray(value)) return [];
  const normalized: NewsItem[] = [];
  const fields = ["title", "description", "published", "citation"] as const;
  for (const item of value) {
    const raw: unknown = typeof item === "string" ? { url: item } : item;
    if (!isRecord(raw) || !urlIdentity(raw.url) || fields.some(key => raw[key] != null && typeof raw[key] !== "string")) continue;
    normalized.push({
      url: (raw.url as string).trim(), title: raw.title as string || "", description: raw.description as string || "",
      published: raw.published as string || "", citation: raw.citation as string || "",
    });
  }
  return removeDuplicates(normalized);
}

export function publishedIso(value: string): string {
  // Feedparser treats timezone-free publication times as UTC, irrespective of host TZ.
  if (/^\d{4}-\d{2}-\d{2}[Tt ][\d:.]+$/.test(value)) value += "Z";
  else if (/\d{1,2}:\d{2}(?::\d{2})?$/.test(value.trim()) && !/[+-]\d{2}:\d{2}$/.test(value.trim())) value += " GMT";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? utcIso(new Date(Math.floor(timestamp / 1000) * 1000)) : "";
}
