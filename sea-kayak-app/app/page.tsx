"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { motion } from "framer-motion"
import "./globals.css"
import WaveBackground from "./components/WaveBackground"
import BeachScene from "./components/BeachScene"
import { getSourceLabel, normalizeRouteData, type RouteItem } from "./lib/sources"
import { useSgtAndWeather } from "./lib/weather"
import { normalizeSeen, pickWeighted, type SeenMap } from "./lib/reading"
import { requestJson } from "./lib/request"

const SEEN_KEY = "sea-kayak:seen"
const LIVE_NEWS = "https://raw.githubusercontent.com/gongahkia/sea-kayak/main/data/routes.json"

function loadSeen(): SeenMap {
  try { return normalizeSeen(JSON.parse(window.localStorage.getItem(SEEN_KEY) || "{}")) } catch { return {} }
}

export default function Home() {
  const [routes, setRoutes] = useState<RouteItem[]>([])
  const [current, setCurrent] = useState<RouteItem | null>(null)
  const [seen, setSeen] = useState<SeenMap>({})
  const [newsError, setNewsError] = useState<string | null>(null)
  const [newsWarning, setNewsWarning] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const seenRef = useRef<SeenMap>({})
  const rerollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const infoSectionRef = useRef<HTMLDivElement>(null)
  const shorelineRef = useRef<HTMLCanvasElement>(null)
  const aboutTextRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const { sgtHour, weatherCategory, isNight } = useSgtAndWeather()
  const readArticles = useMemo(() => Object.keys(seen), [seen])
  const sourceLabel = current ? getSourceLabel(current.url, current.title) : ""

  useEffect(() => {
    const initialSeen = loadSeen()
    seenRef.current = initialSeen
    setSeen(initialSeen)
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(initialSeen)) } catch { setHistoryError(true) }

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) {
        infoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
      } else if (e.deltaY < 0) {
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
    }

    window.addEventListener("wheel", handleWheel)
    return () => { window.removeEventListener("wheel", handleWheel); clearTimeout(rerollRef.current) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setNewsError(null)
    setNewsWarning(false)
    const readNews = async (url: string) => {
      const data = await requestJson(url, { signal: controller.signal })
      if (!Array.isArray(data) || data.length > 20000) throw new Error("Invalid news snapshot")
      const items = normalizeRouteData(data)
      if (!items.length) throw new Error("No usable news")
      return items
    }
    void (async () => {
      let items: RouteItem[]
      let saved = false
      try { items = await readNews(LIVE_NEWS) } catch (error) {
        if (controller.signal.aborted) throw error
        items = await readNews("/routes.json")
        saved = true
      }
      if (controller.signal.aborted) return
      setRoutes(items)
      setCurrent(pickWeighted(items, seenRef.current))
      setNewsWarning(saved)
    })().catch(() => {
      if (!controller.signal.aborted) setNewsError("News links are unavailable. Please try again.")
    })
    return () => controller.abort()
  }, [attempt])

  const handleHover = () => {
    if (routes.length > 0) {
      setCurrent(pickWeighted(routes, seenRef.current))
    }
  }

  const recordSeen = (url: string) => {
    if (!url || url === "#") return
    const next = normalizeSeen({ ...seenRef.current, [url]: Date.now() })
    seenRef.current = next
    setSeen(next)
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)); setHistoryError(false) } catch { setHistoryError(true) }
    // Keep this activation's href intact until the browser has opened the article.
    clearTimeout(rerollRef.current)
    if (routes.length) rerollRef.current = setTimeout(() => setCurrent(pickWeighted(routes, next)), 0)
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
      <WaveBackground sgtHour={sgtHour} weatherCategory={weatherCategory} readArticles={readArticles} shorelineRef={shorelineRef} aboutTextRef={aboutTextRef} controlsRef={controlsRef} previewRef={previewRef} />

      <section className="min-h-screen flex items-center justify-center snap-start px-4 relative z-10">
        <div ref={controlsRef} className="flex flex-col items-center gap-4 md:gap-8 relative w-full max-w-md">
          <div className="relative group w-full md:w-[500px]">
            <a
              href={current?.url}
              aria-disabled={!current}
              tabIndex={current ? undefined : -1}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
              onClick={(event) => { if (current) recordSeen(current.url); else event.preventDefault() }}
            >
              <div className="neobrutalist-button-container">
                <motion.div
                  id="paddle"
                  className={`neobrutalist-button w-full h-14 md:h-16 ${btnBg} ${btnText} border-4 ${btnBorder} rounded-lg font-bold text-base md:text-lg tracking-wide md:tracking-wider relative overflow-hidden ${current ? "cursor-pointer" : "cursor-wait"}`}
                  initial={{ x: -6, y: -6 }}
                  whileHover={{ x: -3, y: -3 }}
                  whileTap={{ x: 0, y: 0 }}
                  animate={{ x: -6, y: -6 }}
                  onMouseEnter={handleHover}
                >
                  <div className="absolute inset-0 flex items-center justify-center z-10 px-2">
                    {current ? "PADDLE THE OCEAN" : newsError ? "NEWS UNAVAILABLE" : "LOADING NEWS…"}
                  </div>
                </motion.div>
                <div className={shadowClass}></div>
              </div>
            </a>
            {current && (
              <div ref={previewRef} className="hidden md:block absolute left-1/2 bottom-full mb-4 -translate-x-1/2 w-72 xl:left-full xl:ml-4 xl:top-1/2 xl:bottom-auto xl:mb-0 xl:translate-x-0 xl:-translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 pointer-events-none z-20">
                <div className="relative bg-white text-slate-900 rounded-xl shadow-lg border border-slate-200 px-4 py-3 before:content-[''] before:absolute before:left-1/2 before:-translate-x-1/2 before:-bottom-[6px] before:w-3 before:h-3 before:bg-white before:border-r before:border-b before:border-slate-200 before:rotate-45 xl:before:top-1/2 xl:before:bottom-auto xl:before:-translate-y-1/2 xl:before:-left-[6px] xl:before:translate-x-0 xl:before:border-l xl:before:border-r-0">
                  <div className="flex flex-wrap gap-1.5 mb-1.5" data-source-banner>
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wide bg-slate-700 text-white rounded px-2 py-0.5 break-all">
                      {sourceLabel}
                    </span>
                    {current.citation && (
                      <span className="text-[0.65rem] font-mono font-semibold uppercase tracking-wide bg-slate-900 text-white rounded px-2 py-0.5">
                        {current.citation}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold leading-snug">{current.title || "Open article"}</p>
                  {current.description && (
                    <p className="text-xs mt-1 text-slate-600 leading-snug line-clamp-3">
                      {current.description}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          {(newsError || newsWarning) && <div role={newsError ? "alert" : "status"} className={`text-center text-sm ${textClass}`}>
            <p>{newsError || "Showing saved news links. The latest update is unavailable."}</p>
            <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 min-w-24 px-4 underline font-semibold">TRY AGAIN</button>
          </div>}
          {historyError && <p role="status" className={`text-sm text-center ${textClass}`}>Your reading history could not be saved on this device.</p>}
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
            <p className={`text-xs italic opacity-60 tabular-nums ${textClass}`}>
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
        <div ref={aboutTextRef} className="max-w-2xl text-center space-y-4 md:space-y-6 w-full px-4">
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

        <BeachScene isNight={isNight} weatherCategory={weatherCategory} canvasRef={shorelineRef} />

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
