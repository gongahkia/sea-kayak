import { createHash } from "node:crypto";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { atomicBytes, atomicJson, readJson } from "./persistence.ts";
import { parseXml, descendants, detectEncoding } from "./xml.ts";
import { isRecord, utcIso } from "./types.ts";

const HISTORY_DEPTH = 7;
const SILENT_THRESHOLD_DAYS = 5;
const ENTRY_FLOOR_RATIO = 0.4;
type Fingerprint = Record<string, unknown> & { entry_count?: number };
interface History { entry_count: number; ts?: string; structural_sha?: string }
interface FeedRecord { history: History[]; last_success_iso?: string; current_fingerprint?: Fingerprint }
interface State { feeds: Record<string, FeedRecord> }
export interface DriftSummary {
  drift: { url: string; diffs: { field: string; before: unknown; after: unknown }[] }[];
  silent: { url: string; age_days: number }[];
  floor: { url: string; current: number; rolling_avg: number }[];
  checked_count: number;
}

function normalizeState(value: unknown): State {
  const state: State = { feeds: Object.create(null) };
  if (!isRecord(value) || !isRecord(value.feeds)) return state;
  for (const [url, raw] of Object.entries(value.feeds)) {
    if (!isRecord(raw)) continue;
    const history = Array.isArray(raw.history) ? raw.history.filter((entry): entry is History =>
      isRecord(entry) && Number.isSafeInteger(entry.entry_count) && Number(entry.entry_count) >= 0).slice(-HISTORY_DEPTH) : [];
    const record: FeedRecord = { history };
    if (typeof raw.last_success_iso === "string") record.last_success_iso = raw.last_success_iso;
    if (isRecord(raw.current_fingerprint) && Number.isSafeInteger(raw.current_fingerprint.entry_count) && Number(raw.current_fingerprint.entry_count) >= 0) {
      record.current_fingerprint = raw.current_fingerprint as Fingerprint;
    }
    state.feeds[url] = record;
  }
  return state;
}

function structuralKeys(fp: Fingerprint): Record<string, unknown> {
  const keys = ["format", "root_tag", "root_attrs", "first_entry_tag", "first_entry_children", "first_entry_attrs", "top_tags", "anchor_classes", "content_type", "parse_error"];
  return Object.fromEntries(keys.filter(key => key in fp).map(key => [key, fp[key]]));
}

// Match Python json.dumps(sort_keys=True), keeping existing structural hashes comparable.
function pythonJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(", ")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${pythonJson(key)}: ${pythonJson(value[key])}`).join(", ")}}`;
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function fingerprint(body: Buffer, contentType = ""): Fingerprint {
  let fp: Fingerprint;
  if (/xml|rss/i.test(contentType) || /^\s*(?:<\?xml|<rss|<feed)/.test(body.subarray(0, 512).toString())) {
    try {
      const root = parseXml(body, contentType), nodes = [...descendants(root)];
      const entries = nodes.filter(node => node.name === "item" || node.name === "entry"), first = entries[0];
      fp = {
        format: "xml", root_tag: root.name, root_attrs: Object.keys(root.attributes).sort(),
        first_entry_tag: first?.name ?? "", first_entry_children: [...new Set(first?.children.map(node => node.name) ?? [])].sort(),
        first_entry_attrs: Object.keys(first?.attributes ?? {}).sort(), entry_count: entries.length,
      };
    } catch (error) { fp = { format: "xml", parse_error: String(error) }; }
  } else {
    const $ = cheerio.load(new TextDecoder(detectEncoding(body, contentType)).decode(body), {}, false), anchors = $("a[href]");
    fp = {
      format: "html", top_tags: [...new Set($.root().children().toArray().map(node => node.tagName))].sort(),
      anchor_count: anchors.length, entry_count: anchors.length,
      anchor_classes: [...new Set(anchors.slice(0, 100).toArray().flatMap(node => ($(node).attr("class") ?? "").split(/\s+/).filter(Boolean)))].sort().slice(0, 50),
    };
  }
  return { ...fp, body_sha256: sha(body), encoding: detectEncoding(body, contentType), content_type: contentType.split(";")[0].trim().toLowerCase(), size_bytes: body.length };
}

