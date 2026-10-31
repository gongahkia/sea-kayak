/** Bounded state, same-directory atomic replacement, and OS-backed process locks. */
import { open, mkdir, rename, rm } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";

export const MAX_STATE_BYTES = 16 * 1024 * 1024;

export async function readJson(path: string, fallback: unknown): Promise<unknown> {
  const source = await open(path, "r").catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!source) return fallback;
  try {
    const bytes = Buffer.allocUnsafe(MAX_STATE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await source.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_STATE_BYTES) throw new Error("Stored news state exceeds the size limit");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { return fallback; }
  } finally { await source.close(); }
}

export async function atomicBytes(path: string, payload: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}`);
  try {
    const target = await open(temporary, "wx", 0o600);
    try { await target.writeFile(payload); await target.sync(); }
    finally { await target.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  if (bytes.length > MAX_STATE_BYTES) throw new Error("News state exceeds the publication size limit");
  await atomicBytes(path, bytes);
}

/** Linux flock releases on process death; the pipe closes even after SIGKILL.
 * The helper only echoes a handshake, then waits for stdin EOF. No shell is used.
 */
export async function ingestionLock(directory: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true });
  const child = spawn("flock", ["--exclusive", "--nonblock", join(directory, ".ingest.lock"), "cat"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  // Mark the promise handled even if acquisition instead rejects on spawn error.
  void exited.catch(() => undefined);
  child.stdin.on("error", () => undefined);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Another ingestion process is already running")));
      child.stdout.once("data", () => resolve());
      child.stdin.write("LOCKED\n");
    });
  } catch (error) {
    child.stdin.destroy();
    throw error;
  }
  return async () => { child.stdin.end(); await exited; };
}
