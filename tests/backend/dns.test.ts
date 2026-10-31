import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { Resolver } from "node:dns/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { resolveFeedHost } from "../../src/feed_dns.ts";

test("system hosts entries and requested address families are preserved", async () => {
  const addresses = await resolveFeedHost("localhost", 4, new AbortController().signal);
  assert.ok(addresses.some(entry => entry.address === "127.0.0.1" && entry.family === 4));
});

test("a real unanswered DNS query is cancelled at deadline and cannot keep the CLI alive", async () => {
  const server = createSocket("udp4");
  let queries = 0;
  server.on("message", () => { queries++; }); // Deliberately drop every owned DNS query.
  server.bind(0, "127.0.0.1");
  await once(server, "listening");
  const address = `127.0.0.1:${server.address().port}`;
  const resolver = new Resolver(); resolver.setServers([address]);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 80);
    await assert.rejects(resolveFeedHost("owned.example.test", 0, controller.signal, resolver));
    clearTimeout(timer);
    assert.ok(queries > 0);
    const module = new URL("../../src/feed_dns.ts", import.meta.url).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { Resolver } from 'node:dns/promises';
      import { resolveFeedHost } from ${JSON.stringify(module)};
      const resolver = new Resolver(); resolver.setServers([${JSON.stringify(address)}]);
      const controller = new AbortController(); setTimeout(() => controller.abort(), 80);
      try { await resolveFeedHost('owned.example.test', 0, controller.signal, resolver); process.exitCode = 1; } catch {}
    `]);
    const timerExit = setTimeout(() => child.kill("SIGKILL"), 2000);
    try {
      const [code, signal] = await once(child, "exit");
      assert.equal(signal, null, "DNS must not keep Node alive after the attempt finishes");
      assert.equal(code, 0);
    } finally { clearTimeout(timerExit); }
  } finally { server.close(); }
});
