import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRouteData, getSource } from '../sea-kayak-app/app/lib/sources.ts';

test('route ingestion tolerates malformed values and accepts only usable HTTP(S) articles', () => {
  const valid = { url: 'https://example.test/news', title: 'Synthetic news', description: 'Literal <script> text', published: '', citation: '' };
  const legacy = { url: 'https://example.test/old', title: '', description: '', published: '', citation: '' };
  const result = normalizeRouteData([null, 12, {}, { url: 'javascript:alert(1)' }, { url: 'data:text/html,unsafe' }, { url: 'https://example.test/bad', title: {} }, valid, legacy.url]);
  assert.deepEqual(result, [valid, legacy]);
});

test('route duplicates differing only by fragment are shown once without changing the first link', () => {
  const result = normalizeRouteData(['https://example.test/news#one', 'https://example.test/news#two']);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://example.test/news#one');
});

test('source attribution requires a hostname boundary', () => {
  assert.equal(getSource('https://notlexology.com/news'), '');
  assert.equal(getSource('https://evillawgazette.com.sg/news'), '');
  assert.equal(getSource('https://lexology.com/news'), 'Lexology');
  assert.equal(getSource('https://www.lawgazette.com.sg/news'), 'Law Gazette');
});
