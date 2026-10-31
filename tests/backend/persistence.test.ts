import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { atomicJson, readJson, ingestionLock, MAX_STATE_BYTES } from "../../src/persistence.ts";

async function directory(work: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "sea-kayak-state-"));
  try { await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("atomic Unicode JSON replacement leaves no temporary files", async () => {
  await directory(async dir => {
    const path = join(dir, "routes.json"), value = [{ title: "新加坡法律消息。" }];
    await atomicJson(path, value);
    assert.deepEqual(await readJson(path, null), value);
    assert.ok((await readFile(path, "utf8")).includes("新加坡"));
    assert.deepEqual(await readdir(dir), ["routes.json"]);
  });
});
test("failed atomic rename cleans temporary files and leaves existing destination intact", async () => {
  await directory(async dir => {
    const target = join(dir, "routes.json");
    await mkdir(target); await writeFile(join(target, "previous"), "unchanged");
    await assert.rejects(atomicJson(target, []));
    assert.equal(await readFile(join(target, "previous"), "utf8"), "unchanged");
    assert.deepEqual(await readdir(dir), ["routes.json"]);
  });
});
test("oversize publications never replace or truncate existing data", async () => {
  await directory(async dir => {
    const path = join(dir, "routes.json");
    await writeFile(path, "[]\n");
    await assert.rejects(atomicJson(path, "x".repeat(MAX_STATE_BYTES)), /size limit/);
    assert.equal(await readFile(path, "utf8"), "[]\n");
  });
});
test("bounded reads recover absent, malformed and invalid UTF-8 state, rejecting oversized state", async () => {
  await directory(async dir => {
    const path = join(dir, "state.json");
    assert.equal(await readJson(path, "fallback"), "fallback");
    for (const payload of ["{broken", Buffer.from([0x22, 0xff, 0x22])]) {
      await writeFile(path, payload);
      assert.equal(await readJson(path, "fallback"), "fallback");
    }
    await writeFile(path, Buffer.alloc(MAX_STATE_BYTES + 1, "x"));
    await assert.rejects(readJson(path, null), /size limit/);
  });
});
test("OS-backed process lock rejects overlap, releases normally, and recovers after SIGKILL", async () => {
  await directory(async dir => {
    const release = await ingestionLock(dir);
    await assert.rejects(ingestionLock(dir), /already running/);
    await release();
    const module = new URL("../../src/persistence.ts", import.meta.url).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `import { ingestionLock } from ${JSON.stringify(module)}; await ingestionLock(${JSON.stringify(dir)}); console.log('LOCKED');`]);
    try {
      const [output] = await once(child.stdout, "data");
      assert.equal(String(output).trim(), "LOCKED");
      await assert.rejects(ingestionLock(dir), /already running/);
    } finally { child.kill("SIGKILL"); await once(child, "exit"); }
    // flock's helper observes stdin EOF asynchronously after the parent dies.
    const unlock = await (async () => {
      for (let attempt = 0; ; attempt++) {
        try { return await ingestionLock(dir); }
        catch (error) { if (attempt === 20) throw error; await new Promise(resolve => setTimeout(resolve, 10)); }
      }
    })();
    await unlock();
    assert.ok((await readdir(dir)).includes(".ingest.lock"));
  });
});
