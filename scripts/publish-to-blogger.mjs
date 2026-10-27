#!/usr/bin/env node
/**
 * Publishes the daily on-call pharmacy list as STATIC HTML directly into the
 * Blogger page content, so that crawlers that do not execute JavaScript
 * (Bing, GPTBot/ChatGPT, PerplexityBot, etc.) see the real list instead of
 * the "Chargement..." placeholder.
 *
 * It reads the same public/garde.json this repo already generates every day,
 * renders it with the EXACT same logic as the client-side script already on
 * the Blogger page (zone grouping, "yesterday" fallback, Arabic subtitle...),
 * then calls the Blogger API (v3) to splice that HTML between two markers
 * inside the #pg-garde div.
 *
 * ONE-TIME SETUP REQUIRED before this script works (see README section below):
 *   1. Blogger page must contain the markers <!--PG:START--> ... <!--PG:END-->
 *      inside the #pg-garde div (Claude does this once in the Blogger editor).
 *   2. These secrets must exist in the GitHub repo (Settings > Secrets > Actions):
 *        BLOGGER_CLIENT_ID
 *        BLOGGER_CLIENT_SECRET
 *        BLOGGER_REFRESH_TOKEN
 *   Blog ID and Page ID are hard-coded below (they never change).
 *
 * Usage (from the GitHub Action, after garde.json is (re)generated):
 *   node scripts/publish-to-blogger.mjs
 *
 * Env vars required: BLOGGER_CLIENT_ID, BLOGGER_CLIENT_SECRET, BLOGGER_REFRESH_TOKEN
 * Optional: GARDE_JSON_PATH (default "public/garde.json")
 */

import fs from 'node:fs';

const BLOGGER_BLOG_ID = '8452204387409245713';   // MOVO (FR) blog — do not change
const BLOGGER_PAGE_ID = '8499368874513364589';    // /p/pharmacie-de-garde-agadir.html — do not change
const START_MARKER = '<!--PG:START-->';
const END_MARKER = '<!--PG:END-->';

const {
  BLOGGER_CLIENT_ID,
  BLOGGER_CLIENT_SECRET,
  BLOGGER_REFRESH_TOKEN,
  GARDE_JSON_PATH = 'public/garde.json',
} = process.env;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localParts(timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = {};
  fmt.formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return { date: `${p.year}-${p.month}-${p.day}`, heure: `${p.hour}:${p.minute}` };
}

