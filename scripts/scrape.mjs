// Récupère la garde du jour à Agadir sur trois sources, les recoupe par vote majoritaire et met à
// jour public/garde.json.
//
// Règle de sécurité : au moins deux sources doivent afficher la date du jour, sinon rien n'est
// écrit. Parmi les sources qui confirment la date, une pharmacie n'est retenue que si au moins
// deux d'entre elles la citent (ou toutes, s'il n'y en a que deux de disponibles ce jour-là) :
// cela évite qu'une seule source en panne ou incomplète bloque toute la publication, tout en
// gardant une vraie vérification croisée.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';

export const SOURCES = {
  tc: 'https://www.telecontact.ma/pharmacie-de-garde-zone-jour/agadir/1/autre.html',
  ag: 'https://www.annuaire-gratuit.ma/pharmacie-garde-agadir.html',
  lm: 'https://lematin.ma/pharmacie-garde/agadir/jour/agadir',
};
const FUSEAU = 'Africa/Casablanca';
const SORTIE = new URL('../public/garde.json', import.meta.url);
const MOIS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };

const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const propre = (s) => (s || '').replace(/\s+/g, ' ').trim().replace(/\s+,/g, ',');
export const cle = (nom) => sansAccents(nom).toLowerCase().replace(/\bpharmacie\b/g, '').replace(/[^a-z0-9]/g, '');
const titreAdresse = (s) => s.replace(/(^|[\s,(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());

export function dateFr(texte) {
  const m = sansAccents(texte).toLowerCase().match(/(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{4})/);
  if (!m || !MOIS[m[2]]) return null;
  return `${m[3]}-${String(MOIS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export function aujourdhui(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function telephone(brut) {
  let d = (brut || '').replace(/\D/g, '');
  if (d.startsWith('212')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length !== 9) return null;
  return '+212' + d;
}

// Source principale (remplace pharmacieenpermanence.ma, qui n'affichait plus la date du jour) :
// nom, adresse, téléphone, type de garde et coordonnées GPS (tirées du lien Itinéraire).
export function parseTelecontact(html) {
  const $ = cheerio.load(html);
  const date = dateFr(($('body').text().match(/Gardes du\s+([^\n<]{6,40})/) || [])[1] || '');
  const pharmacies = $('article.pharma-carte').map((_, a) => {
    const $a = $(a);
    const dirHref = $a.find('.pharma-itineraire-menu a').first().attr('href') || '';
    const coords = dirHref.match(/destination=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    return {
      nom: propre($a.find('h3 a').first().text()),
      adresse: propre($a.find('.pharma-adresse').first().text()),
      telephone: telephone($a.find('a.pharma-appeler').first().attr('href')),
      type: propre($a.find('.pharma-badge').first().text()),
      lat: coords ? Number(coords[1]) : null,
      lng: coords ? Number(coords[2]) : null,
    };
  }).get().filter((p) => p.nom);
  return { date, pharmacies };
}

export function parseAg(html) {
  const $ = cheerio.load(html);
  const titre = $('h1').first().text() + ' ' + $('title').text();
  const date = dateFr((titre.match(/Aujourd.hui\s+\S+\s+([^,()]+\d{4})/i) || [])[1] || '');
  const pharmacies = $('li.ag_pharmacy_card').map((_, li) => {
    const $l = $(li);
    const infos = {};
    $l.find('.ag_pharmacy_info_item').each((_, it) => {
      const t = propre($(it).text());
      const m = t.match(/^(Quartier|Garde)\s+(.*)$/);
      if (m) infos[m[1]] = m[2];
    });
    return {
      nom: propre($l.find('[itemprop="name"]').first().text() || $l.find('.ag_pharmacy_card_title').first().text()),
      adresse: propre($l.find('[itemprop="streetAddress"]').first().text()),
      quartier: infos.Quartier || '',
      garde: infos.Garde || '',
    };
  }).get().filter((p) => p.nom);
  return { date, pharmacies };
}

// Troisième source : lematin.ma ne donne ni téléphone ni quartier, seulement les noms — elle sert
// uniquement au vote majoritaire (date + présence d'une pharmacie), jamais à fournir les détails.
export function parseLematin(html) {
  const $ = cheerio.load(html);
  const date = dateFr(($('body').text().match(/[a-zéû]+\s+\d{1,2}\s+[a-zéû]+\s+\d{4}/i) || [])[0] || '');
  const pharmacies = $('.ph-record').map((_, el) => ({
    nom: propre($(el).find('.ph-name').first().text()),
  })).get().filter((p) => p.nom);
  return { date, pharmacies };
}

function construireRecord(nom, recs) {
  const tc = recs.get('telecontact.ma');
  const ag = recs.get('annuaire-gratuit');
  const adresseTc = tc ? tc.adresse : '';
  const adresseAg = ag ? titreAdresse(ag.adresse) : '';
  const adresse = adresseTc.length >= adresseAg.length ? adresseTc : adresseAg;
  const typeTxt = (tc ? tc.type : '') + ' ' + (ag ? ag.garde : '');
  const vingtQuatre = /24\s*h|jour et nuit/i.test(typeTxt);
  return {
    id: cle(nom),
    nom,
    zone: 'Agadir',
    quartier: ag ? ag.quartier : '',
    adresse,
    telephone: tc ? tc.telephone : null,
    garde: vingtQuatre ? '24h/24' : (/nuit/i.test(typeTxt) ? 'Nuit' : 'Jour'),
    lat: tc && tc.lat != null ? tc.lat : null,
    lng: tc && tc.lng != null ? tc.lng : null,
  };
}

// Vote majoritaire sur plusieurs sources (2 ou 3). `sources` : [{ nom, data: { date, pharmacies } }].
// Au moins 2 sources doivent confirmer la date du jour ; une pharmacie n'est retenue que si elle
// est citée par au moins 2 des sources qui confirment la date (ou par les 2, s'il n'y en a que 2).
export function fusionnerPlusieurs(sources, jour) {
  const erreurs = [];
  sources.forEach((s) => {
    if (s.data.date !== jour) erreurs.push(`${s.nom} affiche la date ${s.data.date}, pas ${jour}`);
    else if (!s.data.pharmacies.length) erreurs.push(`${s.nom} : aucune pharmacie lue`);
  });
  const valides = sources.filter((s) => s.data.date === jour && s.data.pharmacies.length);
  if (valides.length < 2) {
    erreurs.push(`seulement ${valides.length} source(s) confirment la date du jour (2 minimum requises)`);
    return { erreurs };
  }

  const comptes = new Map(); // cle -> { nom, count, recs: Map(sourceNom -> pharmacie) }
  for (const s of valides) {
    for (const p of s.data.pharmacies) {
      const k = cle(p.nom);
      if (!comptes.has(k)) comptes.set(k, { nom: p.nom, count: 0, recs: new Map() });
      const e = comptes.get(k);
      e.count++;
      e.recs.set(s.nom, p);
      if (!e.nomLong || p.nom.length > e.nomLong.length) e.nomLong = p.nom;
    }
  }
  const seuil = valides.length >= 3 ? 2 : valides.length;
  const retenues = [...comptes.values()].filter((e) => e.count >= seuil);
  const ecartees = [...comptes.values()].filter((e) => e.count < seuil).map((e) => `${e.nomLong} (${e.count}/${valides.length})`);
  if (ecartees.length) erreurs.push(`écartées faute de confirmation croisée : ${ecartees.join(', ')}`);
  if (!retenues.length) {
    erreurs.push('aucune pharmacie confirmée par au moins deux sources');
    return { erreurs };
  }

  const pharmacies = retenues
    .map((e) => construireRecord(e.nomLong, e.recs))
    .sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
  return { erreurs: [], avertissements: erreurs, pharmacies };
}

async function telecharger(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; movo-pharmacie-garde; +https://www.agadir-livraison.com/)', 'accept-language': 'fr' } });
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  return r.text();
}

async function main() {
  const jour = process.argv.includes('--date') ? process.argv[process.argv.indexOf('--date') + 1] : aujourdhui();
  const [tc, ag] = await Promise.all([telecharger(SOURCES.tc).then(parseTelecontact), telecharger(SOURCES.ag).then(parseAg)]);
  console.log(`telecontact.ma : ${tc.date}, ${tc.pharmacies.length} pharmacies`);
  console.log(`annuaire-gratuit : ${ag.date}, ${ag.pharmacies.length} pharmacies`);

  const sources = [{ nom: 'telecontact.ma', data: tc }, { nom: 'annuaire-gratuit', data: ag }];
  try {
    const lm = await telecharger(SOURCES.lm).then(parseLematin);
    console.log(`lematin.ma : ${lm.date}, ${lm.pharmacies.length} pharmacies`);
    sources.push({ nom: 'lematin.ma', data: lm });
  } catch (e) {
    console.log('::warning::lematin.ma injoignable, vote à 2 sources seulement : ' + e.message);
  }

  const { erreurs, avertissements, pharmacies } = fusionnerPlusieurs(sources, jour);
  (avertissements || []).forEach((w) => console.log('::warning::' + w));
  if (erreurs.length) {
    erreurs.forEach((e) => console.log('::warning::' + e));
    console.log('Rien publié : la page garde la liste précédente et affichera un avertissement.');
    process.exit(3);
  }

  let ancien = { jours: [] };
  try { ancien = JSON.parse(await readFile(SORTIE, 'utf8')); } catch {}
  const jours = (ancien.exemple ? [] : ancien.jours || []).filter((j) => j.date < jour).slice(-2);
  jours.push({ date: jour, pharmacies });
  const avant = JSON.stringify((ancien.jours || []).find((j) => j.date === jour)?.pharmacies);
  if (avant === JSON.stringify(pharmacies) && !ancien.exemple && ancien.heure_bascule === '00:00') { console.log('Déjà à jour.'); return; }

  const sortie = {
    ville: 'Agadir', exemple: false, genere_le: new Date().toISOString(), fuseau: FUSEAU,
    heure_bascule: '00:00', aujourdhui: jour,
    sources: [SOURCES.tc, SOURCES.ag, SOURCES.lm], jours,
  };
  await mkdir(new URL('../public/', import.meta.url), { recursive: true });
  await writeFile(SORTIE, JSON.stringify(sortie, null, 2) + '\n');
  console.log(`public/garde.json : ${pharmacies.length} pharmacies pour le ${jour}`);
  pharmacies.forEach((p) => console.log(` - ${p.nom} | ${p.quartier} | ${p.telephone}`));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
