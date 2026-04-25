"use client"

import { useCallback, useEffect, useState } from "react"

export type WeatherCategory = "clear" | "cloudy" | "rain" | "storm"

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

export function useSgtAndWeather() {
  const [sgtHour, setSgtHour] = useState(getSGTHour)
  const [weatherCategory, setWeatherCategory] = useState<WeatherCategory>("clear")

  useEffect(() => {
    const i = setInterval(() => setSgtHour(getSGTHour()), 60_000)
    return () => clearInterval(i)
  }, [])

  const fetchWeather = useCallback(() => {
    fetch(WEATHER_API_URL)
      .then((r) => r.json())
      .then((d) => {
        const c = d?.current?.weather_code
        if (typeof c === "number") setWeatherCategory(categorizeWMO(c))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchWeather()
    const i = setInterval(fetchWeather, 30 * 60_000)
    return () => clearInterval(i)
  }, [fetchWeather])

  const isNight = sgtHour >= 18 || sgtHour < 7
  return { sgtHour, weatherCategory, isNight }
}
