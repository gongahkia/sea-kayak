"use client"

import { useRef, useEffect } from "react"

type WeatherCategory = "clear" | "cloudy" | "rain" | "storm"

interface WaveBackgroundProps {
  sgtHour: number
  weatherCategory: WeatherCategory
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpColor(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => Math.round(lerp(v, b[i], t)))
}

const PALETTES = {
  night: {
    bg: [
      [10, 15, 40],
      [20, 30, 65],
      [15, 22, 50],
    ],
  },
  dawn: {
    bg: [
      [255, 175, 125],
      [245, 150, 160],
      [180, 195, 245],
    ],
  },
  day: {
    bg: [
      [186, 230, 253],
      [155, 215, 248],
      [164, 232, 242],
    ],
  },
  dusk: {
    bg: [
      [240, 135, 95],
      [175, 95, 155],
      [50, 50, 115],
    ],
  },
}

function getBgForHour(hour: number): number[][] {
  if (hour >= 6 && hour < 7.5) {
    const t = (hour - 6) / 1.5
    if (t < 0.5) {
      const b = t * 2
      return PALETTES.night.bg.map((c, i) => lerpColor(c, PALETTES.dawn.bg[i], b))
    }
    const b = (t - 0.5) * 2
    return PALETTES.dawn.bg.map((c, i) => lerpColor(c, PALETTES.day.bg[i], b))
  }
  if (hour >= 7.5 && hour < 18) return PALETTES.day.bg
  if (hour >= 18 && hour < 19.5) {
    const t = (hour - 18) / 1.5
    if (t < 0.5) {
      const b = t * 2
      return PALETTES.day.bg.map((c, i) => lerpColor(c, PALETTES.dusk.bg[i], b))
    }
    const b = (t - 0.5) * 2
    return PALETTES.dusk.bg.map((c, i) => lerpColor(c, PALETTES.night.bg[i], b))
  }
  return PALETTES.night.bg
}

interface Crest {
  x: number
  y: number
  driftSpeed: number
  size: number
  baseOpacity: number
  wobblePhaseX: number
  wobbleFreqX: number
  wobbleAmpX: number
  wobblePhaseY: number
  wobbleFreqY: number
  wobbleAmpY: number
  life: number
  fadeIn: number
  fadeOutStart: number
  maxLife: number
}

function spawnCrest(w: number, h: number): Crest {
  const maxLife = 200 + Math.random() * 400
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    driftSpeed: 0.08 + Math.random() * 0.25,
    size: 10 + Math.random() * 16,
    baseOpacity: 0.15 + Math.random() * 0.2,
    wobblePhaseX: Math.random() * Math.PI * 2,
    wobbleFreqX: 0.15 + Math.random() * 0.35,
    wobbleAmpX: 8 + Math.random() * 14,
    wobblePhaseY: Math.random() * Math.PI * 2,
    wobbleFreqY: 0.1 + Math.random() * 0.25,
    wobbleAmpY: 3 + Math.random() * 6,
    life: 0,
    fadeIn: 40 + Math.random() * 60,
    fadeOutStart: maxLife * (0.6 + Math.random() * 0.25),
    maxLife,
  }
}