function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateLisible(date) {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function lienCarte(p) {
  const q = (p.lat != null && p.lng != null)
    ? `${p.lat},${p.lng}`
    : [p.nom, p.adresse, p.quartier, 'Agadir'].filter(Boolean).join(', ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

function carte(p) {
  const adr = [p.quartier, p.adresse].filter(Boolean).join(' — ');
  const telBtn = p.telephone
    ? `<a class="pg-btn pg-btn-tel" href="tel:${esc(p.telephone.replace(/\s+/g, ''))}">📞 ${esc(p.telephone)}</a>`
    : '';
  const mapBtn = `<a class="pg-btn pg-btn-carte" href="${esc(lienCarte(p))}" target="_blank" rel="noopener">Itinéraire</a>`;
  return (
    `<li class="pg-carte">` +
      `<h3 class="pg-nom">${esc(p.nom)}</h3>` +
      `<p class="pg-adr">${esc(adr)}</p>` +
      (p.garde ? `<p class="pg-type">Garde ${esc(p.garde)}</p>` : '') +
      `<div class="pg-actions">${telBtn}${mapBtn}</div>` +
    `</li>`
  );
}

function listeParZone(pharmacies) {
  const zones = {};
  pharmacies.forEach((p) => {
    const z = p.zone || 'Agadir';
    (zones[z] = zones[z] || []).push(p);
  });
  return Object.keys(zones).map((z) => {
    const items = zones[z].map(carte).join('');
    return `<h3 class="pg-zone">${esc(z)}</h3><ul class="pg-liste">${items}</ul>`;
  }).join('');
}

// Mirrors the client-side afficher() function exactly, but returns an HTML
// string instead of manipulating the DOM.
function render(data) {
  const maintenant = localParts(data.fuseau);
  const aujourdhui = maintenant.heure < data.heure_bascule
    ? addDays(maintenant.date, -1)
    : maintenant.date;

  const parDate = {};
  (data.jours || []).forEach((j) => { parDate[j.date] = j.pharmacies; });

  let out = '';
  out += `<h2 class="pg-titre">Pharmacies de garde à ${esc(data.ville || 'Agadir')}</h2>`;
  out += `<p class="pg-titre-ar">صيدليات الحراسة بأكادير</p>`;
  out += `<p class="pg-periode">Garde du ${esc(dateLisible(aujourdhui))}.</p>`;

  if (data.exemple) {
    out += `<p class="pg-alerte">Données d'exemple : la liste réelle des pharmacies n'a pas encore été saisie.</p>`;
  }

  const liste = parDate[aujourdhui];
  const hier = parDate[addDays(aujourdhui, -1)];

  if ((!liste || !liste.length) && hier && hier.length) {
    out += `<p class="pg-alerte">La liste d'aujourd'hui n'est pas encore publiée : voici la garde d'hier (${esc(dateLisible(addDays(aujourdhui, -1)))}), souvent encore valable le matin. Appelez la pharmacie avant de vous déplacer.</p>`;
    out += listeParZone(hier);
  } else if (!liste || !liste.length) {
    out += `<p class="pg-alerte">La liste de garde d'aujourd'hui n'est pas encore mise à jour. Vérifiez sur agadir.pharmacieenpermanence.ma ou appelez le 141 (SAMU) en cas d'urgence.</p>`;
  } else {
    out += listeParZone(liste);
  }

  const majTxt = new Date(data.genere_le).toLocaleString('fr-FR', { timeZone: data.fuseau });
  out += `<p class="pg-maj">D'après Pharmacie en permanence et Annuaire Gratuit. Mis à jour le ${esc(majTxt)}. Appelez la pharmacie avant de vous déplacer.</p>`;
  out += `<p class="pg-urgence">Urgences : SAMU 141 · Protection civile 150 · Police 19</p>`;

  return out;
}

async function getAccessToken() {
  if (!BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET || !BLOGGER_REFRESH_TOKEN) {
    throw new Error('Missing BLOGGER_CLIENT_ID / BLOGGER_CLIENT_SECRET / BLOGGER_REFRESH_TOKEN env vars (set them as GitHub Secrets).');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: BLOGGER_CLIENT_ID,
      client_secret: BLOGGER_CLIENT_SECRET,
      refresh_token: BLOGGER_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(GARDE_JSON_PATH, 'utf8'));
  const innerHtml = render(data);

  const token = await getAccessToken();
  const api = `https://www.googleapis.com/blogger/v3/blogs/${BLOGGER_BLOG_ID}/pages/${BLOGGER_PAGE_ID}`;

  const getRes = await fetch(api, { headers: { Authorization: `Bearer ${token}` } });
  if (!getRes.ok) throw new Error(`GET page failed (${getRes.status}): ${await getRes.text()}`);
  const page = await getRes.json();

  const html = page.content;
  const si = html.indexOf(START_MARKER);
  const ei = html.indexOf(END_MARKER);
  if (si === -1 || ei === -1 || ei < si) {
    throw new Error(
      `Markers ${START_MARKER} / ${END_MARKER} not found in the Blogger page content. ` +
      `Run the one-time setup edit in the Blogger HTML editor first (see README).`
    );
  }

  const newHtml = html.slice(0, si + START_MARKER.length) + innerHtml + html.slice(ei);

  if (newHtml === html) {
    console.log('No change since last run — skipping Blogger update.');
    return;
  }

  // PATCH (not PUT): a PUT replaces the whole page resource, so sending only
  // `content` wiped the page title (Google then showed "MOVO" as title and H1).
  // The title is also sent explicitly, with a fallback, so it can never be emptied.
  const PAGE_TITLE = "Pharmacie de garde Agadir aujourd'hui (24h/24) — liste du jour | MOVO";
  const patchRes = await fetch(api, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: (page.title && page.title.trim()) || PAGE_TITLE, content: newHtml }),
  });
  if (!patchRes.ok) throw new Error(`PATCH page failed (${patchRes.status}): ${await patchRes.text()}`);

  console.log('Blogger page updated with the static pharmacy list.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
