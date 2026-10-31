import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, mkdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { runIngestion } from "../../src/main.ts";
import { atomicJson } from "../../src/persistence.ts";
import type { NewsItem } from "../../src/types.ts";

let phase = 1, base = "", active = 0, peak = 0;
const counts = new Map<string, number>();
const server = createServer(async (request, response) => {
  const path = request.url!;
  counts.set(path, (counts.get(path) ?? 0) + 1);
  if (phase === 3 || phase === 2 && path === "/b.xml") { response.writeHead(404); response.end(); return; }
  if (path.startsWith("/slow")) {
    peak = Math.max(peak, ++active);
    await sleep(path === "/slow-a" ? 80 : 10);
    active--;
  }
  const content = path === "/html"
    ? '<html><nav><a href="/privacy">Privacy</a></nav><main><a href="/news/a#part">A news</a><a href="/event">Legal event</a></main></html>'
    : `<rss version="2.0"><channel><title>News</title>${phase === 4 ? "" : `<item><title>${path.includes("b") ? "b" : "a"}-${phase}</title><link>${base}/news/${path.includes("b") ? "b" : "a"}</link><description>新加坡法律消息。</description></item>`}</channel></rss>`;
  response.writeHead(200, { "content-type": path === "/html" ? "text/html; charset=utf-8" : "application/rss+xml" });
  response.end(content);
});
before(async () => { server.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

async function directory(work: (directory: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "sea-kayak-pipeline-"));
  phase = 1;
  try { await work(dir); } finally { await chmod(dir, 0o700); await rm(dir, { recursive: true, force: true }); }
}
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const article = (name: string): NewsItem => ({ url: `https://example.test/${name}`, title: name, description: "", published: "", citation: "" });
const run = (dir: string) => runIngestion(dir, [base + "/a.xml", base + "/b.xml"], [base + "/html"], { timeoutSeconds: 1 });

async function cli(dir: string, config: unknown, extra: string[] = []) {
  const path = join(dir, "feeds.json");
  await writeFile(path, JSON.stringify(config));
  const work = join(dir, "unrelated-cwd");
  await mkdir(work, { recursive: true });
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../src/main.ts", import.meta.url)), "--data-dir", join(dir, "data"), "--feeds-json", path, "--timeout", "1", ...extra], { cwd: work });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const [code] = await once(child, "exit");
  return { code, stdout, stderr };
}

test("separate real CLI processes preserve failed-feed news, deduplicate globally and retain exact bytes on total failure", async () => {
  await directory(async dir => {
    const config = { rss: [base + "/a.xml", base + "/b.xml"], html: [base + "/html"] };
    const first = await cli(dir, config);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    const path = join(dir, "data/routes.json"), metadata = join(dir, "data/scrape_metadata");
    let news = await json(path) as NewsItem[];
    assert.deepEqual(news.map(item => item.url), [base + "/news/a", base + "/news/b", base + "/event"]);
    phase = 2;
    assert.equal((await cli(dir, config)).code, 0);
    news = await json(path);
    assert.equal(news.find(item => item.url.endsWith("/a"))?.title, "a-2");
    assert.equal(news.find(item => item.url.endsWith("/b"))?.title, "b-1");
    const summary = await json(join(metadata, "run_summary.json"));
    assert.equal(summary.status, "partial");
    assert.deepEqual(summary.retained_feeds, [base + "/b.xml"]);
    const original = await readFile(path);
    phase = 3;
    assert.equal((await cli(dir, config)).code, 1);
    assert.deepEqual(await readFile(path), original);
    assert.equal((await json(join(metadata, "run_summary.json"))).status, "failed");
  });
});

test("successful empty feeds keep last-good items and unchanged snapshots are not republished", async () => {
  await directory(async dir => {
    assert.equal(await runIngestion(dir, [base + "/a.xml"], []), 0);
    const original = await readFile(join(dir, "routes.json"));
    phase = 4;
    assert.equal(await runIngestion(dir, [base + "/a.xml"], []), 0);
    assert.deepEqual(await readFile(join(dir, "routes.json")), original);
    assert.equal((await json(join(dir, "scrape_metadata/run_summary.json"))).published, false);
  });
});

test("empty first run and total initial failure report failure without publishing an empty snapshot", async () => {
  for (const nextPhase of [3, 4]) await directory(async dir => {
    phase = nextPhase;
    assert.equal(await runIngestion(dir, [base + "/a.xml"], []), 1);
    await assert.rejects(readFile(join(dir, "routes.json")), { code: "ENOENT" });
  });
});

test("corrupt feed cache retains the public snapshot until all sources recover", async () => {
  await directory(async dir => {
    await run(dir);
    await writeFile(join(dir, "scrape_metadata/feed_items.json"), '{"version":1,"feeds":[],"legacy":[]}');
    await writeFile(join(dir, "scrape_metadata/fingerprints.json"), '{"feeds":[]}');
    phase = 2;
    assert.equal(await run(dir), 0);
    let news = await json(join(dir, "routes.json")) as NewsItem[];
    assert.equal(news.find(item => item.url.endsWith("/a"))?.title, "a-2");
    assert.equal(news.find(item => item.url.endsWith("/b"))?.title, "b-1");
    phase = 5;
    assert.equal(await run(dir), 0);
    news = await json(join(dir, "routes.json"));
    assert.equal(news.find(item => item.url.endsWith("/b"))?.title, "b-5");
    assert.deepEqual((await json(join(dir, "scrape_metadata/feed_items.json"))).legacy, []);
  });
});

test("legacy bare URLs are retained during partial recovery and retired after full recovery", async () => {
  await directory(async dir => {
    await atomicJson(join(dir, "routes.json"), ["https://example.test/legacy"]);
    phase = 2;
    await run(dir);
    assert.ok((await json(join(dir, "routes.json")) as NewsItem[]).some(item => item.url.endsWith("/legacy")));
    phase = 1;
    await run(dir);
    assert.ok(!(await json(join(dir, "routes.json")) as NewsItem[]).some(item => item.url.endsWith("/legacy")));
  });
});

test("bounded workers overlap HTTP waits but preserve configured feed priority", async () => {
  await directory(async dir => {
    peak = 0;
    await runIngestion(dir, [base + "/slow-a", base + "/slow-b", base + "/slow-c"], [], { concurrency: 2 });
    assert.equal(peak, 2);
    const news = await json(join(dir, "routes.json")) as NewsItem[];
    assert.deepEqual(news.map(item => item.url), [base + "/news/a", base + "/news/b"]);
    assert.equal(news[0].title, "a-1");
    const summary = await json(join(dir, "scrape_metadata/run_summary.json"));
    assert.deepEqual(summary.feeds.first_try, [base + "/slow-a", base + "/slow-b", base + "/slow-c"]);
  });
});

test("removed source caches are pruned and duplicate configured identities are fetched once", async () => {
  await directory(async dir => {
    await run(dir);
    const before = counts.get("/a.xml") ?? 0;
    await runIngestion(dir, [base + "/a.xml", base + "/a.xml"], []);
    assert.equal(counts.get("/a.xml"), before + 1);
    assert.deepEqual(Object.keys((await json(join(dir, "scrape_metadata/feed_items.json"))).feeds), [base + "/a.xml"]);
    assert.equal((await json(join(dir, "routes.json"))).length, 1);
  });
});

test("failed public write preserves previous bytes and leaves the summary prepared/unpublished", async () => {
  await directory(async dir => {
    await atomicJson(join(dir, "routes.json"), [article("previous")]);
    await mkdir(join(dir, "scrape_metadata"));
    await writeFile(join(dir, ".ingest.lock"), "");
    const original = await readFile(join(dir, "routes.json"));
    await chmod(dir, 0o500);
    try {
      await assert.rejects(run(dir), { code: "EACCES" });
      assert.deepEqual(await readFile(join(dir, "routes.json")), original);
      const summary = await json(join(dir, "scrape_metadata/run_summary.json"));
      assert.equal(summary.status, "prepared"); assert.equal(summary.published, false);
    } finally { await chmod(dir, 0o700); }
  });
});

test("invalid CLI config, timeout and arguments fail without publication", async () => {
  await directory(async dir => {
    for (const config of [null, [], { rss: "bad" }, { rss: [42] }, {}, { rss: ["file:///etc/passwd"] }]) {
      assert.equal((await cli(dir, config)).code, 1);
    }
    const config = { rss: [base + "/a.xml"] };
    assert.equal((await cli(dir, config, ["--timeout", "NaN"])).code, 1);
    assert.equal((await cli(dir, config, ["--unknown"])).code, 1);
    await assert.rejects(readFile(join(dir, "data/routes.json")), { code: "ENOENT" });
  });
});

test("configuration validation caps distinct feeds and rejects invalid concurrency before IO", async () => {
  await directory(async dir => {
    await assert.rejects(runIngestion(dir, Array.from({ length: 101 }, (_, i) => `https://example.test/${i}`), []), /1 to 100/);
    await assert.rejects(runIngestion(dir, [base], [], { concurrency: 0 }), /Concurrency/);
    await assert.rejects(runIngestion(dir, [base], [], { timeoutSeconds: Infinity }), /Timeout/);
  });
});
