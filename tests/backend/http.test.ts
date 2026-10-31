import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync, deflateSync, deflateRawSync } from "node:zlib";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fetchPublicFeed, MAX_FEED_BYTES } from "../../src/feed_http.ts";
import { RetryableError, TerminalError, FeedOutcomes, retry } from "../../src/retry.ts";
import { scrapeFeed } from "../../src/scraper.ts";

const BODY = Buffer.from('<rss version="2.0"><channel><title>News</title><item><title>Synthetic news</title><link>https://example.test/news</link></item></channel></rss>');
const counts = new Map<string, number>();
let base = "";
const server = createServer(async (request, response) => {
  const path = request.url!;
  counts.set(path, (counts.get(path) ?? 0) + 1);
  if (path === "/headers") await sleep(300);
  if (response.destroyed) return;
  if (path === "/redirect" || path === "/credentials" || path === "/loop" || path === "/protocol") {
    response.writeHead(302, { location: path === "/redirect" ? "/deep/feed.xml" : path === "/credentials" ? `http://user:secret@127.0.0.1:${new URL(base).port}/must-not-fetch` : path === "/protocol" ? "file:///etc/passwd" : "/loop" });
    response.end(); return;
  }
  if (path.startsWith("/status")) { response.writeHead(Number(path.slice(7))); response.end(); return; }
  if (path === "/recover" && counts.get(path) === 1) { response.writeHead(503); response.end(); return; }
  if (path === "/body") {
    response.writeHead(200);
    const timer = setInterval(() => response.write("x"), 10);
    response.on("close", () => clearInterval(timer));
    return;
  }
  if (path === "/cookies") {
    response.end(JSON.stringify(request.headers)); return;
  }
  let body = BODY;
  const headers: Record<string, string> = { "content-type": "application/rss+xml; charset=utf-8" };
  if (path === "/large" || path === "/stream-large") body = Buffer.alloc(MAX_FEED_BYTES + 1, "x");
  if (path.startsWith("/gzip")) {
    headers["content-encoding"] = "gzip";
    body = gzipSync(path === "/gzip-large" ? Buffer.alloc(MAX_FEED_BYTES + 1, "x") : BODY);
    if (path === "/gzip-truncated") body = body.subarray(0, -5);
    if (path === "/gzip-members") body = Buffer.concat([gzipSync(BODY.subarray(0, 50)), gzipSync(BODY.subarray(50))]);
  }
  if (path.startsWith("/deflate")) {
    headers["content-encoding"] = "deflate";
    body = path.includes("raw") ? deflateRawSync(BODY) : deflateSync(BODY);
    if (path.includes("truncated")) body = body.subarray(0, -5);
    if (path.includes("trailing")) body = Buffer.concat([body, Buffer.from("trailing")]);
  }
  if (path === "/unsupported") headers["content-encoding"] = "br";
  if (path !== "/stream-large") headers["content-length"] = String(body.length);
  response.writeHead(200, headers);
  if (path === "/stream-large") {
    for (let offset = 0; offset < body.length; offset += 65536) response.write(body.subarray(offset, offset + 65536));
    response.end();
  } else if (path === "/deflate-raw-split") {
    response.write(body.subarray(0, 1));
    await sleep(10);
    response.end(body.subarray(1));
  } else response.end(body);
});
before(async () => { server.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

for (const path of ["/plain", "/gzip", "/gzip-members", "/deflate", "/deflate-raw", "/deflate-raw-split"]) {
  test(`${path} preserves exact original feed bytes`, async () => { assert.deepEqual((await fetchPublicFeed(base + path)).content, BODY); });
}
test("redirects preserve final document location", async () => { assert.equal((await fetchPublicFeed(base + "/redirect")).url, base + "/deep/feed.xml"); });
test("credential redirects, unsupported protocols and loops fail before unsafe requests", async () => {
  for (const path of ["/credentials", "/loop", "/protocol"]) await assert.rejects(fetchPublicFeed(base + path), TerminalError);
  assert.equal(counts.get("/must-not-fetch"), undefined);
  assert.equal(counts.get("/loop"), 6);
});
for (const path of ["/headers", "/body"]) {
  test(`${path} obeys absolute deadline even when bytes keep arriving`, async () => {
    const started = performance.now();
    await assert.rejects(fetchPublicFeed(base + path, { timeoutSeconds: 0.08 }), RetryableError);
    assert.ok(performance.now() - started < 500);
  });
}
for (const path of ["/large", "/stream-large", "/gzip-large", "/unsupported"]) {
  test(`${path} is rejected by encoded/decoded byte and encoding limits`, async () => { await assert.rejects(fetchPublicFeed(base + path), TerminalError); });
}
for (const path of ["/gzip-truncated", "/deflate-truncated", "/deflate-raw-truncated", "/deflate-trailing", "/deflate-raw-trailing"]) {
  test(`${path} cannot pass as a complete document`, async () => { await assert.rejects(fetchPublicFeed(base + path), RetryableError); });
}
test("native statuses stop terminal errors and bound transient retries", async () => {
  for (const [status, attempts] of [[404, 1], [410, 1], [451, 1], [401, 1], [403, 1], [500, 3], [429, 3]]) {
    const outcomes = new FeedOutcomes(), url = base + `/status${status}`;
    assert.deepEqual(await scrapeFeed(url, "rss", outcomes, { retry: { sleep: async () => undefined } }), []);
    assert.equal(counts.get(`/status${status}`), attempts);
    assert.equal(outcomes.records[url].attempts, attempts);
    assert.equal(outcomes.records[url].status, attempts === 1 ? "terminal" : "retried_fail");
  }
});
test("recovered transient response records retry history and succeeds", async () => {
  const outcomes = new FeedOutcomes(), url = base + "/recover";
  assert.equal((await scrapeFeed(url, "rss", outcomes, { retry: { sleep: async () => undefined, random: () => 0.5 } })).length, 1);
  assert.equal(outcomes.records[url].status, "retried_ok");
  assert.equal(outcomes.records[url].retries.length, 1);
  assert.equal(outcomes.records[url].retries[0].delay_s, 1);
});
test("cookies and credentials are never forwarded to public sources", async () => {
  const response = await fetchPublicFeed(base + "/cookies", { headers: { Cookie: "secret", Authorization: "secret", "Proxy-Authorization": "secret" } });
  const headers = JSON.parse(response.content.toString());
  assert.equal(headers.cookie, undefined); assert.equal(headers.authorization, undefined); assert.equal(headers["proxy-authorization"], undefined);
  assert.equal(headers["accept-encoding"], "identity");
});
test("invalid limits fail before making a request", async () => {
  for (const timeoutSeconds of [0, -1, NaN, Infinity, 61]) await assert.rejects(fetchPublicFeed(base, { timeoutSeconds }), /Invalid/);
  for (const maxBytes of [0, 1.5, MAX_FEED_BYTES + 1]) await assert.rejects(fetchPublicFeed(base, { maxBytes }), /Invalid/);
});
test("retry callback failures cannot interrupt recovery and unknown errors fail fast", async () => {
  let attempts = 0;
  assert.equal(await retry(async () => { if (++attempts < 2) throw new RetryableError("retry"); return 42; }, { sleep: async () => undefined, onRetry: () => { throw new Error("report"); } }), 42);
  attempts = 0;
  await assert.rejects(retry(async () => { attempts++; throw new Error("unknown"); }, { sleep: async () => undefined }), /unknown/);
  assert.equal(attempts, 1);
});
