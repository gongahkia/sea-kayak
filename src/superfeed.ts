import { parseXml, descendants, xmlText } from "./xml.ts";
import type { XmlNode } from "./xml.ts";
import { cleanDescription, extractCitation, publishedIso, urlIdentity } from "./items.ts";
import { RetryableError, TerminalError } from "./retry.ts";
import type { FeedResponse, NewsItem } from "./types.ts";

const XML_BASE = "{http://www.w3.org/XML/1998/namespace}base";

function summaryText(node?: XmlNode): string {
  if (!node?.children.length) return xmlText(node);
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const markup = (node: XmlNode): string => `<${node.name}>${node.content.map(part => typeof part === "string" ? escape(part) : markup(part)).join("")}</${node.name}>`;
  return node.content.map(part => typeof part === "string" ? escape(part) : markup(part)).join("");
}

export function parseFeedResponse(response: FeedResponse, baseUrl: string): NewsItem[] {
  const root = parseXml(response.content, response.headers["content-type"]);
  if (!["rss", "feed", "RDF"].includes(root.name)) throw new RetryableError("Response is not a complete RSS or Atom document");
  const finalUrl = response.url || baseUrl;
  const bases = new Map<XmlNode, string>();
  function locate(node: XmlNode, base: string) {
    try { base = new URL(node.attributes[XML_BASE] ?? "", base).href; } catch { /* Retain parent base. */ }
    bases.set(node, base);
    for (const child of node.children) locate(child, base);
  }
  locate(root, finalUrl);
  const entries = Array.from(descendants(root)).filter(node => ["item", "entry"].includes(node.name));
  if (entries.length > 5000) throw new TerminalError("Feed exceeds the entry-count limit");
  const items: NewsItem[] = [];
  for (const entry of entries) {
    const child = (name: string) => entry.children.find(node => node.name === name);
    const links = entry.children.filter(node => node.name === "link");
    const linkNode = links.find(node => !node.attributes.rel || node.attributes.rel === "alternate");
    let link = linkNode?.attributes.href ?? xmlText(linkNode).trim();
    if (!link) {
      const guid = child("guid");
      if (guid && guid.attributes.isPermaLink !== "false") link = xmlText(guid).trim();
    }
    if (!link || /[\u0000-\u001f\u007f]/.test(link)) continue;
    // Reject malformed authority before WHATWG URL can percent-encode spaces in paths.
    if (/^(?:https?:)?\/\/[^/?#]*\s/i.test(link)) continue;
    try { link = new URL(link, bases.get(linkNode ?? entry)).href; } catch { continue; }
    if (!urlIdentity(link)) continue;
    const title = xmlText(child("title")).trim();
    const description = cleanDescription(summaryText(child("summary")) || summaryText(child("description")) || summaryText(child("content")));
    items.push({
      url: link, title, description,
      published: publishedIso(xmlText(child("published") ?? child("pubDate") ?? child("date"))) || publishedIso(xmlText(child("updated"))),
      citation: extractCitation(link, title, description),
    });
  }
  return items;
}