export default function WaveBackground({ sgtHour, weatherCategory }: WaveBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({ sgtHour, weatherCategory })
  stateRef.current = { sgtHour, weatherCategory }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animId: number
    let time = 0

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    const CREST_COUNT = 120
    const w0 = window.innerWidth
    const h0 = window.innerHeight
    const crests: Crest[] = Array.from({ length: CREST_COUNT }, () => {
      const c = spawnCrest(w0, h0)
      c.life = Math.random() * c.maxLife * 0.8
      return c
    })

    let ripples: Array<{
      x: number; y: number
      radius: number; maxRadius: number
      expandSpeed: number; opacity: number
    }> = []
    let prevWeather = ""
    let flashOpacity = 0
    let nextFlash = Infinity

    const spawnRipple = (w: number, h: number) => ({
      x: Math.random() * w,
      y: Math.random() * h,
      radius: 0,
      maxRadius: 6 + Math.random() * 10,
      expandSpeed: 0.3 + Math.random() * 0.5,
      opacity: 0.3 + Math.random() * 0.25,
    })

    const draw = (timestamp: number) => {
      time += 0.008
      const { sgtHour: hour, weatherCategory: weather } = stateRef.current
      const w = window.innerWidth
      const h = window.innerHeight

      if (weather !== prevWeather) {
        prevWeather = weather
        const count = weather === "storm" ? 180 : weather === "rain" ? 80 : 0
        ripples = Array.from({ length: count }, () => {
          const r = spawnRipple(w, h)
          r.radius = Math.random() * r.maxRadius
          return r
        })
        if (weather === "storm") {
          nextFlash = timestamp + 3000 + Math.random() * 7000
        } else {
          nextFlash = Infinity
          flashOpacity = 0
        }
      }

      ctx.clearRect(0, 0, w, h)

      const bg = getBgForHour(hour)

      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, `rgb(${bg[0].join(",")})`)
      grad.addColorStop(0.5, `rgb(${bg[1].join(",")})`)
      grad.addColorStop(1, `rgb(${bg[2].join(",")})`)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)

      if (weather === "cloudy") {
        ctx.fillStyle = "rgba(140,150,165,0.18)"
        ctx.fillRect(0, 0, w, h)
      }

      // Draw "(" crest particles with fade lifecycle and organic undulation
      ctx.textBaseline = "middle"
      ctx.textAlign = "center"
      for (const c of crests) {
        c.life += 1
        // Fade in / out opacity
        let alpha = c.baseOpacity
        if (c.life < c.fadeIn) {
          alpha *= c.life / c.fadeIn
        } else if (c.life > c.fadeOutStart) {
          alpha *= 1 - (c.life - c.fadeOutStart) / (c.maxLife - c.fadeOutStart)
        }
        // Compound wobble for organic wave motion
        const wx =
          Math.sin(time * c.wobbleFreqX + c.wobblePhaseX) * c.wobbleAmpX +
          Math.sin(time * c.wobbleFreqX * 0.6 + c.wobblePhaseX * 1.4) * c.wobbleAmpX * 0.4
        const wy =
          Math.sin(time * c.wobbleFreqY + c.wobblePhaseY) * c.wobbleAmpY
        ctx.save()
        ctx.translate(c.x + wx, c.y + wy)
        ctx.rotate(Math.PI / 2)
        ctx.font = `bold ${c.size}px Arial, sans-serif`
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, alpha)})`
        ctx.fillText("(", 0, 0)
        ctx.restore()
        c.y -= c.driftSpeed
        // Respawn when life expires or drifts off screen
        if (c.life >= c.maxLife || c.y < -c.size * 2) {
          const fresh = spawnCrest(w, h)
          Object.assign(c, fresh)
        }
      }

      // Rain
      if (weather === "rain" || weather === "storm") {
        const isNightish = hour >= 19 || hour < 6.5
        ctx.strokeStyle = isNightish ? "rgba(180,200,255,0.35)" : "rgba(100,130,200,0.4)"
        ctx.lineWidth = 1.5
        for (const drop of drops) {
          ctx.beginPath()
          ctx.moveTo(drop.x, drop.y)
          ctx.lineTo(drop.x + 1.5, drop.y + drop.length)
          ctx.stroke()
          drop.y += drop.speed
          if (drop.y > h) {
            drop.y = -drop.length
            drop.x = Math.random() * w
          }
        }
      }

      // Thunder flash
      if (weather === "storm") {
        if (timestamp >= nextFlash) {
          flashOpacity = 0.35
          nextFlash = timestamp + 4000 + Math.random() * 8000
        }
        if (flashOpacity > 0) {
          ctx.fillStyle = `rgba(255,255,255,${flashOpacity})`
          ctx.fillRect(0, 0, w, h)
          flashOpacity *= 0.82
          if (flashOpacity < 0.01) flashOpacity = 0
        }
      }

      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener("resize", resize)
      cancelAnimationFrame(animId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  )
}
