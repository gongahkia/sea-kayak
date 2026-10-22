"use client"

import { useEffect, useState } from "react"

import { getSgtHour } from "./clock"
import { requestJson } from "./request"

export type WeatherCategory = "clear" | "cloudy" | "rain" | "storm"

function categorizeWMO(code: number): WeatherCategory {
  if (code <= 1) return "clear"
  if (code <= 48) return "cloudy"
  if (code <= 82) return "rain"
  if (code >= 95) return "storm"
  return "clear"
}

const WEATHER_API_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=1.3521&longitude=103.8198&current=weather_code,is_day&timezone=Asia/Singapore"

export function useSgtAndWeather() {
  const [sgtHour, setSgtHour] = useState(12)
  const [weatherCategory, setWeatherCategory] = useState<WeatherCategory>("clear")

  useEffect(() => {
    setSgtHour(getSgtHour())
    const i = setInterval(() => setSgtHour(getSgtHour()), 60_000)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    let current: AbortController | undefined
    let disposed = false
    const update = async () => {
      current?.abort()
      current = new AbortController()
      try {
        const raw = await requestJson(WEATHER_API_URL, { signal: current.signal, timeoutMs: 5000, maxBytes: 65536 }) as { current?: { weather_code?: unknown } }
        const code = raw?.current?.weather_code
        if (!disposed && typeof code === "number" && Number.isInteger(code) && code >= 0 && code <= 99) setWeatherCategory(categorizeWMO(code))
      } catch { /* Keep the last usable weather when unavailable. */ }
    }
    void update()
    const interval = setInterval(() => void update(), 30 * 60_000)
    return () => { disposed = true; current?.abort(); clearInterval(interval) }
  }, [])

  const isNight = sgtHour >= 18 || sgtHour < 7
  return { sgtHour, weatherCategory, isNight }
}
