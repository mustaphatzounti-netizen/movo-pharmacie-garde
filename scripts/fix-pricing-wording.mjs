#!/usr/bin/env node
/**
 * One-off maintenance (Nov 2026): the delivery price depends on the PICK-UP ZONE and the
 * DELIVERY ZONE, not on the distance. Several pages and posts of the 3 MOVO blogs (FR, EN, AR)
 * still said "selon la distance", "depends on the distance", "حسب المسافة"... This script
 * replaces those exact pricing sentences. Sentences where "distance" is about delivery TIME,
 * directions to an address or keeping food hot are NOT touched (no rule matches them).
 *
 * Safety (same as absolutize-links.mjs):
 *   - MODE=dry-run (default) only reports what would change, nothing is written.
 *   - MODE=apply writes the changes with PATCH (title + content only).
 *   - The original content of every item to change is saved first to
 *     backup/pricing-backup.json (uploaded as a workflow artifact).
 *
 * Env: BLOGGER_CLIENT_ID, BLOGGER_CLIENT_SECRET, BLOGGER_REFRESH_TOKEN, MODE
 */

import fs from 'node:fs';

const BLOGS = [
  { label: 'FR', id: '8452204387409245713' },
  { label: 'EN', id: '4591946336174594751' },
  { label: 'AR', id: '6023995067592991740' },
];

