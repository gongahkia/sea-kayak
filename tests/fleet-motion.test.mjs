import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFleet } from '../sea-kayak-app/app/lib/kayaks.ts';
import { createFleetBodies, getFleetClipBottom, resizeFleetBodies, stepFleet } from '../sea-kayak-app/app/lib/fleet-motion.ts';

const fleet = createFleet(Array.from({ length: 80 }, (_, index) => `https://example.test/${index}`));
const body = (id, x, y, vx = 0, vy = 0) => ({ id, x, y, vx, vy, radius: 35 });

function assertClear(bodies, width, height) {
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    assert.ok([a.x, a.y, a.vx, a.vy, a.radius].every(Number.isFinite));
    assert.ok(a.x - a.radius >= 0 && a.x + a.radius <= width);
    assert.ok(a.y + a.radius <= height);
    for (let j = 0; j < i; j++) {
      const b = bodies[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + b.radius + 8 - 1e-7, `${a.id} overlaps ${b.id}`);
    }

  }
}

test('approaching kayaks separate and rebound, while departing kayaks keep their velocity', () => {
  const approaching = [body('a', 200, 200, 4), body('b', 270, 200, -4)];
  stepFleet(approaching, 1 / 60, 800, 600);
  assertClear(approaching, 800, 600);
  assert.ok(approaching[0].vx < 0 && approaching[1].vx > 0);
  const departing = [body('a', 200, 200, -4), body('b', 270, 200, 4)];
  stepFleet(departing, 1 / 60, 800, 600);
  assertClear(departing, 800, 600);
  assert.equal(departing[0].vx, -4);
  assert.equal(departing[1].vx, 4);
});

test('walls reflect drifting kayaks back into the water', () => {
  const bodies = [body('left', 0, 100, -4), body('right', 800, 100, 4), body('bottom', 400, 600, 0, 4)];
  stepFleet(bodies, 1 / 60, 800, 600);
  assertClear(bodies, 800, 600);
  assert.ok(bodies[0].vx > 0 && bodies[1].vx < 0 && bodies[2].vy < 0);
});

test('crowded fleets remain separated at portrait, landscape, and desktop sizes', () => {
  for (const [width, height] of [[280, 653], [320, 568], [390, 844], [844, 390], [768, 1024], [1280, 900]]) {
    const bodies = createFleetBodies(fleet, width, height);
    for (let frame = 0; frame < 180; frame++) {
      stepFleet(bodies, frame === 90 ? 20 : 1 / 30, width, height);
      assertClear(bodies, width, height);
    }
  }
});

test('coincident spawns, resize squeezes, and paused motion still resolve overlaps', () => {
  const bodies = createFleetBodies(fleet, 1280, 900);
  for (const b of bodies) { b.x = 160; b.y = 100; }
  stepFleet(bodies, 0, 320, 568);
  assertClear(bodies, 320, 568);
  const resized = createFleetBodies(fleet, 280, 320, bodies);
  stepFleet(resized, 0, 280, 320);
  assertClear(resized, 280, 320);
  assert.ok(resized.some(b => b.y < 0), 'excess boats use open water above the viewport');
});

test('adding an article retains existing kayak positions and velocities', () => {
  const initial = createFleetBodies(fleet.slice(0, 2), 1280, 900);
  stepFleet(initial, 0.05, 1280, 900);
  const added = createFleetBodies(fleet.slice(0, 3), 1280, 900, initial);
  assert.deepEqual(added.slice(0, 2), initial);
});

test('text and shoreline set a visual mask without moving the fleet', () => {
  assert.equal(getFleetClipBottom(900), 900);
  assert.equal(getFleetClipBottom(900, 1800, 1400), 900);
  assert.equal(getFleetClipBottom(900, 700, 800), 688);
  assert.equal(getFleetClipBottom(900, 700, 300), 280);
  assert.equal(getFleetClipBottom(900, 700, -20), 0);
  const bodies = createFleetBodies(fleet, 390, 844);
  const original = structuredClone(bodies);
  for (let scroll = 0; scroll < 844; scroll += 8) {
    getFleetClipBottom(844, 1400 - scroll, 1057 - scroll);
    stepFleet(bodies, 0, 390, 844);
    assert.deepEqual(bodies, original);
  }
});

test('resizing retains relative positions instead of reseeding existing boats', () => {
  const bodies = createFleetBodies(fleet.slice(0, 8), 1280, 900);
  stepFleet(bodies, 0.05, 1280, 900);
  const original = structuredClone(bodies);
  resizeFleetBodies(bodies, 0.8, 0.9);
  const resized = createFleetBodies(fleet.slice(0, 8), 1024, 810, bodies);
  for (let i = 0; i < bodies.length; i++) {
    assert.equal(resized[i].x, original[i].x * 0.8);
    assert.equal(resized[i].y, original[i].y * 0.9);
    assert.equal(resized[i].vx, original[i].vx);
    assert.equal(resized[i].vy, original[i].vy);
  }
});

test('admitting an overlapping new boat leaves existing boats in place', () => {
  const existing = createFleetBodies(fleet.slice(0, 1), 1280, 900);
  existing[0].x = fleet[1].x * 1280;
  existing[0].y = fleet[1].y * 900;
  const original = structuredClone(existing[0]);
  const added = createFleetBodies(fleet.slice(0, 2), 1280, 900, existing);
  stepFleet(added, 0, 1280, 900);
  assert.deepEqual(added[0], original);
  assertClear(added, 1280, 900);
});

test('ordinary drift and collisions do not relocate boats across the scene', () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 900]]) {
    const bodies = createFleetBodies(fleet, width, height);
    for (let frame = 0; frame < 1000; frame++) {
      const previous = bodies.map(b => ({ x: b.x, y: b.y }));
      stepFleet(bodies, 1 / 30, width, height);
      assertClear(bodies, width, height);
      bodies.forEach((b, i) => assert.ok(Math.hypot(b.x - previous[i].x, b.y - previous[i].y) < 2, `Boat ${i} jumped on frame ${frame} at width ${width}`));
    }
  }
});
