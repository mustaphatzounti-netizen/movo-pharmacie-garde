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
// Optional second pair, outside #pg-garde, for the daily JSON-LD (FR page only).
const LD_START_MARKER = '<!--PG:LD:START-->';
const LD_END_MARKER = '<!--PG:LD:END-->';
const FR_PAGE_URL = 'https://www.agadir-livraison.com/p/pharmacie-de-garde-agadir.html';
const AR_PAGE_URL = 'https://ar.agadir-livraison.com/p/saydaliya-hirasa-agadir.html';
const WHATSAPP_MOVO = '212605577990';

// Per-page settings for the French pages (Agadir + nearby cities). Agadir texts are unchanged.
const CFG_AGADIR = {
  url: FR_PAGE_URL,
  ville: 'Agadir',
  titreAr: 'صيدليات الحراسة بأكادير',
  attenteTxt: "La liste de garde d'aujourd'hui n'est pas encore mise à jour. Vérifiez sur agadir.pharmacieenpermanence.ma ou appelez le 141 (SAMU) en cas d'urgence.",
  sourcesTxt: "D'après Telecontact, Annuaire Gratuit et Le Matin : seules les pharmacies citées par au moins deux sources sont affichées.",
};
const CFG_VILLES = [
  {
    label: 'FR-INEZGANE',
    pageId: '553793497194857918',
    jsonPath: 'public/garde-inezgane.json',
    fallbackTitle: "Pharmacie de garde Inezgane aujourd'hui — liste du jour | MOVO",
    cfg: {
      url: 'https://www.agadir-livraison.com/p/pharmacie-de-garde-inezgane.html',
      ville: 'Inezgane',
      titreAr: 'صيدليات الحراسة بإنزكان',
      attenteTxt: "La liste de garde d'aujourd'hui n'est pas encore mise à jour. Appelez la pharmacie avant de vous déplacer, ou le 141 (SAMU) en cas d'urgence.",
      sourcesTxt: "D'après Telecontact et Annuaire Gratuit : seules les pharmacies citées par les deux sont affichées.",
    },
  },
  {
    label: 'FR-AIT-MELLOUL',
    pageId: '2590725670696039709',
    jsonPath: 'public/garde-ait-melloul.json',
    fallbackTitle: "Pharmacie de garde Aït Melloul aujourd'hui — liste du jour | MOVO",
    cfg: {
      url: 'https://www.agadir-livraison.com/p/pharmacie-de-garde-ait-melloul.html',
      ville: 'Aït Melloul',
      titreAr: 'صيدليات الحراسة بأيت ملول',
      attenteTxt: "La liste de garde d'aujourd'hui n'est pas encore mise à jour. Appelez la pharmacie avant de vous déplacer, ou le 141 (SAMU) en cas d'urgence.",
      sourcesTxt: "D'après Telecontact et Annuaire Gratuit : seules les pharmacies citées par les deux sont affichées.",
    },
  },
];

// Arabic site (ar.agadir-livraison.com) — same static list, Arabic labels.
const AR_BLOG_ID = '6023995067592991740'; // ليفرور أكادير MOVO (AR) blog — do not change
const AR_PAGE_ID = '1530460365316216242'; // /p/saydaliya-hirasa-agadir.html — do not change
const FR_PAGE_TITLE = "Pharmacie de garde Agadir aujourd'hui (24h/24) — liste du jour | MOVO";
const AR_PAGE_TITLE = 'صيدلية الحراسة أكادير اليوم 24/24 — لائحة اليوم | MOVO';

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

// Phrase-réponse du jour (pour Google et les assistants IA) : même texte que dans les widgets.
function listeNoms(noms, et) {
  return noms.length > 1 ? noms.slice(0, -1).join(', ') + ' ' + et + ' ' + noms[noms.length - 1] : (noms[0] || '');
}

