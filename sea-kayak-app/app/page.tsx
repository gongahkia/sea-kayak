"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion } from "framer-motion"
import "./globals.css"
import WaveBackground from "./components/WaveBackground"
import BeachScene from "./components/BeachScene"

type WeatherCategory = "clear" | "cloudy" | "rain" | "storm"

function getSGTHour(): number {
  const now = new Date()
  const sgt = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Singapore" }))
  return sgt.getHours() + sgt.getMinutes() / 60
}

function categorizeWMO(code: number): WeatherCategory {
  if (code <= 1) return "clear"
  if (code <= 48) return "cloudy"
  if (code <= 82) return "rain"
  if (code >= 95) return "storm"
  return "clear"
}

const WEATHER_API_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=1.3521&longitude=103.8198&current=weather_code,is_day&timezone=Asia/Singapore"

type RouteItem = {
  url: string
  title: string
  description: string
  published?: string
  citation?: string
}
type SeenMap = Record<string, number> // url -> ms timestamp paddled

const SEEN_KEY = "sea-kayak:seen"
const SEEN_TTL_HOURS = 24 * 7 // 7 days

function loadSeen(): SeenMap {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(SEEN_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed ? (parsed as SeenMap) : {}
  } catch {
    return {}
  }
}

function pruneSeen(m: SeenMap, ttlHours: number): SeenMap {
  const cutoff = Date.now() - ttlHours * 3_600_000
  const out: SeenMap = {}
  for (const [k, v] of Object.entries(m)) if (v >= cutoff) out[k] = v
  return out
}

function saveSeen(m: SeenMap) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(m))
  } catch {}
}

function getSource(url: string): string {
  try {
    const u = new URL(url)
    const h = u.hostname.replace(/^www\./, "").toLowerCase()
    const path = u.pathname.toLowerCase()
    if (h.endsWith("singaporelawwatch.sg")) return "Singapore Law Watch"
    if (h.endsWith("mlaw.gov.sg")) return "MinLaw"
    if (h.endsWith("mas.gov.sg")) return "MAS"
    if (h.endsWith("agc.gov.sg")) return "AGC"
    if (h.endsWith("allenandgledhill.com")) return "Allen & Gledhill"
    if (h.endsWith("wongpartnership.com")) return "WongPartnership"
    if (h.endsWith("withersworldwide.com")) return "Withers"
    if (h.endsWith("dentons.rodyk.com") || h.endsWith("rodyk.com")) return "Dentons Rodyk"
    if (h.endsWith("twobirds.com")) return "Bird & Bird"
    if (h.endsWith("harryelias.com")) return "Harry Elias"
    if (h.endsWith("leenlee.com.sg")) return "Lee & Lee"
    if (h.endsWith("lawgazette.com.sg")) return "Law Gazette"
    if (h.endsWith("singaporeinternationalarbitration.wordpress.com") ||
        h.endsWith("singaporeinternationalarbitration.com")) return "SG Arbitration Blog"
    if (h.endsWith("lexology.com")) return "Lexology"
    if (h.endsWith("blog.nus.edu.sg")) return "NUS Law Research"
    if (h.endsWith("law.nus.edu.sg")) return "NUS Law"
    if (h.endsWith("journalsonline.academypublishing.org.sg")) return "SAL Academy"
    if (h.endsWith("academypublishing.org.sg")) return "SAL Academy"
    if (h.endsWith("events.sal.sg")) return "SAL Events"
    if (h.endsWith("sal.org.sg")) return "SAL"
    if (h.endsWith("store.lawnet.com") || h.endsWith("lawnet.com")) return "LawNet"
    if (h.endsWith("hungryhippo.huey.xyz")) {
      if (path.includes("sal-practitioner")) return "SAL Practitioner"
      if (path.includes("sal-journal")) return "SAL Journal"
      if (path.includes("law.nus.edu.sg/trail")) return "NUS TRAIL"
      return ""
    }
    return ""
  } catch {
    return ""
  }
}

function baseWeight(it: RouteItem): number {
  if (!it.published) return 1
  const t = Date.parse(it.published)
  if (Number.isNaN(t)) return 1
  const ageH = (Date.now() - t) / 3_600_000
  if (ageH < 0) return 1
  if (ageH <= 48) return 10
  if (ageH <= 168) return 4
  if (ageH <= 720) return 2
  return 1
}

