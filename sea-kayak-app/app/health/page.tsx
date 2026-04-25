"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { getSource, normalizeRouteData, type RouteItem } from "../lib/sources"

type Status = "active" | "stale" | "dead" | "undated"
type SourceHealth = {
  name: string
  count: number
  ageDays: number | null
  status: Status
}

function statusFor(ageDays: number | null): Status {
  if (ageDays === null) return "undated"
  if (ageDays <= 7) return "active"
  if (ageDays <= 30) return "stale"
  return "dead"
}

const STATUS_DOT: Record<Status, string> = {
  active: "bg-emerald-500",
  stale: "bg-amber-500",
  dead: "bg-rose-500",
  undated: "bg-slate-500",
}

const STATUS_RANK: Record<Status, number> = {
  active: 0,
  stale: 1,
  undated: 2,
  dead: 3,
}

export default function HealthPage() {
  const [items, setItems] = useState<RouteItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch("/routes.json") // DEV-ONLY: REVERT to https://raw.githubusercontent.com/gongahkia/sea-kayak/main/data/routes.json before final push
      .then((r) => r.json())
      .then((d) => setItems(normalizeRouteData(d)))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const rows: SourceHealth[] = useMemo(() => {
    const groups = new Map<string, RouteItem[]>()
    for (const it of items) {
      const s = getSource(it.url, it.title) || "(unknown)"
      const arr = groups.get(s)
      if (arr) arr.push(it)
      else groups.set(s, [it])
    }
    const now = Date.now()
    const out: SourceHealth[] = []
    for (const [name, list] of groups.entries()) {
      let latest: number | null = null
      for (const it of list) {
        if (!it.published) continue
        const t = Date.parse(it.published)
        if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t
      }
      const ageDays = latest === null ? null : Math.floor((now - latest) / 86_400_000)
      out.push({ name, count: list.length, ageDays, status: statusFor(ageDays) })
    }
    out.sort((a, b) => {
      const r = STATUS_RANK[a.status] - STATUS_RANK[b.status]
      if (r !== 0) return r
      return b.count - a.count
    })
    return out
  }, [items])

  return (
    <main className="min-h-screen bg-[#0a0f28] text-white px-4 py-10 md:py-16">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-sky-300 hover:underline text-sm">
          ← Back
        </Link>
        <h1 className="text-2xl md:text-3xl font-bold mt-4">Source health</h1>
        <p className="text-sm opacity-70 mt-1 mb-6">
          Per-publisher freshness across {items.length} routes.
        </p>

        {!loaded ? (
          <p className="text-sm opacity-60">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm opacity-60">No data.</p>
        ) : (
          <div className="border border-slate-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium text-right">Routes</th>
                  <th className="px-3 py-2 font-medium text-right">Latest</th>
                  <th className="px-3 py-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-t border-slate-800">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums opacity-80">
                      {r.ageDays === null
                        ? "—"
                        : r.ageDays === 0
                          ? "today"
                          : r.ageDays === 1
                            ? "1d ago"
                            : `${r.ageDays}d ago`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[r.status]} mr-1.5 align-middle`}
                      />
                      <span className="capitalize text-xs">{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs opacity-50 mt-4 leading-relaxed">
          Active = latest article ≤ 7 days. Stale = ≤ 30 days. Dead = older. Undated = no
          publish date in feed (typical for scraped non-RSS sources).
        </p>
      </div>
    </main>
  )
}