function resume(pharmacies, date, ville) {
  const n = pharmacies.length;
  const t = {};
  pharmacies.forEach((p) => { t[p.garde || ''] = (t[p.garde || ''] || 0) + 1; });
  let fin = '';
  if (t['24h/24'] === n) fin = n > 1 ? ', toutes ouvertes 24h/24' : ', ouverte 24h/24';
  else {
    const parts = [];
    if (t['24h/24']) parts.push(t['24h/24'] + ' ouverte' + (t['24h/24'] > 1 ? 's' : '') + ' 24h/24');
    if (t.Jour) parts.push(t.Jour + ' de jour');
    if (t.Nuit) parts.push(t.Nuit + ' de nuit');
    if (parts.length) fin = ' (' + parts.join(', ') + ')';
  }
  return `Aujourd'hui, ${dateLisible(date)} ${date.slice(0, 4)}, ${n} pharmacie${n > 1 ? 's sont' : ' est'} de garde à ${ville} : ${listeNoms(pharmacies.map((p) => p.nom), 'et')}${fin}.`;
}

function resumeAr(pharmacies, date) {
  const n = pharmacies.length;
  const tous24 = pharmacies.every((p) => p.garde === '24h/24');
  const noms = pharmacies.map((p) => p.nom);
  const liste = noms.length > 1 ? noms.slice(0, -1).join('، ') + ' و' + noms[noms.length - 1] : (noms[0] || '');
  return `صيدليات الحراسة في أكادير اليوم، ${dateLisibleAr(date)} ${date.slice(0, 4)}، عددها ${n}: ${liste}${tous24 ? '، كلها مفتوحة 24/24' : ''}.`;
}

