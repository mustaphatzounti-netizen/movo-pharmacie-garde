import test from 'node:test';
import assert from 'node:assert/strict';
import { propre, lireFlux, aSoumettre } from './bing-nouveautes.mjs';

test('propre: removes ?m=1 and #fragment, forces https', () => {
  assert.equal(propre('http://www.agadir-livraison.com/2026/11/x.html?m=1#c'), 'https://www.agadir-livraison.com/2026/11/x.html');
  assert.equal(propre('not a url'), null);
});

test('lireFlux: reads the alternate link and updated date', () => {
  const json = { feed: { entry: [
    { link: [{ rel: 'self', href: 'https://x/feeds/1' }, { rel: 'alternate', href: 'https://www.agadir-livraison.com/p/a.html' }], updated: { $t: '2026-11-15T10:00:00.000-08:00' } },
    { link: [{ rel: 'self', href: 'https://x/feeds/2' }], updated: { $t: '2026-11-15T10:00:00.000-08:00' } },
  ] } };
  assert.deepEqual(lireFlux(json), [{ url: 'https://www.agadir-livraison.com/p/a.html', updated: '2026-11-15T10:00:00.000-08:00' }]);
  assert.deepEqual(lireFlux({ feed: {} }), []);
});

test('aSoumettre: only new or changed URLs, skips excluded, respects max', () => {
  const etat = { 'https://s/a.html': 'T1', 'https://s/b.html': 'T1' };
  const entrees = [
    { url: 'https://s/a.html', updated: 'T1' },      // unchanged
    { url: 'https://s/b.html', updated: 'T2' },      // changed
    { url: 'https://s/c.html', updated: 'T1' },      // new
    { url: 'https://s/pharma.html', updated: 'T9' }, // excluded
    { url: 'https://s/c.html', updated: 'T1' },      // duplicate
  ];
  const exclus = new Set(['https://s/pharma.html']);
  assert.deepEqual(aSoumettre(entrees, etat, exclus, 10).map((e) => e.url), ['https://s/b.html', 'https://s/c.html']);
  assert.equal(aSoumettre(entrees, etat, exclus, 1).length, 1);
});
