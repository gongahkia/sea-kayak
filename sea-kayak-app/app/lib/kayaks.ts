type Paddler = {
  skin: string
  hair: string
  shirt: string
  vest: string
  paddle: string
  shaft: string
  hairStyle: number
  paddleStyle: number
}

export type Kayaker = {
  id: string
  x: number
  y: number
  heading: number
  phase: number
  scale: number
  radius: number
  boat: string
  trim: string
  deckStyle: number
  type: number
  paddlers: Paddler[]
}

const COLORS = ["#f28c45", "#f0c75e", "#5bbfb3", "#e4778b", "#94a4e8", "#e7e6d7", "#78b3d2", "#bb8bcc", "#a6bd73"]
const SKIN = ["#f3c6a1", "#dba578", "#b87950", "#8b533b", "#653e30"]
const HAIR = ["#302520", "#73452c", "#d5a851", "#c26d42", "#d8d6cc", "#51423b"]
// touring, recreational, tandem, racing, canoe, and sit-on-top hulls.
const HULLS = [
  { length: 78, beam: 9 },
  { length: 60, beam: 13 },
  { length: 100, beam: 10 },
  { length: 94, beam: 7 },
  { length: 90, beam: 14 },
  { length: 70, beam: 12 }
]

export function createFleet(urls: string[]): Kayaker[] {
  return [...new Set(urls)].slice(0, 80).map((id) => {
    let seed = 2166136261
    for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    const pick = (colors: string[]) => colors[Math.floor(random() * colors.length)]
    const x = 0.1 + random() * 0.8
    let y = 0.08 + random() * 0.84
    if (x > 0.2 && x < 0.8 && y > 0.3 && y < 0.72) y = random() < 0.5 ? 0.12 + random() * 0.12 : 0.8 + random() * 0.1
    const type = Math.floor(random() * HULLS.length)
    const hull = HULLS[type]
    const seats = type === 2 || (type === 4 && random() < 0.5) ? 2 : 1
    return {
      id,
      x,
      y,
      type,
      heading: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
      scale: 0.75 + random() * 0.4,
      radius: Math.hypot(hull.length / 2 + 14, hull.beam * 1.35) + 6,
      boat: pick(COLORS),
      trim: pick(COLORS),
      deckStyle: Math.floor(random() * 3),
      paddlers: Array.from({ length: seats }, () => ({
        skin: pick(SKIN),
        hair: pick(HAIR),
        shirt: pick(COLORS),
        vest: pick(COLORS),
        paddle: pick(COLORS),
        shaft: pick(["#d4dce0", "#bf9a68", "#344754"]),
        hairStyle: Math.floor(random() * 6),
        paddleStyle: Math.floor(random() * 4)
      }))
    }
  })
}