function lienCarte(p, ville = 'Agadir') {
  const q = (p.lat != null && p.lng != null)
    ? `${p.lat},${p.lng}`
    : [p.nom, p.adresse, p.quartier, ville].filter(Boolean).join(', ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

// WhatsApp MOVO : livraison depuis cette pharmacie de garde (same text as the client widget).
function lienLivraison(p, cfg) {
  return `https://wa.me/${WHATSAPP_MOVO}?text=` + encodeURIComponent(
    `Bonjour MOVO, je voudrais me faire livrer un médicament depuis la ${p.nom} (pharmacie de garde, ${cfg.ville}).`);
}

// Share today's list on WhatsApp (same text as the client widget).
function lienPartage(pharmacies, date, cfg) {
  const lignes = [`Pharmacies de garde à ${cfg.ville} — ${dateLisible(date)} :`];
  pharmacies.forEach((p) => { lignes.push('• ' + p.nom + (p.telephone ? ' — ' + p.telephone : '')); });
  lignes.push('', 'Liste à jour : ' + cfg.url);
  return 'https://wa.me/?text=' + encodeURIComponent(lignes.join('\n'));
}

function carte(p, cfg) {
  const adr = [p.quartier, p.adresse].filter(Boolean).join(' — ');
  const telBtn = p.telephone
    ? `<a class="pg-btn pg-btn-tel" href="tel:${esc(p.telephone.replace(/\s+/g, ''))}">📞 ${esc(p.telephone)}</a>`
    : '';
  const mapBtn = `<a class="pg-btn pg-btn-carte" href="${esc(lienCarte(p, cfg.ville))}" target="_blank" rel="noopener">Itinéraire</a>`;
  const livrerBtn = `<a class="pg-btn pg-btn-livrer" href="${esc(lienLivraison(p, cfg))}" target="_blank" rel="noopener">🛵 Me faire livrer</a>`;
  return (
    `<li class="pg-carte">` +
      `<h3 class="pg-nom">${esc(p.nom)}</h3>` +
      `<p class="pg-adr">${esc(adr)}</p>` +
      (p.garde ? `<p class="pg-type">Garde ${esc(p.garde)}</p>` : '') +
      `<div class="pg-actions">${telBtn}${mapBtn}${livrerBtn}</div>` +
    `</li>`
  );
}

// Zone headings only when there is more than one zone (same as the client widget).
function listeParZone(pharmacies, cfg) {
  const zones = {};
  pharmacies.forEach((p) => {
    const z = p.zone || cfg.ville;
    (zones[z] = zones[z] || []).push(p);
  });
  const noms = Object.keys(zones);
  return noms.map((z) => {
    const items = zones[z].map((p) => carte(p, cfg)).join('');
    return (noms.length > 1 ? `<h3 class="pg-zone">${esc(z)}</h3>` : '') + `<ul class="pg-liste">${items}</ul>`;
  }).join('');
}

// Tool bar above the list: nearest pharmacy (handled by the client script) + WhatsApp share.
function outils(pharmacies, date, cfg) {
  return (
    `<div class="pg-outils">` +
      `<button type="button" class="pg-btn pg-btn-proche">📍 La plus proche de moi</button>` +
      `<a class="pg-btn pg-btn-wa" href="${esc(lienPartage(pharmacies, date, cfg))}" target="_blank" rel="noopener">Envoyer la liste sur WhatsApp</a>` +
    `</div>` +
    `<p class="pg-info" hidden></p>`
  );
}

// Which list is shown: today's, or yesterday's as a morning fallback.
function listeDuJour(data) {
  const maintenant = localParts(data.fuseau);
  const aujourdhui = maintenant.heure < data.heure_bascule
    ? addDays(maintenant.date, -1)
    : maintenant.date;
  const parDate = {};
  (data.jours || []).forEach((j) => { parDate[j.date] = j.pharmacies; });
  const liste = parDate[aujourdhui];
  const hier = parDate[addDays(aujourdhui, -1)];
  if (liste && liste.length) return { aujourdhui, pharmacies: liste, date: aujourdhui, veille: false };
  if (hier && hier.length) return { aujourdhui, pharmacies: hier, date: addDays(aujourdhui, -1), veille: true };
  return { aujourdhui, pharmacies: null, date: aujourdhui, veille: false };
}

// Mirrors the client-side afficher() function exactly (initial state, before
// "nearest pharmacy" sorting), but returns an HTML string instead of manipulating the DOM.
function render(data, cfg = CFG_AGADIR) {
  const { aujourdhui, pharmacies, date, veille } = listeDuJour(data);

  let out = '';
  out += `<h2 class="pg-titre">Pharmacies de garde à ${esc(data.ville || cfg.ville)}</h2>`;
  out += `<p class="pg-titre-ar">${esc(cfg.titreAr)}</p>`;
  out += `<p class="pg-periode">Garde du ${esc(dateLisible(aujourdhui))}.</p>`;
  if (pharmacies && !veille) out += `<p class="pg-resume">${esc(resume(pharmacies, date, data.ville || cfg.ville))}</p>`;

  if (data.exemple) {
    out += `<p class="pg-alerte">Données d'exemple : la liste réelle des pharmacies n'a pas encore été saisie.</p>`;
  }

  if (pharmacies && veille) {
    out += `<p class="pg-alerte">La liste d'aujourd'hui n'est pas encore publiée : voici la garde d'hier (${esc(dateLisible(date))}), souvent encore valable le matin. Appelez la pharmacie avant de vous déplacer.</p>`;
  } else if (!pharmacies) {
    out += `<p class="pg-alerte">${esc(cfg.attenteTxt)}</p>`;
  }
  if (pharmacies) {
    out += outils(pharmacies, date, cfg);
    out += `<div class="pg-resultats">${listeParZone(pharmacies, cfg)}</div>`;
  }

  const majTxt = new Date(data.genere_le).toLocaleString('fr-FR', { timeZone: data.fuseau });
  out += `<p class="pg-maj">${esc(cfg.sourcesTxt)} Mis à jour le ${esc(majTxt)}. Appelez la pharmacie avant de vous déplacer.</p>`;
  out += `<p class="pg-urgence">Urgences : SAMU 141 · Protection civile 150 · Police 19</p>`;

  return out;
}

// JSON-LD for the FR page only: the list shown today as an ItemList of Pharmacy,
// merged (same @id) with the WebPage node the Blogger theme already outputs,
// plus a daily dateModified. Written between PG:LD markers, OUTSIDE #pg-garde,
// so the client script (which re-renders #pg-garde) never removes it.
function renderLd(data, cfg = CFG_AGADIR) {
  const { pharmacies, date } = listeDuJour(data);
  if (!pharmacies) return '';
  const listeId = `${cfg.url}#garde-du-jour`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${cfg.url}#webpage`,
        dateModified: data.genere_le,
        mainEntity: { '@id': listeId },
      },
      {
        '@type': 'ItemList',
        '@id': listeId,
        name: `Pharmacies de garde à ${cfg.ville} — ${dateLisible(date)}`,
        itemListOrder: 'https://schema.org/ItemListUnordered',
        numberOfItems: pharmacies.length,
        itemListElement: pharmacies.map((p, i) => {
          const item = {
            '@type': 'Pharmacy',
            name: p.nom,
            address: {
              '@type': 'PostalAddress',
              streetAddress: [p.quartier, p.adresse].filter(Boolean).join(', '),
              addressLocality: cfg.ville,
              addressCountry: 'MA',
            },
          };
          if (p.telephone) item.telephone = p.telephone;
          if (p.lat != null && p.lng != null) item.geo = { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng };
          if (p.garde) item.description = `Pharmacie de garde ${p.garde} à ${cfg.ville} le ${dateLisible(date)}.`;
          return { '@type': 'ListItem', position: i + 1, item };
        }),
      },
    ],
  };
  return `<script type="application/ld+json">${jsonSur(graph)}</script>`;
}

