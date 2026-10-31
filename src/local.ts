/** Compatibility for the disabled legacy local XML scraper, without temporary files. */
import { fetchPublicFeed } from "./feed_http.ts";
import { urlIdentity } from "./items.ts";
import { parseXml, descendants, xmlText } from "./xml.ts";

export async function processXml(urls: string | string[]): Promise<string[]> {
  const links = new Set<string>();
  for (const url of typeof urls === "string" ? [urls] : urls) {
    if (!urlIdentity(url)) continue;
    try {
      const response = await fetchPublicFeed(url, { timeoutSeconds: 10 });
      for (const node of descendants(parseXml(response.content))) {
        if (node.name === "link") links.add(xmlText(node));
      }
    } catch (error) { console.error(`Error processing ${url}: ${error}`); }
  }
  return [...links];
}
