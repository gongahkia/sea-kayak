"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import WaveBackground from "../components/WaveBackground"
import BeachScene from "../components/BeachScene"
import {
  computeHealth,
  normalizeRouteData,
  type HealthStatus,
  type RouteItem,
} from "../lib/sources"
import { useSgtAndWeather } from "../lib/weather"

const STATUS_DOT: Record<HealthStatus, string> = {
  active: "bg-emerald-500",
  stale: "bg-amber-500",
  dead: "bg-rose-500",
  undated: "bg-slate-500",
}

export default function HealthPage() {
  const { sgtHour, weatherCategory, isNight } = useSgtAndWeather()
  const [items, setItems] = useState<RouteItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch("/routes.json") // DEV-ONLY: REVERT to https://raw.githubusercontent.com/gongahkia/sea-kayak/main/data/routes.json before final push
      .then((r) => r.json())
      .then((d) => setItems(normalizeRouteData(d)))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const rows = useMemo(() => computeHealth(items), [items])

  const textClass = isNight ? "text-white" : "text-sky-900"
  const subtleLinkClass = isNight
    ? "text-sky-300 hover:underline"
    : "text-indigo-500 hover:underline"
  const tableHeadBg = isNight ? "bg-slate-800/80" : "bg-white/80"
  const tableBorder = isNight ? "border-slate-700" : "border-slate-300"
  const rowBorder = isNight ? "border-slate-800" : "border-slate-200"
  const tableTextMuted = isNight ? "opacity-80" : "opacity-70"
  const containerBg = isNight ? "bg-slate-900/40" : "bg-white/40"

  return (
    <div className={`min-h-screen overflow-x-hidden relative ${textClass}`}>
      <WaveBackground sgtHour={sgtHour} weatherCategory={weatherCategory} />

      <main className="min-h-screen relative z-10 px-4 py-10 md:py-16 pb-[35vh]">
        <div className="max-w-3xl mx-auto">
          <Link href="/" className={`text-sm ${subtleLinkClass}`}>
            ← Back
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold mt-4">Source health</h1>
          <p className={`text-sm mt-1 mb-6 ${tableTextMuted}`}>
            Per-publisher freshness across {items.length} routes.
          </p>

          {!loaded ? (
            <p className={`text-sm ${tableTextMuted}`}>Loading…</p>
          ) : rows.length === 0 ? (
            <p className={`text-sm ${tableTextMuted}`}>No data.</p>
          ) : (
            <div
              className={`border ${tableBorder} ${containerBg} backdrop-blur-sm rounded-lg overflow-hidden`}
            >
              <table className="w-full text-sm">
                <thead className={`${tableHeadBg} text-left`}>
                  <tr>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium text-right">Routes</th>
                    <th className="px-3 py-2 font-medium text-right">Latest</th>
                    <th className="px-3 py-2 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name} className={`border-t ${rowBorder}`}>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${tableTextMuted}`}
                      >
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

          <p className={`text-xs mt-4 leading-relaxed ${tableTextMuted}`}>
            Active = latest article ≤ 7 days. Stale = ≤ 30 days. Dead = older. Undated = no
            publish date in feed (typical for scraped non-RSS sources).
          </p>
        </div>
      </main>

      <BeachScene isNight={isNight} weatherCategory={weatherCategory} />

      <div
        className={`absolute bottom-4 md:bottom-8 text-sm text-center w-full px-4 z-10 ${
          isNight ? "text-white" : "text-sky-900"
        }`}
      >
        <p className="text-xs md:text-sm">
          Source code{" "}
          <a
            href="https://github.com/gongahkia/sea-kayak"
            target="_blank"
            rel="noopener noreferrer"
            className={subtleLinkClass}
          >
            here
          </a>
          {" · "}
          <a href="/health" className={subtleLinkClass}>
            Source health
          </a>
          .
        </p>
        <p className="mt-2 md:mt-4 text-[0.7rem] md:text-xs">
          &copy; 2025 Sea Kayak. All rights reserved.
        </p>
      </div>
    </div>
  )
}
