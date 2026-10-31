import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseFeedResponse } from "../../src/superfeed.ts";
import { parseDocument } from "../../src/unstructured.ts";
import { cleanDescription, extractCitation, normalizeItems, removeDuplicates, urlIdentity } from "../../src/items.ts";
import { listingDate } from "../../src/legal_sources.ts";
import { RetryableError, TerminalError } from "../../src/retry.ts";
import { RSS_URL_ARRAY, UNSTRUCT_URL_ARRAY } from "../../src/config.ts";
import type { NewsItem } from "../../src/types.ts";

const fixtures = JSON.parse(await readFile(new URL("./python-parity.json", import.meta.url), "utf8")) as {
  parser: string; body: string; url: string; final_url: string; headers: Record<string, string>; expected?: NewsItem[]; error?: string;
}[];
for (const [index, fixture] of fixtures.entries()) {
  test(`Python parity ${index + 1}: ${fixture.parser} ${fixture.url} ${fixture.error ?? "success"}`, () => {
    const parse = () => (fixture.parser === "rss" ? parseFeedResponse : parseDocument)(
      { content: Buffer.from(fixture.body), url: fixture.final_url, headers: fixture.headers }, fixture.url);
    if (fixture.error) assert.throws(parse, fixture.error === "TerminalError" ? TerminalError : RetryableError);
    else assert.deepEqual(parse(), fixture.expected);
  });
}

const response = (body: string, url = "https://example.test/deep/feed.xml") => ({ content: Buffer.from(body), url, headers: { "content-type": "application/rss+xml" } });

test("normalization rejects corrupt records before deduplication and keeps first fragment", () => {
  const valid = { url: "https://example.test/news#first", title: "Valid", description: "", published: "", citation: "" };
  assert.deepEqual(normalizeItems([null, [], {}, { ...valid, title: {} }, valid, { ...valid, url: "https://example.test/news#second" }]), [valid]);
  assert.deepEqual(removeDuplicates([null, {}, { url: [] }, valid, valid]), [valid]);
  assert.deepEqual(normalizeItems(["https://example.test/legacy"]), [{ ...valid, url: "https://example.test/legacy", title: "" }]);
  for (const invalid of ["file:///etc/passwd", "javascript:alert(1)", "https://user:secret@example.test", "https://bad host.test/news", "https://example.test:bad", "https://example.test/\u0000", "https://example.test/a b"]) assert.equal(urlIdentity(invalid), null);
  assert.equal(urlIdentity(" HTTPS://EXAMPLE.TEST?x=1#part "), "https://example.test/?x=1");
});

test("descriptions preserve Unicode, remove scripts and bound Unicode codepoints", () => {
  assert.equal(cleanDescription("<p>新加坡法院裁定：保障个人资料。</p><script>secret</script>"), "新加坡法院裁定：保障个人资料。");
  assert.equal(cleanDescription("<p>… -- ...</p>"), "");
  assert.equal(Array.from(cleanDescription("法院".repeat(150))).length, 200);
  assert.equal(extractCitation("https://example.test/%5B2026%5D%20SGHC%20(A)%205"), "[2026] SGHC (A) 5");
});

test("RSS resolves redirected relative links, strips HTML, and keeps Singapore publication offsets", () => {
  const feed = response(`<rss version="2.0"><channel><item><title>Legal news</title><link>../news/a</link><description><![CDATA[<p>新加坡法律消息。</p><script>secret</script>]]></description><pubDate>Thu, 22 Oct 2026 00:15:00 +0800</pubDate></item></channel></rss>`);
  assert.deepEqual(parseFeedResponse(feed, "https://old.test/feed"), [{ url: "https://example.test/news/a", title: "Legal news", description: "新加坡法律消息。", published: "2026-10-21T16:15:00+00:00", citation: "" }]);
});

test("Atom alternate links, namespaces, xml:base, XHTML summaries and updated dates", () => {
  const feed = response(`<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.test/news/"><entry xml:base="court/"><title>Judgment</title><link rel="self" href="self.xml"/><link rel="alternate" href="case"/><summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Legal news</p></div></summary><updated>2026-10-22T00:15:00+08:00</updated></entry></feed>`);
  const item = parseFeedResponse(feed, feed.url)[0];
  assert.equal(item.url, "https://example.test/news/court/case");
  assert.equal(item.description, "Legal news");
  assert.equal(item.published, "2026-10-21T16:15:00+00:00");
});

test("RSS 1.0 namespace and Dublin Core dates are supported", () => {
  const feed = response(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><item><title>News</title><link>https://example.test/news</link><dc:date>2026-10-22</dc:date></item></rdf:RDF>`);
  assert.equal(parseFeedResponse(feed, feed.url)[0].published, "2026-10-22T00:00:00+00:00");
});

test("HTML keeps article links and excludes forms, hidden content and page chrome", () => {
  const feed = response(`<html><nav><a href="/privacy">Privacy</a></nav><main><a href="/news/a#part">A news</a><a href="/event">Legal event</a><form><a href="/account">Private</a></form><div hidden><a href="/hidden">Hidden</a></div><script>secret</script></main><footer><a href="/contact">Contact</a></footer></html>`);
  assert.deepEqual(parseDocument(feed, feed.url).map(item => item.url), ["https://example.test/news/a#part", "https://example.test/event"]);
});

test("malformed XML, error pages, entity expansion and excessive entries are rejected", () => {
  for (const body of ["<rss><channel>", "<html><h1>Maintenance</h1></html>", '<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&secret;</title></item></channel></rss>']) {
    const feed = response(body);
    assert.throws(() => parseFeedResponse(feed, feed.url), RetryableError);
  }
  const feed = response(`<rss><channel>${"<item/>".repeat(5001)}</channel></rss>`);
  assert.throws(() => parseFeedResponse(feed, feed.url), TerminalError);
});

test("downloaded bytes spelling a filename never open that file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sea-kayak-parser-"));
  try {
    const path = join(dir, "private.xml");
    await writeFile(path, '<rss><channel><item><title>Secret</title><link>https://example.test/private</link></item></channel></rss>');
    const feed = response(path);
    assert.throws(() => parseFeedResponse(feed, feed.url), RetryableError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("official publication dates reject malformed and impossible dates", () => {
  assert.equal(listingDate("3 August 2026"), "2026-08-02T16:00:00+00:00");
  for (const value of [null, "31 Feb 2026", "2026-10-30", "30 Wrong 2026"]) assert.throws(() => listingDate(value), RetryableError);
});

test("all 36 production sources retain their coverage and configured order", () => {
  assert.equal(RSS_URL_ARRAY.length, 17);
  assert.equal(UNSTRUCT_URL_ARRAY.length, 19);
  assert.ok(RSS_URL_ARRAY.includes("https://smulexicon.com/feed/"));
  assert.ok(RSS_URL_ARRAY.includes("https://sso.agc.gov.sg/What's-New/New-Legislation/RSS"));
  assert.ok(!RSS_URL_ARRAY.some(url => url.includes("Notices.xml")));
});
