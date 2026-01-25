"use client"

import { useRef, useEffect } from "react"

interface BeachSceneProps {
  isNight: boolean
}

export default function BeachScene({ isNight }: BeachSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const w = rect.width
      const h = rect.height
      ctx.clearRect(0, 0, w, h)

      const shoreY = h * 0.22

      // Wavy shore function with compound sine
      const shoreWave = (x: number, offset: number) =>
        shoreY +
        offset +
        Math.sin(x * 0.011) * 15 +
        Math.sin(x * 0.006 + 1.5) * 22 +
        Math.sin(x * 0.02 + 3) * 7

      // --- Wet sand strip ---
      ctx.beginPath()
      for (let x = 0; x <= w; x += 2) {
        const y = shoreWave(x, -10)
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineTo(w, h)
      ctx.lineTo(0, h)
      ctx.closePath()
      const wetGrad = ctx.createLinearGradient(0, shoreY - 10, 0, shoreY + 50)
      if (isNight) {
        wetGrad.addColorStop(0, "rgba(45, 55, 60, 0.9)")
        wetGrad.addColorStop(1, "rgb(60, 52, 38)")
      } else {
        wetGrad.addColorStop(0, "rgba(185, 200, 195, 0.9)")
        wetGrad.addColorStop(1, "rgb(230, 210, 172)")
      }
      ctx.fillStyle = wetGrad
      ctx.fill()

      // --- Dry sand ---
      const dryGrad = ctx.createLinearGradient(0, shoreY + 40, 0, h)
      if (isNight) {
        dryGrad.addColorStop(0, "rgb(60, 52, 38)")
        dryGrad.addColorStop(1, "rgb(50, 44, 32)")
      } else {
        dryGrad.addColorStop(0, "rgb(238, 214, 175)")
        dryGrad.addColorStop(1, "rgb(225, 200, 158)")
      }
      ctx.fillStyle = dryGrad
      ctx.fillRect(0, shoreY + 40, w, h - shoreY - 40)

      // --- Foam bands ---
      const foams = [
        { offset: -14, width: 20, opacity: isNight ? 0.2 : 0.55 },
        { offset: -4, width: 14, opacity: isNight ? 0.3 : 0.7 },
        { offset: 6, width: 10, opacity: isNight ? 0.18 : 0.45 },
        { offset: 16, width: 6, opacity: isNight ? 0.1 : 0.28 },
      ]
      for (const f of foams) {
        ctx.beginPath()
        for (let x = 0; x <= w; x += 2) {
          const y = shoreWave(x, f.offset)
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        for (let x = w; x >= 0; x -= 2) {
          ctx.lineTo(x, shoreWave(x, f.offset + f.width))
        }
        ctx.closePath()
        ctx.fillStyle = `rgba(255,255,255,${f.opacity})`
        ctx.fill()
      }

      // --- Helper: map a 0-1 fraction to the sand area ---
      const sandTop = shoreY + 45
      const sandH = h - sandTop
      const mapY = (frac: number) => sandTop + frac * sandH

      // --- Beach umbrellas (top-down) ---
      const umbrellas = [
        { x: 0.1, y: 0.1, r: 22, c: "#e74c3c" },
        { x: 0.35, y: 0.38, r: 26, c: "#3498db" },
        { x: 0.6, y: 0.12, r: 20, c: "#f1c40f" },
        { x: 0.87, y: 0.28, r: 24, c: "#2ecc71" },
        { x: 0.2, y: 0.62, r: 18, c: "#e91e63" },
        { x: 0.5, y: 0.55, r: 22, c: "#9b59b6" },
        { x: 0.76, y: 0.52, r: 20, c: "#ff9800" },
      ]

      for (const u of umbrellas) {
        const ux = u.x * w
        const uy = mapY(u.y)
        const segments = 8

        // Shadow
        ctx.save()
        ctx.beginPath()
        ctx.ellipse(ux + 5, uy + 5, u.r * 1.05, u.r * 0.75, 0.3, 0, Math.PI * 2)
        ctx.fillStyle = isNight ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.1)"
        ctx.fill()
        ctx.restore()

        // Segments
        for (let i = 0; i < segments; i++) {
          ctx.beginPath()
          ctx.moveTo(ux, uy)
          ctx.arc(
            ux,
            uy,
            u.r,
            (i / segments) * Math.PI * 2,
            ((i + 1) / segments) * Math.PI * 2
          )
          ctx.closePath()
          const baseColor = i % 2 === 0 ? u.c : "#ffffff"
          ctx.globalAlpha = isNight ? 0.4 : 1
          ctx.fillStyle = baseColor
          ctx.fill()
          ctx.globalAlpha = 1
        }

        // Rim
        ctx.beginPath()
        ctx.arc(ux, uy, u.r, 0, Math.PI * 2)
        ctx.strokeStyle = isNight ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.08)"
        ctx.lineWidth = 1
        ctx.stroke()

        // Pole dot
        ctx.beginPath()
        ctx.arc(ux, uy, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = isNight ? "#333" : "#5d4e37"
        ctx.fill()
      }

      // --- Palm trees (top-down) ---
      const palms = [
        { x: 0.05, y: 0.02, s: 32 },
        { x: 0.45, y: 0.06, s: 36 },
        { x: 0.93, y: 0.08, s: 28 },
        { x: 0.25, y: 0.72, s: 34 },
        { x: 0.7, y: 0.68, s: 28 },
      ]

      for (const p of palms) {
        const px = p.x * w
        const py = mapY(p.y)
        const frondCount = 7
        const frondLen = p.s * 1.6

        // Shadow
        ctx.beginPath()
        ctx.ellipse(px + 4, py + 4, p.s * 0.9, p.s * 0.65, 0.2, 0, Math.PI * 2)
        ctx.fillStyle = isNight ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.07)"
        ctx.fill()

        // Fronds
        for (let i = 0; i < frondCount; i++) {
          const angle = (i / frondCount) * Math.PI * 2 + 0.3
          ctx.save()
          ctx.translate(px, py)
          ctx.rotate(angle)

          // Leaf shape
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.quadraticCurveTo(frondLen * 0.35, -frondLen * 0.18, frondLen, -frondLen * 0.04)
          ctx.quadraticCurveTo(frondLen * 0.35, frondLen * 0.18, 0, 0)
          ctx.closePath()
          ctx.fillStyle = isNight ? "rgba(12, 45, 22, 0.8)" : "rgba(34, 130, 50, 0.72)"
          ctx.fill()

          // Midrib
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.quadraticCurveTo(frondLen * 0.35, 0, frondLen, -frondLen * 0.02)
          ctx.strokeStyle = isNight ? "rgba(8, 30, 14, 0.5)" : "rgba(20, 80, 30, 0.4)"
          ctx.lineWidth = 1
          ctx.stroke()

          ctx.restore()
        }

        // Trunk cross-section
        ctx.beginPath()
        ctx.arc(px, py, p.s * 0.13, 0, Math.PI * 2)
        ctx.fillStyle = isNight ? "#2a1f12" : "#6b4f2e"
        ctx.fill()
        ctx.strokeStyle = isNight ? "#1a1208" : "#4a3520"
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }

    draw()
    window.addEventListener("resize", draw)
    return () => window.removeEventListener("resize", draw)
  }, [isNight])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "100%",
        height: "45%",
        zIndex: 2,
        pointerEvents: "none",
      }}
    />
  )
}