// JSON for a <script> inside Blogger content: escape <, >, & and every non-ASCII character,
// because Blogger turns some characters (— · …) into HTML entities inside <script>.
function jsonSur(obj) {
  return JSON.stringify(obj)
    .replace(/[<>&]|[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}


// ---- Arabic version (mirrors the client-side script on the AR Blogger page) ----
function dateLisibleAr(date) {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('ar-MA-u-nu-latn', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

// WhatsApp MOVO (Arabic page): delivery from this pharmacy — same text as the AR client widget.
function lienLivraisonAr(p) {
  return `https://wa.me/${WHATSAPP_MOVO}?text=` + encodeURIComponent(
    `السلام عليكم MOVO، بغيت توصلوني دوا من ${p.nom} (صيدلية الحراسة، أكادير).`);
}

function lienPartageAr(pharmacies, date) {
  const lignes = [`صيدليات الحراسة في أكادير — ${dateLisibleAr(date)}:`];
  pharmacies.forEach((p) => { lignes.push('• ' + p.nom + (p.telephone ? ' — ' + p.telephone : '')); });
  lignes.push('', 'اللائحة محدثة: ' + AR_PAGE_URL);
  return 'https://wa.me/?text=' + encodeURIComponent(lignes.join('\n'));
}

function carteAr(p) {
  const adr = [p.quartier, p.adresse].filter(Boolean).join(' — ');
  const telBtn = p.telephone
    ? `<a class="pg-btn pg-btn-tel" href="tel:${esc(p.telephone.replace(/\s+/g, ''))}">📞 <span dir="ltr">${esc(p.telephone)}</span></a>`
    : '';
  const mapBtn = `<a class="pg-btn pg-btn-carte" href="${esc(lienCarte(p))}" target="_blank" rel="noopener">الطريق</a>`;
  const livrerBtn = `<a class="pg-btn pg-btn-livrer" href="${esc(lienLivraisonAr(p))}" target="_blank" rel="noopener">🛵 وصّلها لي</a>`;
  return (
    `<li class="pg-carte">` +
    `<h3 class="pg-nom" dir="auto">${esc(p.nom)}</h3>` +
    `<p class="pg-adr" dir="auto">${esc(adr)}</p>` +
    (p.garde ? `<p class="pg-type">حراسة ${esc(p.garde)}</p>` : '') +
    `<div class="pg-actions">${telBtn}${mapBtn}${livrerBtn}</div>` +
    `</li>`
  );
}

// Zone headings only when there is more than one zone (same as the AR client widget).
function listeParZoneAr(pharmacies) {
  const zones = {};
  pharmacies.forEach((p) => {
    const z = p.zone || 'Agadir';
    (zones[z] = zones[z] || []).push(p);
  });
  const noms = Object.keys(zones);
  return noms.map((z) => {
    const nom = z === 'Agadir' ? 'أكادير' : z;
    return (noms.length > 1 ? `<h3 class="pg-zone">${esc(nom)}</h3>` : '') + `<ul class="pg-liste">${zones[z].map(carteAr).join('')}</ul>`;
  }).join('');
}

function outilsAr(pharmacies, date) {
  return (
    `<div class="pg-outils">` +
      `<button type="button" class="pg-btn pg-btn-proche">📍 أقرب صيدلية لي</button>` +
      `<a class="pg-btn pg-btn-wa" href="${esc(lienPartageAr(pharmacies, date))}" target="_blank" rel="noopener">أرسل اللائحة في واتساب</a>` +
    `</div>` +
    `<p class="pg-info" hidden></p>`
  );
}

// Mirrors the AR client widget (initial state, before "nearest pharmacy" sorting).
function renderAr(data) {
  const { aujourdhui, pharmacies, date, veille } = listeDuJour(data);

  let out = '';
  out += `<h2 class="pg-titre">صيدليات الحراسة في أكادير اليوم</h2>`;
  out += `<p class="pg-titre-ar" lang="fr" dir="ltr">Pharmacies de garde Agadir</p>`;
  out += `<p class="pg-periode">حراسة يوم ${esc(dateLisibleAr(aujourdhui))}.</p>`;
  if (pharmacies && !veille) out += `<p class="pg-resume">${esc(resumeAr(pharmacies, date))}</p>`;

  if (data.exemple) {
    out += `<p class="pg-alerte">بيانات تجريبية: اللائحة الحقيقية للصيدليات لم تُدخل بعد.</p>`;
  }

  if (pharmacies && veille) {
    out += `<p class="pg-alerte">لائحة اليوم لم تُنشر بعد: هذه حراسة البارح (${esc(dateLisibleAr(date))})، غالباً مازالت صالحة في الصباح. اتصل بالصيدلية قبل أن تتنقل.</p>`;
  } else if (!pharmacies) {
    out += `<p class="pg-alerte">لائحة حراسة اليوم لم تُحدث بعد. تحقق في agadir.pharmacieenpermanence.ma أو اتصل بـ 141 (SAMU) في حالة الطوارئ.</p>`;
  }
  if (pharmacies) {
    out += outilsAr(pharmacies, date);
    out += `<div class="pg-resultats">${listeParZoneAr(pharmacies)}</div>`;
  }

  const majTxt = new Date(data.genere_le).toLocaleString('fr-FR', { timeZone: data.fuseau });
  out += `<p class="pg-maj">حسب Telecontact وAnnuaire Gratuit وLe Matin (نعرض فقط الصيدليات التي يذكرها مصدران على الأقل). آخر تحديث: <span dir="ltr">${esc(majTxt)}</span>. اتصل بالصيدلية قبل أن تتنقل.</p>`;
  out += `<p class="pg-urgence">الطوارئ: الإسعاف 141 · الوقاية المدنية 150 · الشرطة 19</p>`;

  return out;
}

// JSON-LD for the Arabic page (same idea as renderLd, Arabic names).
function renderLdAr(data) {
  const { pharmacies, date } = listeDuJour(data);
  if (!pharmacies) return '';
  const listeId = `${AR_PAGE_URL}#garde-du-jour`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': `${AR_PAGE_URL}#webpage`, dateModified: data.genere_le, mainEntity: { '@id': listeId } },
      {
        '@type': 'ItemList',
        '@id': listeId,
        name: `صيدليات الحراسة في أكادير — ${dateLisibleAr(date)}`,
        inLanguage: 'ar',
        itemListOrder: 'https://schema.org/ItemListUnordered',
        numberOfItems: pharmacies.length,
        itemListElement: pharmacies.map((p, i) => {
          const item = {
            '@type': 'Pharmacy',
            name: p.nom,
            address: { '@type': 'PostalAddress', streetAddress: [p.quartier, p.adresse].filter(Boolean).join(', '), addressLocality: 'Agadir', addressCountry: 'MA' },
          };
          if (p.telephone) item.telephone = p.telephone;
          if (p.lat != null && p.lng != null) item.geo = { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng };
          return { '@type': 'ListItem', position: i + 1, item };
        }),
      },
    ],
  };
  return `<script type="application/ld+json">${jsonSur(graph)}</script>`;
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

// Replaces what is between two markers; returns null if the markers are missing.
function splice(html, startMarker, endMarker, inner) {
  const si = html.indexOf(startMarker);
  const ei = html.indexOf(endMarker, si + startMarker.length);
  if (si === -1 || ei === -1) return null;
  return html.slice(0, si + startMarker.length) + inner + html.slice(ei);
}

async function publishPage(token, { label, blogId, pageId, fallbackTitle, innerHtml, ldHtml }) {
  const api = `https://www.googleapis.com/blogger/v3/blogs/${blogId}/pages/${pageId}`;

  const getRes = await fetch(api, { headers: { Authorization: `Bearer ${token}` } });
  if (!getRes.ok) throw new Error(`GET page failed (${getRes.status}): ${await getRes.text()}`);
  const page = await getRes.json();

  const html = page.content;
  let newHtml = splice(html, START_MARKER, END_MARKER, innerHtml);
  if (newHtml === null) {
    throw new Error(
      `Markers ${START_MARKER} / ${END_MARKER} not found in the Blogger page content. ` +
      `Run the one-time setup edit in the Blogger HTML editor first (see README).`
    );
  }

  if (ldHtml != null) {
    const withLd = splice(newHtml, LD_START_MARKER, LD_END_MARKER, ldHtml);
    if (withLd === null) console.warn(`[${label}] JSON-LD markers not found — list published without JSON-LD.`);
    else newHtml = withLd;
  }

  if (newHtml === html) {
    console.log(`[${label}] No change since last run — skipping Blogger update.`);
    return;
  }

  // PATCH (not PUT): a PUT replaces the whole page resource, so sending only
  // `content` wiped the page title (Google then showed "MOVO" as title and H1).
  // The title is also sent explicitly, with a fallback, so it can never be emptied.
  const patchRes = await fetch(api, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: (page.title && page.title.trim()) || fallbackTitle, content: newHtml }),
  });
  if (!patchRes.ok) throw new Error(`PATCH page failed (${patchRes.status}): ${await patchRes.text()}`);

  console.log(`[${label}] Blogger page updated with the static pharmacy list.`);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(GARDE_JSON_PATH, 'utf8'));
  const token = await getAccessToken();

  // Each page is published independently: a failure on one does not block the other.
  const targets = [
    { label: 'FR', blogId: BLOGGER_BLOG_ID, pageId: BLOGGER_PAGE_ID, fallbackTitle: FR_PAGE_TITLE, innerHtml: render(data), ldHtml: renderLd(data) },
    { label: 'AR', blogId: AR_BLOG_ID, pageId: AR_PAGE_ID, fallbackTitle: AR_PAGE_TITLE, innerHtml: renderAr(data), ldHtml: renderLdAr(data) },
  ];

  // Nearby cities: only pages that exist (real page id) and whose JSON file was generated.
  for (const v of CFG_VILLES) {
    if (!/^\d+$/.test(v.pageId) || !fs.existsSync(v.jsonPath)) continue;
    const dv = JSON.parse(fs.readFileSync(v.jsonPath, 'utf8'));
    targets.push({
      label: v.label, blogId: BLOGGER_BLOG_ID, pageId: v.pageId, fallbackTitle: v.fallbackTitle,
      innerHtml: render(dv, v.cfg), ldHtml: renderLd(dv, v.cfg),
    });
  }

  let failed = 0;
  for (const t of targets) {
    try {
      await publishPage(token, t);
    } catch (err) {
      failed++;
      console.error(`[${t.label}]`, err);
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