function drawBlade(ctx: CanvasRenderingContext2D, side: number, style: number) {
  ctx.save()
  ctx.translate(side * 25, 0)
  ctx.scale(side, 1)
  ctx.beginPath()
  if (style === 0) ctx.ellipse(0, 0, 6, 3, 0.2, 0, Math.PI * 2)
  else if (style === 1) ctx.roundRect(-5, -4, 11, 8, 3)
  else if (style === 2) {
    ctx.moveTo(-8, 0)
    ctx.lineTo(7, -2)
    ctx.lineTo(9, 0)
    ctx.lineTo(7, 2)
  } else {
    ctx.moveTo(-6, 0)
    ctx.bezierCurveTo(-1, -6, 8, -5, 7, -1)
    ctx.quadraticCurveTo(3, 4, -6, 0)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawPaddler(
  ctx: CanvasRenderingContext2D,
  person: Paddler,
  seat: number,
  stroke: number,
  canoe: boolean,
  rear: boolean
) {
  ctx.strokeStyle = person.shirt
  ctx.lineWidth = 4
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(-4, seat)
  ctx.lineTo(-8, seat - 3)
  ctx.moveTo(4, seat)
  ctx.lineTo(8, seat + 2)
  ctx.stroke()
  ctx.strokeStyle = person.skin
  ctx.lineWidth = 2.8
  ctx.beginPath()
  ctx.moveTo(-8, seat - 3)
  ctx.lineTo(-12, seat - 2)
  ctx.moveTo(8, seat + 2)
  ctx.lineTo(12, seat + 1)
  ctx.stroke()
  ctx.fillStyle = person.shirt
  ctx.beginPath()
  ctx.ellipse(0, seat + 1, 5.5, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = person.vest
  ctx.beginPath()
  ctx.roundRect(-4.5, seat - 3, 9, 9, 2)
  ctx.fill()
  ctx.strokeStyle = "rgba(25,39,47,0.65)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, seat - 2)
  ctx.lineTo(0, seat + 5)
  ctx.stroke()

  ctx.save()
  ctx.translate(0, seat - 1)
  ctx.rotate(stroke)
  if (canoe && rear) ctx.scale(-1, 1)
  ctx.strokeStyle = person.shaft
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.moveTo(-24, 0)
  ctx.lineTo(24, 0)
  if (canoe) {
    ctx.moveTo(-24, -3)
    ctx.lineTo(-24, 3)
  }
  ctx.stroke()
  ctx.fillStyle = person.paddle
  drawBlade(ctx, 1, person.paddleStyle)
  if (!canoe) drawBlade(ctx, -1, person.paddleStyle)
  ctx.restore()

  ctx.save()
  ctx.translate(0, seat - 5)
  ctx.fillStyle = person.skin
  ctx.beginPath()
  ctx.arc(0, 0, 4.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = person.hairStyle === 3 ? person.vest : person.hair
  if (person.hairStyle !== 5) {
    ctx.beginPath()
    ctx.ellipse(0, -1, person.hairStyle === 2 ? 5 : 4.2, person.hairStyle === 2 ? 4.6 : 3.3, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  if (person.hairStyle === 1 || person.hairStyle === 4) {
    ctx.beginPath()
    ctx.ellipse(0, 4, person.hairStyle === 1 ? 2.2 : 2.8, person.hairStyle === 1 ? 5 : 2.8, 0, 0, Math.PI * 2)
    ctx.fill()
  } else if (person.hairStyle === 3) {
    ctx.beginPath()
    ctx.ellipse(0, -4, 4, 2, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawKayaker(
  ctx: CanvasRenderingContext2D,
  kayak: Kayaker,
  width: number,
  position: { x: number; y: number },
  time: number
) {
  const { type, phase } = kayak
  const { length, beam } = HULLS[type]
  ctx.save()
  ctx.translate(position.x, position.y)
  ctx.rotate(kayak.heading + Math.sin(time * 0.25 + phase) * 0.07)
  const scale = kayak.scale * (width < 640 ? 0.8 : 1)
  ctx.scale(scale, scale)
  ctx.strokeStyle = "rgba(214,236,244,0.26)"
  ctx.lineWidth = 1
  for (const offset of [0, 8]) {
    ctx.beginPath()
    ctx.moveTo(-beam, length / 2 - 8 + offset)
    ctx.quadraticCurveTo(0, length / 2 + 6 + offset, beam, length / 2 - 8 + offset)
    ctx.stroke()
  }
  ctx.shadowColor = "rgba(0,12,30,0.3)"
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 3
  ctx.beginPath()
  ctx.moveTo(0, -length / 2)
  if (type === 1 || type === 5) {
    ctx.bezierCurveTo(beam * 1.7, -length * 0.28, beam * 1.1, length * 0.4, beam * 0.4, length / 2)
    ctx.lineTo(-beam * 0.4, length / 2)
    ctx.bezierCurveTo(-beam * 1.1, length * 0.4, -beam * 1.7, -length * 0.28, 0, -length / 2)
  } else {
    ctx.bezierCurveTo(beam * 1.3, -length * 0.28, beam * 1.35, length * 0.23, 0, length / 2)
    ctx.bezierCurveTo(-beam * 1.35, length * 0.23, -beam * 1.3, -length * 0.28, 0, -length / 2)
  }
  ctx.closePath()
  ctx.fillStyle = kayak.boat
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.strokeStyle = "rgba(255,255,255,0.5)"
  ctx.stroke()
  if (type !== 4 && kayak.deckStyle === 0) {
    ctx.save()
    ctx.clip()
    ctx.fillStyle = kayak.trim
    ctx.fillRect(-2, -length / 2 + 4, 4, length - 8)
    ctx.restore()
  }
  if (type === 4) {
    ctx.fillStyle = "#b88a59"
    ctx.beginPath()
    ctx.ellipse(0, 0, beam * 0.7, length * 0.36, 0, 0, Math.PI * 2)
    ctx.fill()
  } else if (type === 5) {
    ctx.fillStyle = "rgba(27,54,63,0.5)"
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.roundRect(side * 4 - 2, -22, 4, 15, 2)
      ctx.fill()
    }
  } else {
    ctx.strokeStyle = "rgba(30,45,53,0.55)"
    ctx.beginPath()
    if (kayak.deckStyle === 1) {
      for (const offset of [-5, 0, 5]) {
        ctx.moveTo(-4, -length * 0.3 + offset)
        ctx.lineTo(4, -length * 0.3 + offset + 5)
        ctx.moveTo(4, -length * 0.3 + offset)
        ctx.lineTo(-4, -length * 0.3 + offset + 5)
      }
    } else ctx.ellipse(0, -length * 0.28, 3, 5, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  kayak.paddlers.forEach((person, index) => {
    const seat = kayak.paddlers.length === 2 ? (index === 0 ? -18 : 18) : 3
    ctx.fillStyle = type === 4 ? "#704f34" : "#263b47"
    ctx.beginPath()
    if (type === 4) ctx.roundRect(-beam * 0.7, seat, beam * 1.4, 4, 1)
    else ctx.ellipse(0, seat, beam * 0.65, 10, 0, 0, Math.PI * 2)
    ctx.fill()
    const stroke = Math.sin(time * (1.3 + person.paddleStyle * 0.1) + phase + index * 0.9) * 0.4
    drawPaddler(ctx, person, seat, stroke, type === 4, index === 1)
  })
  ctx.restore()
}
