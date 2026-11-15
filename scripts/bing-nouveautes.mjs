#!/usr/bin/env node
/**
 * Tells Bing (and so ChatGPT / Copilot, which use Bing) about NEW or CHANGED posts and pages
 * on the 3 MOVO blogs (FR, EN, AR), e.g. the weekly Saturday "Nos livraisons" post.
 *
 * How: reads the public Blogger feeds (posts + pages), compares each URL's "updated" date with
 * public/bing-etat.json (what was already sent), and sends only the new or changed URLs with the
 * Bing URL Submission API. The pharmacy pages are skipped: publish-to-blogger.mjs already sends them.
 *
 * Safety:
 *   - First run (no state file): records everything, sends nothing (no quota spent on old URLs).
 *   - At most MAX_PAR_RUN URLs per run (Bing quota: 100 per day per site).
 *   - A URL is recorded as sent only if Bing accepted it, so a failure is retried on the next run.
 *   - Never makes the workflow fail.
 *
 * Env: BING_API_KEY (optional: without it the script does nothing). ETAT_PATH (default public/bing-etat.json).
 */

import fs from 'node:fs';

export const SITES = [
  'https://www.agadir-livraison.com/',
  'https://en.agadir-livraison.com/',
  'https://ar.agadir-livraison.com/',
];

// Already sent by publish-to-blogger.mjs whenever the daily list changes.
export const EXCLUS = new Set([
  'https://www.agadir-livraison.com/p/pharmacie-de-garde-agadir.html',
  'https://www.agadir-livraison.com/p/pharmacie-de-garde-inezgane.html',
  'https://www.agadir-livraison.com/p/pharmacie-de-garde-ait-melloul.html',
  'https://en.agadir-livraison.com/p/on-call-pharmacy-agadir.html',
  'https://ar.agadir-livraison.com/p/saydaliya-hirasa-agadir.html',
]);

const MAX_PAR_RUN = 30;
const ETAT_PATH = process.env.ETAT_PATH || 'public/bing-etat.json';

// Clean URL: https, no query string (?m=1) and no #fragment.
export function propre(u) {
  try {
    const x = new URL(u);
    x.protocol = 'https:';
    x.search = '';
    x.hash = '';
    return x.toString();
  } catch {
    return null;
  }
}

// Blogger JSON feed → [{ url, updated }]
export function lireFlux(json) {
  return ((json && json.feed && json.feed.entry) || [])
    .map((e) => ({
      url: propre(((e.link || []).find((l) => l.rel === 'alternate') || {}).href),
      updated: e.updated && e.updated.$t,
    }))
    .filter((e) => e.url && e.updated);
}

// Which URLs to send: new or with a different "updated" date, minus the excluded ones, at most max.
export function aSoumettre(entrees, etat, exclus = EXCLUS, max = MAX_PAR_RUN) {
  const vus = new Set();
  const out = [];
  for (const e of entrees) {
    if (vus.has(e.url) || exclus.has(e.url)) continue;
    vus.add(e.url);
    if (etat[e.url] !== e.updated) out.push(e);
  }
  return out.slice(0, max);
}

async function fluxSite(site) {
  const entrees = [];
  for (const chemin of ['feeds/posts/default?alt=json&max-results=150', 'feeds/pages/default?alt=json&max-results=150']) {
    const res = await fetch(site + chemin);
    if (!res.ok) throw new Error(`${site}${chemin} → ${res.status}`);
    entrees.push(...lireFlux(await res.json()));
  }
  return entrees;
}

async function envoyer(key, siteUrl, urlList) {
  const res = await fetch('https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ siteUrl, urlList }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  const key = process.env.BING_API_KEY;
  if (!key) { console.log('Bing (posts/pages): no BING_API_KEY secret, skipped.'); return; }

  const premierPassage = !fs.existsSync(ETAT_PATH);
  const etat = premierPassage ? {} : JSON.parse(fs.readFileSync(ETAT_PATH, 'utf8'));
  let modifie = false;
  let reste = MAX_PAR_RUN;

  for (const site of SITES) {
    let entrees;
    try {
      entrees = await fluxSite(site);
    } catch (err) {
      console.log(`::warning::Bing (posts/pages): could not read the feeds of ${site}: ${err.message}`);
      continue;
    }

    if (premierPassage) {
      entrees.forEach((e) => { etat[e.url] = e.updated; });
      modifie = true;
      console.log(`Bing (posts/pages): ${site} — ${entrees.length} URLs recorded (first run, nothing sent).`);
      continue;
    }

    const lot = aSoumettre(entrees, etat, EXCLUS, reste);
    if (!lot.length) { console.log(`Bing (posts/pages): ${site} — nothing new.`); continue; }
    try {
      await envoyer(key, site, lot.map((e) => e.url));
      lot.forEach((e) => { etat[e.url] = e.updated; });
      reste -= lot.length;
      modifie = true;
      console.log(`Bing (posts/pages): ${site} — ${lot.length} URL(s) submitted:`);
      lot.forEach((e) => console.log('  ' + e.url));
    } catch (err) {
      console.log(`::warning::Bing (posts/pages): submission failed for ${site} (${err.message}). Will retry next run.`);
    }
    if (reste <= 0) break;
  }

  if (modifie) {
    const trie = Object.fromEntries(Object.entries(etat).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(ETAT_PATH, JSON.stringify(trie, null, 1) + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => console.log(`::warning::Bing (posts/pages): ${err.message}`));
}
