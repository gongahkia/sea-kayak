import type { Kayaker } from "./kayaks"

export type FleetBody = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

const GAP = 8

export function createFleetBodies(
  fleet: Kayaker[],
  width: number,
  height: number,
  previous: FleetBody[] = []
): FleetBody[] {
  const saved = new Map(previous.map((body) => [body.id, body]))
  const bodies = fleet.map((kayak) => ({
    id: kayak.id,
    x: saved.get(kayak.id)?.x ?? kayak.x * width,
    y: saved.get(kayak.id)?.y ?? kayak.y * height,
    vx: saved.get(kayak.id)?.vx ?? Math.cos(kayak.heading) * 4,
    vy: saved.get(kayak.id)?.vy ?? Math.sin(kayak.heading) * 4,
    radius: kayak.radius * kayak.scale * (width < 640 ? 0.8 : 1)
  }))
  const placed = bodies.filter((body) => saved.has(body.id))
  for (const body of bodies) {
    if (saved.has(body.id)) continue
    contain(body, width, height)
    packAbove(body, placed, placed.length)
    placed.push(body)
  }
  return bodies
}

export function getFleetClipBottom(height: number, shoreTop = Infinity, textTop = Infinity): number {
  return Math.max(0, Math.min(height, shoreTop - 12, textTop - 20))
}

export function resizeFleetBodies(bodies: FleetBody[], scaleX: number, scaleY: number) {
  for (const body of bodies) {
    body.x *= scaleX
    body.y *= scaleY
  }
}

function contain(body: FleetBody, width: number, height: number) {
  const left = Math.min(width / 2, body.radius + GAP)
  const right = Math.max(width / 2, width - body.radius - GAP)
  if (body.x < left) {
    body.x = left
    body.vx = Math.abs(body.vx)
  }
  if (body.x > right) {
    body.x = right
    body.vx = -Math.abs(body.vx)
  }
  if (body.y > height - body.radius - GAP) {
    body.y = height - body.radius - GAP
    body.vy = -Math.abs(body.vy)
  }
}

// use open water above the page only when admitting a new boat or resolving a crowded layout.
function packAbove(body: FleetBody, placed: FleetBody[], count: number) {
  for (let pass = 0; pass < count; pass++) {
    let moved = false
    for (let j = 0; j < count; j++) {
      const other = placed[j]
      const separation = body.radius + other.radius + GAP
      const dx = body.x - other.x
      if (Math.hypot(dx, body.y - other.y) < separation) {
        body.y = other.y - Math.sqrt(Math.max(0, separation * separation - dx * dx)) - 0.01
        body.vy = -Math.abs(body.vy)
        moved = true
      }
    }
    if (!moved) break
  }
}

export function stepFleet(bodies: FleetBody[], elapsed: number, width: number, height: number) {
  const dt = Math.max(0, Math.min(elapsed, 0.05))
  const upperWater = -Math.max(height, bodies.length * 150)
  for (const body of bodies) {
    if (body.y < upperWater) body.vy = Math.abs(body.vy)
    const speed = Math.hypot(body.vx, body.vy)
    if (speed > 10) {
      body.vx *= 10 / speed
      body.vy *= 10 / speed
    }
    body.x += body.vx * dt
    body.y += body.vy * dt
    contain(body, width, height)
  }
  for (let pass = 0; pass < 4; pass++) {
    let touching = false
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i],
          b = bodies[j]
        const dx = b.x - a.x,
          dy = b.y - a.y
        const distance = Math.hypot(dx, dy)
        const separation = a.radius + b.radius + GAP
        if (distance >= separation) continue
        const nx = distance > 0.0001 ? dx / distance : 0
        const ny = distance > 0.0001 ? dy / distance : 1
        const push = (separation - distance + 0.001) / 2
        a.x -= nx * push
        a.y -= ny * push
        b.x += nx * push
        b.y += ny * push
        const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
        if (approach < 0) {
          const impulse = -approach * 0.85
          a.vx -= impulse * nx
          a.vy -= impulse * ny
          b.vx += impulse * nx
          b.vy += impulse * ny
        }
        touching = true
      }
    }
    for (const body of bodies) contain(body, width, height)
    if (!touching) break
  }

  for (let i = 0; i < bodies.length; i++) {
    packAbove(bodies[i], bodies, i)
  }
}