function pickWeighted(items: RouteItem[], seen: SeenMap = {}): RouteItem {
  if (items.length === 0) throw new Error("pickWeighted: empty list")
  // primary pass: zero-weight already-seen items so we explore unseen first
  let weights = items.map((it) => (seen[it.url] ? 0 : baseWeight(it)))
  let total = weights.reduce((a, b) => a + b, 0)
  if (total === 0) {
    // exhausted unseen pool — fall back to baseline weights (ignore seen)
    weights = items.map(baseWeight)
    total = weights.reduce((a, b) => a + b, 0)
  }
  let r = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

export default function Home() {
  const [routes, setRoutes] = useState<RouteItem[]>([])
  const [current, setCurrent] = useState<RouteItem>({ url: "#", title: "", description: "" })
  const [seen, setSeen] = useState<SeenMap>({})
  const infoSectionRef = useRef<HTMLDivElement>(null)

  const [sgtHour, setSgtHour] = useState(getSGTHour)
  const [weatherCategory, setWeatherCategory] = useState<WeatherCategory>("clear")

  const isNight = sgtHour >= 18 || sgtHour < 7

  useEffect(() => {
    const initialSeen = pruneSeen(loadSeen(), SEEN_TTL_HOURS)
    setSeen(initialSeen)
    saveSeen(initialSeen) // persist pruned map

    fetch("/routes.json") // DEV-ONLY: REVERT to https://raw.githubusercontent.com/gongahkia/sea-kayak/main/data/routes.json before final push
      .then((response) => response.json())
      .then((data) => {
        const items: RouteItem[] = Array.isArray(data)
          ? data.map((d: unknown): RouteItem =>
              typeof d === "string"
                ? { url: d, title: "", description: "", published: "", citation: "" }
                : {
                    url: (d as RouteItem).url,
                    title: (d as RouteItem).title || "",
                    description: (d as RouteItem).description || "",
                    published: (d as RouteItem).published || "",
                    citation: (d as RouteItem).citation || "",
                  },
            )
          : []
        setRoutes(items)
        if (items.length > 0) {
          setCurrent(pickWeighted(items, initialSeen))
        }
      })
      .catch(console.error)

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) {
        infoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
      } else if (e.deltaY < 0) {
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
    }

    window.addEventListener("wheel", handleWheel)
    return () => window.removeEventListener("wheel", handleWheel)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setSgtHour(getSGTHour())
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  const fetchWeather = useCallback(() => {
    fetch(WEATHER_API_URL)
      .then((r) => r.json())
      .then((data) => {
        const code = data?.current?.weather_code
        if (typeof code === "number") {
          setWeatherCategory(categorizeWMO(code))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchWeather()
    const interval = setInterval(fetchWeather, 30 * 60_000)
    return () => clearInterval(interval)
  }, [fetchWeather])

  const handleHover = () => {
    if (routes.length > 0) {
      setCurrent(pickWeighted(routes, seen))
    }
  }

  const recordSeen = (url: string) => {
    if (!url || url === "#") return
    const next = { ...seen, [url]: Date.now() }
    setSeen(next)
    saveSeen(next)
  }

  const seenCount = Object.keys(seen).length

  const scrollToInfo = () => {
    infoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const textShadow = "none" // v1: no glow
  const textClass = isNight ? "text-white" : "text-sky-900"
  const linkClass = isNight
    ? "text-sky-300 hover:underline font-medium"
    : "text-indigo-600 md:text-indigo-500 hover:underline font-medium"
  const subtleLinkClass = isNight
    ? "text-sky-300 hover:underline"
    : "text-indigo-500 hover:underline"
  const btnBorder = isNight ? "border-slate-600" : "border-black"
  const btnText = isNight ? "text-sky-100" : "text-black"
  const btnBg = isNight ? "bg-slate-800/90" : "bg-white/90"
  const shadowClass = isNight ? "neobrutalist-button-shadow-night" : "neobrutalist-button-shadow"

  return (
    <div className="min-h-screen overflow-y-auto overflow-x-hidden snap-y snap-mandatory">
      <WaveBackground sgtHour={sgtHour} weatherCategory={weatherCategory} />

      <section className="min-h-screen flex items-center justify-center snap-start px-4 relative z-10">
        <div className="flex flex-col items-center gap-4 md:gap-8 relative w-full max-w-md">
          <div className="relative group w-full md:w-[500px]">
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full"
              onClick={() => recordSeen(current.url)}
            >
              <div className="neobrutalist-button-container">
                <motion.div
                  id="paddle"
                  className={`neobrutalist-button w-full h-14 md:h-16 ${btnBg} ${btnText} border-4 ${btnBorder} rounded-lg font-bold text-base md:text-lg tracking-wide md:tracking-wider relative overflow-hidden cursor-pointer`}
                  initial={{ x: -6, y: -6 }}
                  whileHover={{ x: -3, y: -3 }}
                  whileTap={{ x: 0, y: 0 }}
                  animate={{ x: -6, y: -6 }}
                  onMouseEnter={handleHover}
                >
                  <div className="absolute inset-0 flex items-center justify-center z-10 px-2">
                    PADDLE THE OCEAN
                  </div>
                </motion.div>
                <div className={shadowClass}></div>
              </div>
            </a>
            {current.title && (
              <div className="hidden md:block absolute left-full ml-4 top-1/2 -translate-y-1/2 w-72 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-20">
                <div className="relative bg-white text-slate-900 rounded-xl shadow-lg border border-slate-200 px-4 py-3 before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:-left-[6px] before:w-3 before:h-3 before:bg-white before:border-l before:border-b before:border-slate-200 before:rotate-45">
                  {(getSource(current.url) || current.citation) && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {getSource(current.url) && (
                        <span className="text-[0.65rem] font-semibold uppercase tracking-wide bg-slate-700 text-white rounded px-2 py-0.5">
                          {getSource(current.url)}
                        </span>
                      )}
                      {current.citation && (
                        <span className="text-[0.65rem] font-mono font-semibold uppercase tracking-wide bg-slate-900 text-white rounded px-2 py-0.5">
                          {current.citation}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="text-sm font-semibold leading-snug">{current.title}</p>
                  {current.description && (
                    <p className="text-xs mt-1 text-slate-600 leading-snug line-clamp-3">
                      {current.description}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex w-full md:w-[500px] gap-4">
            <div className="neobrutalist-button-container w-1/2">
              <motion.button
                id="island"
                className={`neobrutalist-button w-full h-14 md:h-16 ${btnBg} ${btnText} border-4 ${btnBorder} rounded-lg font-bold text-base md:text-lg tracking-wide md:tracking-wider relative overflow-hidden cursor-pointer`}
                initial={{ x: -6, y: -6 }}
                whileHover={{ x: -3, y: -3 }}
                whileTap={{ x: 0, y: 0 }}
                animate={{ x: -6, y: -6 }}
                onClick={() =>
                  window.open("https://github.com/gongahkia/sea-kayak#coverage", "_blank")
                }
              >
                <div className="absolute inset-0 flex items-center justify-center z-10">
                  ADD AN ISLAND
                </div>
              </motion.button>
              <div className={shadowClass}></div>
            </div>
            <div className="neobrutalist-button-container w-1/2">
              <motion.button
                id="info"
                className={`neobrutalist-button w-full h-14 md:h-16 ${btnBg} ${btnText} border-4 ${btnBorder} rounded-lg font-bold text-base md:text-lg tracking-wide md:tracking-wider relative overflow-hidden cursor-pointer`}
                initial={{ x: -6, y: -6 }}
                whileHover={{ x: -3, y: -3 }}
                whileTap={{ x: 0, y: 0 }}
                animate={{ x: -6, y: -6 }}
                onClick={scrollToInfo}
              >
                <div className="absolute inset-0 flex items-center justify-center z-10">INFO</div>
              </motion.button>
              <div className={shadowClass}></div>
            </div>
          </div>
          {seenCount > 0 && (
            <p className={`text-xs italic opacity-60 ${textClass}`}>
              Paddled {seenCount} {seenCount === 1 ? "article" : "articles"} in the last 7 days
            </p>
          )}
        </div>
      </section>

      <section
        ref={infoSectionRef}
        className={`min-h-screen flex flex-col items-center justify-center ${textClass} relative snap-start px-4 py-16 z-10`}
        style={{ textShadow }}
      >
        <div className="max-w-2xl text-center space-y-4 md:space-y-6 w-full px-4">
          <p className="text-base md:text-lg leading-relaxed">
            The internet was supposed to make our lives easier.
            <br />
            <br />
            These days, there is just too much noise out there.
            <br />
            <br />
            Navigating the modern web for <i>timely legal news</i> has become an unnecessarily
            daunting task.
            <br />
            <br />
            <code className={isNight ? "text-sky-200" : ""}>Sea Kayak</code> is my attempt to
            restore some sanity to the web.
            <br />
            <br />
            Have a good time out there, Sea Kayaker.
            <br />
            <br />
            ~{" "}
            <a href="https://gabrielongzm.com" className={linkClass}>
              Gabriel Ong
            </a>
          </p>
        </div>

        <BeachScene isNight={isNight} weatherCategory={weatherCategory} />

        <div className={`absolute bottom-4 md:bottom-8 text-sm text-center w-full px-4 z-10 ${isNight ? "text-white" : "text-sky-900"}`}>
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
            .
          </p>
          <p className="mt-2 md:mt-4 text-[0.7rem] md:text-xs">
            &copy; 2025 Sea Kayak. All rights reserved.
          </p>
        </div>
      </section>
    </div>
  )
}
