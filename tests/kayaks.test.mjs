import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFleet, drawKayaker } from '../sea-kayak-app/app/lib/kayaks.ts';

test('unique articles add stable kayakers without changing existing appearances', () => {
  const first = 'https://example.test/first', second = 'https://example.test/second';
  const original = createFleet([first])[0];
  assert.deepEqual(createFleet([]), []);
  const fleet = createFleet([second, first, first]);
  assert.equal(fleet.length, 2);
  assert.deepEqual(fleet.find(kayak => kayak.id === first), original);
});

test('a large history has a bounded, varied fleet and keeps the control area clear', () => {
  const fleet = createFleet(Array.from({ length: 5000 }, (_, index) => `https://example.test/${index}`));
  assert.equal(fleet.length, 80);
  for (const field of ['boat', 'trim', 'deckStyle']) assert.ok(new Set(fleet.map(kayak => kayak[field])).size >= 3, field);
  assert.equal(new Set(fleet.map(kayak => kayak.type)).size, 6);
  const people = fleet.flatMap(kayak => kayak.paddlers);
  for (const field of ['paddle', 'skin', 'hair', 'shirt', 'vest', 'shaft', 'hairStyle', 'paddleStyle']) assert.ok(new Set(people.map(person => person[field])).size >= 3, field);
  assert.ok(fleet.some(kayak => kayak.paddlers.length === 1));
  assert.ok(fleet.some(kayak => kayak.paddlers.length === 2));
  for (const kayak of fleet) {
    assert.ok(kayak.x >= 0.1 && kayak.x <= 0.9 && kayak.y >= 0.08 && kayak.y <= 0.92);
    assert.ok(!(kayak.x > 0.2 && kayak.x < 0.8 && kayak.y > 0.3 && kayak.y < 0.72));
  }
});

test('rendering uses the resolved position without adding drift outside collision bounds', () => {
  const fleet = createFleet(Array.from({ length: 80 }, (_, index) => `https://example.test/${index}`));
  const trace = (kayak, width, time) => {
    const translations = [], scales = [];
    const context = new Proxy({}, { get: (_target, name) => (...args) => {
      if (name === 'translate') translations.push(args);
      if (name === 'scale') scales.push(args);
    }});
    drawKayaker(context, kayak, width, { x: 140, y: 120 }, time);
    return { position: translations[0], scale: scales[0] };
  };
  for (const kayak of fleet) {
    for (const width of [320, 390, 768, 1280]) {
      for (const time of [0, 10, 100]) {
        const result = trace(kayak, width, time);
        assert.deepEqual(result.position, [140, 120]);
        const scale = kayak.scale * (width < 640 ? 0.8 : 1);
        assert.deepEqual(result.scale, [scale, scale]);
      }
    }
  }
});
