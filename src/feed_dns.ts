/** Cancellable DNS keeps a stalled system lookup from outliving a feed deadline. */
import { Resolver } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";

const hosts = readFile("/etc/hosts", "utf8").then(text => {
  const entries = new Map<string, LookupAddress[]>();
  for (const line of text.split("\n")) {
    const [address, ...names] = line.split("#")[0].trim().split(/\s+/);
    const family = isIP(address ?? "");
    if (!family) continue;
    for (const name of names) {
      const key = name.toLowerCase();
      entries.set(key, [...entries.get(key) ?? [], { address, family }]);
    }
  }
  return entries;
}).catch(() => new Map<string, LookupAddress[]>());

export async function resolveFeedHost(hostname: string, family: number, signal: AbortSignal, resolver = new Resolver()): Promise<LookupAddress[]> {
  signal.throwIfAborted();
  const local = (await hosts).get(hostname.toLowerCase())?.filter(entry => !family || entry.family === family);
  signal.throwIfAborted();
  if (local?.length) return local;
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const results = await Promise.allSettled([
      ...(family !== 6 ? [resolver.resolve4(hostname).then(addresses => addresses.map(address => ({ address, family: 4 })))] : []),
      ...(family !== 4 ? [resolver.resolve6(hostname).then(addresses => addresses.map(address => ({ address, family: 6 })))] : []),
    ]);
    signal.throwIfAborted();
    const addresses = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
    if (!addresses.length) throw Object.assign(new Error(`No DNS addresses for ${hostname}`), { code: "ENOTFOUND" });
    return addresses;
  } finally { signal.removeEventListener("abort", cancel); resolver.cancel(); }
}

export function publicFeedLookup(signal: AbortSignal): LookupFunction {
  return (hostname, options, callback) => {
    const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family ?? 0;
    void resolveFeedHost(hostname, family, signal).then(addresses => {
      if (options.order === "ipv6first") addresses.sort((a, b) => b.family - a.family);
      callback(null, options.all ? addresses : addresses[0].address, addresses[0].family);
    }, error => callback(error, ""));
  };
}
