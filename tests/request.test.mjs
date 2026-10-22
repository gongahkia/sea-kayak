import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { requestJson } from '../sea-kayak-app/app/lib/request.ts';

async function serverFor(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('real HTTP JSON preserves Unicode and rejects error statuses or invalid JSON', async t => {
  const base = await serverFor(t, (req, res) => {
    if (req.url === '/error') { res.writeHead(503); res.end('{}'); }
    else if (req.url === '/invalid') res.end('<html>not JSON</html>');
    else res.end(JSON.stringify({ title: '新加坡 § 12 — café' }));
  });
  assert.deepEqual(await requestJson(base), { title: '新加坡 § 12 — café' });
  await assert.rejects(requestJson(base + '/error'), /unavailable/);
  await assert.rejects(requestJson(base + '/invalid'), SyntaxError);
});

test('declared, chunked and gzip decoded bodies obey the byte cap', async t => {
  const base = await serverFor(t, (req, res) => {
    if (req.url === '/declared') res.writeHead(200, { 'content-length': '1000' });
    if (req.url === '/gzip') { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end(gzipSync(JSON.stringify('x'.repeat(4000)))); }
    else { res.write(JSON.stringify('x'.repeat(200))); res.end(); }
  });
  for (const path of ['/declared', '/chunked', '/gzip']) await assert.rejects(requestJson(base + path, { maxBytes: 100 }), /size limit/);
});

test('absolute deadline covers headers and a continuously arriving response body', async t => {
  const base = await serverFor(t, (req, res) => {
    if (req.url === '/headers') {
      const timer = setTimeout(() => res.end('{}'), 2000);
      res.on('close', () => clearTimeout(timer));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }); res.write('[');
      const timer = setInterval(() => res.write('0,'), 10);
      res.on('close', () => clearInterval(timer));
    }
  });
  for (const path of ['/headers', '/body']) {
    const start = performance.now();
    await assert.rejects(requestJson(base + path, { timeoutMs: 120 }), /timed out/);
    assert(performance.now() - start < 800, 'continuously arriving bytes must not extend the deadline');
  }
});

test('caller cancellation interrupts an in-flight body; pre-cancellation makes no request', async t => {
  let requests = 0;
  const base = await serverFor(t, (_req, res) => { requests++; res.write('['); });
  const controller = new AbortController();
  const pending = requestJson(base, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 50);
  t.after(() => clearTimeout(timer));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requests, 1);
  await assert.rejects(requestJson(base, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('invalid limits are rejected before fetching', async () => {
  await assert.rejects(requestJson('http://127.0.0.1:1', { maxBytes: 0 }), /Invalid download limits/);
  await assert.rejects(requestJson('http://127.0.0.1:1', { timeoutMs: NaN }), /Invalid download limits/);
});