/** Per-run state prevents concurrent ingestion calls from sharing mutable globals. */
export class DriftMonitor {
  private state: State;
  private previous: State;
  private directory: string;
  private clock: () => Date;

  private constructor(directory: string, state: State, clock: () => Date) {
    this.directory = directory;
    this.state = structuredClone(state);
    this.previous = state;
    this.clock = clock;
  }

  static async load(directory: string, clock = () => new Date()): Promise<DriftMonitor> {
    return new DriftMonitor(directory, normalizeState(await readJson(join(directory, "fingerprints.json"), {})), clock);
  }

  recordFetch(url: string, body: Buffer, contentType = ""): void {
    const fp = fingerprint(body, contentType);
    const record = this.state.feeds[url] ??= { history: [] };
    record.current_fingerprint = fp;
    record.last_success_iso = utcIso(this.clock());
    record.history.push({ ts: record.last_success_iso, entry_count: fp.entry_count ?? 0, structural_sha: sha(pythonJson(structuralKeys(fp))).slice(0, 16) });
    record.history = record.history.slice(-HISTORY_DEPTH);
  }

  async finalize(): Promise<DriftSummary> {
    const summary: DriftSummary = { drift: [], silent: [], floor: [], checked_count: Object.keys(this.state.feeds).length };
    for (const [url, record] of Object.entries(this.state.feeds)) {
      const age = Math.floor((this.clock().getTime() - Date.parse(record.last_success_iso ?? "")) / 86_400_000);
      if (age > SILENT_THRESHOLD_DAYS) summary.silent.push({ url, age_days: age });
      const current = record.current_fingerprint, previous = this.previous.feeds[url]?.current_fingerprint;
      if (!current) continue;
      if (previous) {
        const before = structuralKeys(previous), after = structuralKeys(current);
        const diffs = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
          .map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
        if (diffs.length) summary.drift.push({ url, diffs });
      }
      const counts = record.history.slice(0, -1).map(entry => entry.entry_count).filter(Boolean);
      const average = counts.reduce((a, b) => a + b, 0) / counts.length, count = current.entry_count ?? 0;
      if (counts.length >= 2 && average >= 5 && count < average * ENTRY_FLOOR_RATIO) {
        summary.floor.push({ url, current: count, rolling_avg: Math.round(average * 10) / 10 });
      }
    }
    await atomicJson(join(this.directory, "fingerprints.json"), this.state);
    await this.writeReport(summary);
    return summary;
  }

  private async writeReport(summary: DriftSummary): Promise<void> {
    const lines = [`# Drift Report — ${utcIso(this.clock())}`, ""];
    if (!summary.drift.length && !summary.silent.length && !summary.floor.length) lines.push("_No drift, silence, or floor violations detected this run._");
    if (summary.drift.length) {
      lines.push("## Structural drift");
      for (const finding of summary.drift) {
        lines.push(`### \`${finding.url}\``);
        for (const diff of finding.diffs) lines.push(`- **${diff.field}**: \`${JSON.stringify(diff.before)}\` -> \`${JSON.stringify(diff.after)}\``);
        lines.push("");
      }
    }
    if (summary.silent.length) {
      lines.push(`## Silent feeds (>${SILENT_THRESHOLD_DAYS} days since last success)`);
      for (const finding of summary.silent) lines.push(`- \`${finding.url}\` — ${finding.age_days}d silent`);
      lines.push("");
    }
    if (summary.floor.length) {
      lines.push("## Entry-count floor breaches");
      for (const finding of summary.floor) lines.push(`- \`${finding.url}\` — ${finding.current} entries (rolling avg ${finding.rolling_avg})`);
      lines.push("");
    }
    await atomicBytes(join(this.directory, "drift_report.md"), Buffer.from(lines.join("\n") + "\n"));
  }
}
