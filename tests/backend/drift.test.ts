import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { DriftMonitor, fingerprint } from "../../src/drift.ts";
import { atomicJson } from "../../src/persistence.ts";

const URL = "https://example.test/feed";
const body = (count: number, field = "title") => Buffer.from(`<rss version="2.0"><channel>${`<item><${field}>News</${field}><link>https://example.test/news</link></item>`.repeat(count)}</channel></rss>`);

test("fingerprints preserve original XML schema, hash, encoding and entry count fields", () => {
  const bytes = body(2), fp = fingerprint(bytes, "application/rss+xml; charset=UTF-8");
  assert.deepEqual(fp, {
    format: "xml", root_tag: "rss", root_attrs: ["version"], first_entry_tag: "item", first_entry_children: ["link", "title"], first_entry_attrs: [], entry_count: 2,
    body_sha256: createHash("sha256").update(bytes).digest("hex"), encoding: "utf-8", content_type: "application/rss+xml", size_bytes: bytes.length,
  });
});
test("HTML fingerprint records link classes, top-level structure and counts", () => {
  const fp = fingerprint(Buffer.from('<html><body><a class="news case" href="/a">A</a><a href="/b">B</a></body></html>'), "text/html");
  assert.equal(fp.entry_count, 2);
  assert.deepEqual(fp.top_tags, ["html"]);
  assert.deepEqual(fp.anchor_classes, ["case", "news"]);
});
test("existing Python fingerprints produce no migration drift and retain structural hashes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sea-kayak-drift-"));
  try {
    const fp = fingerprint(body(10), "text/xml"), date = "2026-10-20T00:00:00+00:00";
    await atomicJson(join(dir, "fingerprints.json"), { feeds: { [URL]: { current_fingerprint: fp, last_success_iso: date, history: [{ entry_count: 10 }, { entry_count: 10 }] } } });
    const monitor = await DriftMonitor.load(dir, () => new Date("2026-10-22T00:00:00Z"));
    monitor.recordFetch(URL, body(10), "text/xml");
    assert.deepEqual(await monitor.finalize(), { checked_count: 1, drift: [], silent: [], floor: [] });
    const state = JSON.parse(await readFile(join(dir, "fingerprints.json"), "utf8"));
    const structural = '{"content_type": "text/xml", "first_entry_attrs": [], "first_entry_children": ["link", "title"], "first_entry_tag": "item", "format": "xml", "root_attrs": ["version"], "root_tag": "rss"}';
    assert.equal(state.feeds[URL].history.at(-1).structural_sha, createHash("sha256").update(structural).digest("hex").slice(0, 16));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("drift monitoring reports structural changes, silence, floors and bounded rolling history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sea-kayak-drift-"));
  try {
    const fp = fingerprint(body(10), "text/xml");
    await atomicJson(join(dir, "fingerprints.json"), { feeds: {
      [URL]: { current_fingerprint: fp, last_success_iso: "2026-10-20T00:00:00+00:00", history: Array.from({ length: 9 }, () => ({ entry_count: 10 })) },
      "https://example.test/silent": { current_fingerprint: fp, last_success_iso: "2026-10-01T00:00:00+00:00", history: [] },
      invalid: { history: [true, { entry_count: true }, { entry_count: -1 }] },
    } });
    const monitor = await DriftMonitor.load(dir, () => new Date("2026-10-22T00:00:00Z"));
    monitor.recordFetch(URL, body(1, "summary"), "text/xml");
    const summary = await monitor.finalize();
    assert.equal(summary.drift[0].diffs[0].field, "first_entry_children");
    assert.deepEqual(summary.floor, [{ url: URL, current: 1, rolling_avg: 10 }]);
    assert.deepEqual(summary.silent, [{ url: "https://example.test/silent", age_days: 21 }]);
    const state = JSON.parse(await readFile(join(dir, "fingerprints.json"), "utf8"));
    assert.equal(state.feeds[URL].history.length, 7);
    assert.deepEqual(state.feeds.invalid.history, []);
    const report = await readFile(join(dir, "drift_report.md"), "utf8");
    for (const section of ["Structural drift", "Silent feeds", "Entry-count floor breaches"]) assert.ok(report.includes(section));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("daily collate still runs at midnight Singapore with serialized executions", async () => {
  const workflow = parse(await readFile(new globalThis.URL("../../.github/workflows/collate.yml", import.meta.url), "utf8"));
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  for (const entry of workflow.on.schedule) {
    assert.equal(entry.cron, "0 16 * * *");
    for (const month of ["01", "07"]) assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(`2026-${month}-01T16:00:00Z`)), "00:00");
  }
});

test("CI and scheduled ingestion execute the TypeScript backend with locked Node dependencies", async () => {
  const ci = parse(await readFile(new globalThis.URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"));
  const collate = parse(await readFile(new globalThis.URL("../../.github/workflows/collate.yml", import.meta.url), "utf8"));
  const steps = ci.jobs.backend.steps;
  assert.ok(steps.some((step: { uses?: string; with?: Record<string, string> }) => step.uses === "actions/setup-node@v4" && step.with?.["node-version"] === "24"));
  assert.deepEqual(steps.filter((step: { run?: string }) => step.run).map((step: { run: string }) => step.run), ["npm ci", "npm run check"]);
  const commands = collate.jobs["scrape-to-local"].steps.map((step: { run?: string }) => step.run);
  assert.ok(commands.includes("npm ci --omit=dev"));
  assert.ok(commands.includes("npm start"));
});
