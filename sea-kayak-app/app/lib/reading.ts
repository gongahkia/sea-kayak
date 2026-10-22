import type { RouteItem } from "./sources"

export type SeenMap = Record<string, number>

export function normalizeSeen(value: unknown, now = Date.now()): SeenMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const entries = Object.entries(value).filter(([url, timestamp]) => {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp > now || timestamp < now - 7 * 24 * 3_600_000) return false
    try {
      const parsed = new URL(url)
      return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password
    } catch { return false }
  }).sort((a, b) => b[1] - a[1]).slice(0, 5000)
  return Object.fromEntries(entries)
}

export function baseWeight(item: RouteItem, now = Date.now()): number {
  const published = item.published ? Date.parse(item.published) : NaN
  if (!Number.isFinite(published)) return 1
  const age = (now - published) / 3_600_000
  if (age < 0) return 1
  return age <= 48 ? 10 : age <= 168 ? 4 : age <= 720 ? 2 : 1
}

export function pickWeighted(items: RouteItem[], seen: SeenMap = {}, now = Date.now(), random = Math.random): RouteItem {
  if (!items.length) throw new Error("No usable news links")
  const unseen = items.filter(item => !seen[item.url])
  const pool = unseen.length ? unseen : items
  const weights = pool.map(item => baseWeight(item, now))
  let remaining = random() * weights.reduce((a, b) => a + b, 0)
  for (let index = 0; index < pool.length; index++) {
    if (remaining < weights[index]) return pool[index]
    remaining -= weights[index]
  }
  return pool[pool.length - 1]
}