// Literal text → regex: flexible apostrophes (' ’ &#39;) and spaces (incl. &nbsp;).
function lit(s) {
  return s
    .replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    .replace(/'/g, "(?:'|’|&#39;|&#x27;)")
    .replace(/ /g, '(?:\\s|&nbsp;|\\u00a0)+');
}

// Order matters: longer sentences first.
export const RULES = {
  FR: [
    ['Le prix est identique dans les deux sens : il dépend de la distance totale, pas du point de départ', 'Le prix dépend de la zone de départ et de la zone de livraison, et il est confirmé sur WhatsApp avant le départ'],
    ['Le tarif dépend de la distance totale du trajet, pas du point de départ', 'Le tarif dépend de la zone de départ et de la zone de livraison'],
    ['le prix suit la distance totale du trajet et non la zone de départ', 'le prix dépend de la zone de départ et de la zone de livraison'],
    ['le prix suit la distance et reste', 'le prix dépend de la zone de livraison et reste'],
    ["Le prix dépend de la distance, du poids et du temps d'attente sur place", "Le prix dépend de la zone de départ, de la zone de livraison, du poids et du temps d'attente sur place"],
    ['<h3>La distance</h3><p>Le seul facteur principal. Plus le trajet est long, plus la course monte.</p>', '<h3>La zone</h3><p>Le facteur principal : chaque zone a son tarif selon le point de départ, comme dans le tableau ci-dessus.</p>'],
    ['Le tarif de la course dépend de la distance :', 'Le tarif de la course dépend de la zone de livraison :'],
    ['dépend de la distance entre le magasin et votre adresse', 'dépend de la zone du magasin et de la zone de votre adresse'],
    ["selon l'heure et la distance", "selon l'heure et la zone de livraison"],
    ['selon la distance ajoutée et le temps supplémentaire', 'pour chaque point de retrait supplémentaire'],
    ['pour la distance et le temps ajoutés', 'pour chaque point de retrait supplémentaire'],
    ['pour la distance ajoutée', 'pour chaque point de retrait supplémentaire'],
  ],
  EN: [
    ['The price is the same in both directions: it depends on the total distance, not on the starting point', 'The price depends on the pick-up zone and the delivery zone, and it is confirmed on WhatsApp before the driver sets off'],
    ['The fee depends on the total distance of the trip, not on the starting point', 'The fee depends on the pick-up zone and the delivery zone'],
    ['the price follows the total distance of the trip, not the starting area', 'the price depends on the pick-up zone and the delivery zone'],
    ['the price follows the distance and stays', 'the price depends on the delivery zone and stays'],
    ['The delivery fee depends on the distance:', 'The delivery fee depends on the delivery zone:'],
    ['depends on the distance between the store and your address', "depends on the store's zone and the zone of your address"],
    ['depending on the time and the distance', 'depending on the time and the delivery zone'],
    ['depending on the time and distance', 'depending on the time and the delivery zone'],
    ['depending on the extra distance and time', 'for each extra pick-up point'],
    ['for the extra distance and time', 'for each extra pick-up point'],
    ['for the added distance and time', 'for each extra pick-up point'],
    ['for the extra distance', 'for each extra pick-up point'],
  ],
  AR: [
    ['الثمن نفسه في الاتجاهين: حسب المسافة الإجمالية، وليس حسب نقطة الانطلاق', 'الثمن حسب منطقة الانطلاق ومنطقة التوصيل، ويتأكد عبر واتساب قبل انطلاق الليفرور'],
    ['الثمن حسب المسافة الإجمالية للمسار، وليس حسب نقطة الانطلاق', 'الثمن حسب منطقة الانطلاق ومنطقة التوصيل'],
    ['الثمن يتبع المسافة ويبقى', 'الثمن حسب منطقة التوصيل ويبقى'],
    ['ثمن التوصيلة حسب المسافة:', 'ثمن التوصيلة حسب منطقة التوصيل:'],
    ['<h3>المنطقة والمسافة</h3>', '<h3>المنطقة</h3>'],
    ['حسب الساعة والمسافة', 'حسب الساعة ومنطقة التوصيل'],
    ['حسب الوقت والمسافة', 'حسب الوقت ومنطقة التوصيل'],
    ['تُضاف زيادة حسب المسافة والوقت الإضافي', 'تُضاف زيادة مقابل كل نقطة استلام إضافية'],
    ['تُضاف زيادة حسب المسافة والوقت', 'تُضاف زيادة مقابل كل نقطة استلام إضافية'],
    ['تُضاف زيادة حسب المسافة', 'تُضاف زيادة مقابل كل نقطة استلام إضافية'],
    ['تُضاف زيادة على المسافة الإضافية', 'تُضاف زيادة مقابل كل نقطة استلام إضافية'],
    ['كتتزاد زيادة على المسافة والوقت', 'كتتزاد زيادة على كل نقطة استلام إضافية'],
    ['بزيادة مقابل المسافة والوقت المضافين', 'بزيادة مقابل كل نقطة استلام إضافية'],
  ],
};

export function fix(html, label) {
  let out = html;
  const hits = [];
  for (const [from, to] of RULES[label]) {
    const re = new RegExp(lit(from), 'g');
    let n = 0;
    out = out.replace(re, () => { n++; return to; });
    if (n) hits.push(`${n}× "${from.slice(0, 60)}"`);
  }
  return { out, hits };
}

const { BLOGGER_CLIENT_ID, BLOGGER_CLIENT_SECRET, BLOGGER_REFRESH_TOKEN } = process.env;
const MODE = (process.env.MODE || 'dry-run').trim();
const APPLY = MODE === 'apply';
const API = 'https://www.googleapis.com/blogger/v3';

async function getAccessToken() {
  if (!BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET || !BLOGGER_REFRESH_TOKEN) throw new Error('Missing BLOGGER_* secrets.');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function api(token, path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function listAll(token, blogId, kind) {
  const items = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ fetchBodies: 'true', status: 'live' });
    if (kind === 'posts') qs.set('maxResults', '50');
    if (pageToken) qs.set('pageToken', pageToken);
    const json = await api(token, `/blogs/${blogId}/${kind}?${qs}`);
    items.push(...(json.items || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return items;
}

async function main() {
  console.log(`MODE = ${MODE}`);
  const token = await getAccessToken();
  const todo = [];
  for (const blog of BLOGS) {
    for (const kind of ['pages', 'posts']) {
      const items = await listAll(token, blog.id, kind);
      let n = 0;
      for (const it of items) {
        if (!it.title || !it.title.trim()) continue;
        const { out, hits } = fix(it.content || '', blog.label);
        if (!hits.length || out === it.content) continue;
        todo.push({ blog, kind, it, out, hits });
        n++;
        console.log(`[${blog.label}] ${kind} ${it.url.replace(/^https?:\/\/[^/]+/, '')} : ${hits.join(' ; ')}`);
      }
      console.log(`== [${blog.label}] ${kind}: ${items.length} live, ${n} to change`);
    }
  }

  fs.mkdirSync('backup', { recursive: true });
  fs.writeFileSync('backup/pricing-backup.json', JSON.stringify(todo.map(({ blog, kind, it }) => ({ blog: blog.label, blogId: blog.id, kind, id: it.id, url: it.url, title: it.title, content: it.content })), null, 1));

  console.log(`TOTAL: ${todo.length} items to change.`);
  if (!APPLY) { console.log('Dry run: nothing written.'); return; }

  let ok = 0;
  let failed = 0;
  for (const t of todo) {
    try {
      await api(token, `/blogs/${t.blog.id}/${t.kind}/${t.it.id}`, { method: 'PATCH', body: JSON.stringify({ title: t.it.title, content: t.out }) });
      ok++;
    } catch (err) {
      failed++;
      console.error(`FAILED ${t.it.url}: ${err.message}`);
    }
  }
  console.log(`Applied: ${ok} updated, ${failed} failed.`);
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err); process.exit(1); });
