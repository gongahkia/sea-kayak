import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSeen, baseWeight, pickWeighted } from '../sea-kayak-app/app/lib/reading.ts';
import { getSgtHour } from '../sea-kayak-app/app/lib/clock.ts';

const now = Date.parse('2026-10-22T04:00:00Z');
const item = (url, published = '') => ({ url, published, title: '', description: '' });

test('seen history rejects arrays, unsafe URLs, future, expired and nonnumeric dates', () => {
  assert.deepEqual(normalizeSeen([now], now), {});
  const valid = 'https://example.test/current';
  assert.deepEqual(normalizeSeen({ [valid]: now - 1, 'https://example.test/future': now + 1, 'https://example.test/expired': now - 7 * 86400000 - 1, 'https://example.test/string': String(now), 'javascript:alert(1)': now, 'https://user:pass@example.test': now, 'https://example.test/nan': NaN }, now), { [valid]: now - 1 });
  const many = Object.fromEntries(Array.from({ length: 5002 }, (_, index) => [`https://example.test/${index}`, now - index]));
  const normalized = normalizeSeen(many, now);
  assert.equal(Object.keys(normalized).length, 5000);
  assert.equal(normalized['https://example.test/5001'], undefined);
});

test('freshness has defined Singapore-offset age boundaries and no future-date boost', () => {
  const weight = hours => baseWeight(item('https://example.test/a', new Date(now - hours * 3600000).toISOString()), now);
  assert.equal(weight(48), 10); assert.equal(weight(48.001), 4);
  assert.equal(weight(168), 4); assert.equal(weight(168.001), 2);
  assert.equal(weight(720), 2); assert.equal(weight(720.001), 1);
  assert.equal(weight(-1), 1);
  assert.equal(baseWeight(item('https://example.test/a', 'invalid'), now), 1);
  assert.equal(baseWeight(item('https://example.test/a', '2026-10-22T12:00:00+08:00'), now), 10);
});

test('zero entropy still skips seen articles; exhaustion falls back to all articles', () => {
  const a = item('https://example.test/a'), b = item('https://example.test/b');
  assert.equal(pickWeighted([a, b], { [a.url]: now }, now, () => 0), b);
  assert.equal(pickWeighted([a, b], { [a.url]: now, [b.url]: now }, now, () => 0), a);
  assert.equal(pickWeighted([a, b], {}, now, () => 0.999999), b);
  assert.throws(() => pickWeighted([], {}, now), /No usable/);
});

test('Singapore time uses the configured zone across UTC dates and DST seasons', () => {
  assert.equal(getSgtHour(new Date('2026-01-01T16:15:00Z')), 0.25);
  assert.equal(getSgtHour(new Date('2026-07-01T04:30:00Z')), 12.5);
  assert.equal(getSgtHour(new Date('2026-10-22T14:00:00Z')), 22);
});
