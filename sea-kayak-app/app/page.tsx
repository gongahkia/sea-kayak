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

export default function Home() {
  const [routes, setRoutes] = useState<string[]>([])
  const [randomUrl, setRandomUrl] = useState("#")
  const infoSectionRef = useRef<HTMLDivElement>(null)

  const [sgtHour, setSgtHour] = useState(22) // TEMP: forced to 10pm for night preview
  const [weatherCategory, setWeatherCategory] = useState<WeatherCategory>("clear") // TEMP: forced for preview

  const isNight = true // TEMP: forced night mode for preview

  useEffect(() => {
    fetch("https://raw.githubusercontent.com/gongahkia/sea-kayak/main/data/routes.json")
      .then((response) => response.json())
      .then((data) => {
        type RouteItem = { url: string }
        const routesArray = Array.isArray(data)
          ? typeof data[0] === "string"
            ? data
            : data.map((item: RouteItem) => item.url)
          : []
        setRoutes(routesArray)
        if (routesArray.length > 0) {
          setRandomUrl(routesArray[Math.floor(Math.random() * routesArray.length)])
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
      setRandomUrl(routes[Math.floor(Math.random() * routes.length)])
    }
  }

  const scrollToInfo = () => {
    infoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const textClass = isNight ? "text-sky-100" : "text-sky-900"
  const linkClass = isNight
    ? "text-sky-300 hover:underline font-medium"
    : "text-indigo-600 md:text-indigo-500 hover:underline font-medium"
  const subtleLinkClass = isNight
    ? "text-sky-300 hover:underline"
    : "text-indigo-500 hover:underline"
  const btnBorder = isNight ? "border-slate-600" : "border-black"
  const btnText = isNight ? "text-sky-100" : "text-black"
  const btnBg = isNight ? "bg-slate-800" : "bg-white"
  const shadowClass = isNight ? "neobrutalist-button-shadow-night" : "neobrutalist-button-shadow"

  return (
    <div className="min-h-screen overflow-y-auto overflow-x-hidden snap-y snap-mandatory">
      <WaveBackground sgtHour={sgtHour} weatherCategory={weatherCategory} />

      <section className="min-h-screen flex items-center justify-center snap-start px-4 relative z-10">
        <div className="flex flex-col items-center gap-4 md:gap-8 relative w-full max-w-md">
          <a
            href={randomUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full md:w-[500px]"
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
        </div>
      </section>

      <section
        ref={infoSectionRef}
        className={`min-h-screen flex flex-col items-center justify-center ${textClass} relative snap-start px-4 py-16 z-10`}
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

        <div className="absolute bottom-4 md:bottom-8 text-sm text-center w-full px-4 z-10" style={{ textShadow: isNight ? "0 1px 4px rgba(0,0,0,0.6)" : "0 1px 3px rgba(255,255,255,0.7)" }}>
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
