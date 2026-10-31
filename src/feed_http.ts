/** A single absolute deadline includes redirects, headers, and decoded body bytes. */
import http from "node:http";
import https from "node:https";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createInflate, createInflateRaw } from "node:zlib";
import { RetryableError, TerminalError, classifyHttpStatus } from "./retry.ts";
import type { FeedResponse } from "./types.ts";

export const MAX_FEED_BYTES = 4 * 1024 * 1024;
export const DEFAULT_TIMEOUT_SECONDS = 15;
export const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
};

export interface FetchOptions { timeoutSeconds?: number; maxBytes?: number; headers?: Record<string, string> }

function validateUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error();
    return url;
  } catch { throw new TerminalError("Only HTTP(S) feeds without URL credentials are supported"); }
}

export async function fetchPublicFeed(value: string, options: FetchOptions = {}): Promise<FeedResponse> {
  const { timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, maxBytes = MAX_FEED_BYTES } = options;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 60 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FEED_BYTES) {
    throw new Error("Invalid feed timeout or byte limit");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const headers = Object.fromEntries(Object.entries({ ...HEADERS, ...options.headers })
    .filter(([key]) => !["cookie", "authorization", "proxy-authorization", "accept-encoding"].includes(key.toLowerCase())));
  headers["Accept-Encoding"] = "identity";
  try {
    let url = validateUrl(value);
    for (let redirects = 0; ; redirects++) {
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const request = (url.protocol === "https:" ? https : http).get(url, { headers, signal: controller.signal }, resolve);
        request.on("error", reject);
      });
      // A redirect body is never needed. Destroy it rather than draining unbounded bytes.
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.destroy();
        if (redirects >= 5) throw new TerminalError("Invalid feed URL or redirect chain");
        let target: string;
        try { target = new URL(response.headers.location, url).href; }
        catch { throw new TerminalError("Invalid feed URL or redirect chain"); }
        url = validateUrl(target);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new (classifyHttpStatus(status))(`Feed returned HTTP ${status}`);
      }
      try {
        if (Number(response.headers["content-length"]) > maxBytes) throw new TerminalError("Feed exceeds the download size limit");
        const encoding = (response.headers["content-encoding"] ?? "identity").toLowerCase().trim();
        if (!["identity", "gzip", "deflate", ""].includes(encoding)) throw new TerminalError("Unsupported feed content encoding");
        let encoded = 0, decoded = 0;
        const chunks: Buffer[] = [];
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            encoded += chunk.length;
            callback(encoded > maxBytes ? new TerminalError("Feed exceeds the download size limit") : null, chunk);
          },
        });
        const sink = new Writable({
          write(chunk: Buffer, _encoding, callback) {
            decoded += chunk.length;
            if (decoded > maxBytes) return callback(new TerminalError("Decoded feed exceeds the download size limit"));
            chunks.push(chunk);
            callback();
          },
        });
        if (encoding === "deflate") {
          // Peek at most the first transport chunk, bounded before decompression.
          const iterator = response[Symbol.asyncIterator]();
          const first: Buffer[] = [];
          let size = 0;
          while (size < 2) {
            const part = await iterator.next();
            if (part.done) break;
            size += part.value.length;
            if (size > maxBytes) throw new TerminalError("Feed exceeds the download size limit");
            first.push(part.value);
          }
          const prefix = Buffer.concat(first);
          const wrapped = prefix.length >= 2 && (prefix[0] & 15) === 8 && ((prefix[0] << 8) + prefix[1]) % 31 === 0;
          async function* body() {
            yield prefix;
            for (;;) { const part = await iterator.next(); if (part.done) break; yield part.value as Buffer; }
          }
          await pipeline(body(), limiter, wrapped ? createInflate() : createInflateRaw(), sink, { signal: controller.signal });
        } else if (encoding === "gzip") {
          await pipeline(response, limiter, createGunzip(), sink, { signal: controller.signal });
        } else {
          await pipeline(response, limiter, sink, { signal: controller.signal });
        }
        return {
          url: url.href, content: Buffer.concat(chunks, decoded),
          headers: Object.fromEntries(Object.entries(response.headers).map(([key, val]) => [key, Array.isArray(val) ? val.join(", ") : val ?? ""])),
        };
      } finally { response.destroy(); }
    }
  } catch (error) {
    if (error instanceof TerminalError || error instanceof RetryableError) throw error;
    throw new RetryableError(controller.signal.aborted ? "Feed download exceeded its deadline" : "Feed connection or compressed body was incomplete", { cause: error });
  } finally { clearTimeout(timer); controller.abort(); }
}
