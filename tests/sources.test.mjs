import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeRouteData, getSource, getSourceLabel } from '../sea-kayak-app/app/lib/sources.ts';

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

test('new legal sources have labels without matching lookalike hosts', () => {
  for (const [host, label] of [
    ['smulexicon.com', 'SMU Lexicon'],
    ['www.elitigation.sg', 'SG Courts'],
    ['www.judiciary.gov.sg', 'SG Courts'],
    ['www.pdpc.gov.sg', 'PDPC'],
    ['www.ccs.gov.sg', 'CCS'],
    ['www.cccs.gov.sg', 'CCS'],
  ]) {
    assert.equal(getSource(`https://${host}/article`), label);
    assert.equal(getSource(`https://${host}.example.test/article`), '');
  }
});

test('every article has a banner, including annual reviews, advertisements and shortened links', () => {
  assert.equal(getSourceLabel('https://shorturl.at/abc', '[SAL Ann Rev]: Conflict of Laws'), 'SAL Annual Review');
  assert.equal(getSourceLabel('https://tinyurl.com/abc', 'ADV: Make your CPD hours count'), 'Advertisement');
  assert.equal(getSourceLabel('https://shorturl.at/abc', 'Unrecognised title'), 'Linked source');
  assert.equal(getSourceLabel('https://new-publisher.example/news', 'News'), 'new-publisher.example');
  assert.equal(getSourceLabel('invalid', ''), 'Legal source');
});

test('every article in the checked-in snapshot has a source banner', async () => {
  const items = normalizeRouteData(JSON.parse(await readFile(new URL('../data/routes.json', import.meta.url), 'utf8')));
  assert.ok(items.length > 0);
  for (const item of items) assert.ok(getSourceLabel(item.url, item.title).trim(), item.url);
});
