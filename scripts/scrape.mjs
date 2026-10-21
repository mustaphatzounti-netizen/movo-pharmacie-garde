// Récupère la garde du jour à Agadir sur deux sources, les recoupe et met à jour public/garde.json.
// Règle de sécurité : si une source n'affiche pas la date du jour, ou si les deux listes ne
// contiennent pas exactement les mêmes pharmacies, rien n'est écrit et le script échoue.
//
// Une troisième source (lematin.ma) sert de vérification supplémentaire, non bloquante : si elle
// n'est pas d'accord, un avertissement est affiché dans les logs mais la publication continue.
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

// Vérification secondaire, non bloquante : lematin.ma ne donne ni téléphone ni quartier, et sa
// date affichée est celle du site (bandeau du haut), pas forcément celle de la liste de garde —
// on ne l'utilise donc que pour un recoupement des noms, jamais pour faire échouer le script.
export function parseLematin(html) {
  const $ = cheerio.load(html);
  const date = dateFr(($('body').text().match(/[a-zéû]+\s+\d{1,2}\s+[a-zéû]+\s+\d{4}/i) || [])[0] || '');
  const pharmacies = $('.ph-record').map((_, el) => ({
    nom: propre($(el).find('.ph-name').first().text()),
  })).get().filter((p) => p.nom);
  return { date, pharmacies };
}

const titreAdresse = (s) => s.replace(/(^|[\s,(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());

export function fusionner(principal, ag, jour) {
  const erreurs = [];
  if (principal.date !== jour) erreurs.push(`telecontact.ma affiche la date ${principal.date}, pas ${jour}`);
  if (ag.date !== jour) erreurs.push(`annuaire-gratuit affiche la date ${ag.date}, pas ${jour}`);
  if (!principal.pharmacies.length) erreurs.push('telecontact.ma : aucune pharmacie lue');
  if (!ag.pharmacies.length) erreurs.push('annuaire-gratuit : aucune pharmacie lue');
  const parAg = new Map(ag.pharmacies.map((p) => [cle(p.nom), p]));
  const clesPrincipal = new Set(principal.pharmacies.map((p) => cle(p.nom)));
  const absentesAg = principal.pharmacies.filter((p) => !parAg.has(cle(p.nom))).map((p) => p.nom);
  const absentesPrincipal = ag.pharmacies.filter((p) => !clesPrincipal.has(cle(p.nom))).map((p) => p.nom);
  if (absentesAg.length) erreurs.push('absentes d\'annuaire-gratuit : ' + absentesAg.join(', '));
  if (absentesPrincipal.length) erreurs.push('absentes de telecontact.ma : ' + absentesPrincipal.join(', '));
  if (erreurs.length) return { erreurs };

  const pharmacies = principal.pharmacies.map((p) => {
    const a = parAg.get(cle(p.nom));
    const adresse = (p.adresse.length >= a.adresse.length ? p.adresse : titreAdresse(a.adresse));
    const vingtQuatre = /24\s*h|jour et nuit/i.test(p.type + ' ' + a.garde);
    return {
      id: cle(p.nom),
      nom: p.nom,
      zone: 'Agadir',
      quartier: a.quartier,
      adresse,
      telephone: p.telephone,
      garde: vingtQuatre ? '24h/24' : (/nuit/i.test(p.type + a.garde) ? 'Nuit' : 'Jour'),
      lat: p.lat ?? null,
      lng: p.lng ?? null,
    };
  }).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
  return { erreurs, pharmacies };
}

// Recoupement non bloquant avec lematin.ma : ne renvoie que des avertissements, jamais d'erreurs.
export function verifierLematin(lm, jour, pharmacies) {
  const avertissements = [];
  if (lm.date && lm.date !== jour) {
    avertissements.push(`lematin.ma affiche la date ${lm.date}, pas ${jour} (vérification secondaire ignorée)`);
    return avertissements;
  }
  if (!lm.pharmacies.length) {
    avertissements.push('lematin.ma : aucune pharmacie lue (vérification secondaire ignorée)');
    return avertissements;
  }
  const clesLm = new Set(lm.pharmacies.map((p) => cle(p.nom)));
  const manquantes = pharmacies.filter((p) => !clesLm.has(cle(p.nom))).map((p) => p.nom);
  if (manquantes.length) {
    avertissements.push('absentes de lematin.ma (vérification secondaire, non bloquant) : ' + manquantes.join(', '));
  }
  return avertissements;
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
  const { erreurs, pharmacies } = fusionner(tc, ag, jour);
  if (erreurs.length) {
    erreurs.forEach((e) => console.log('::warning::' + e));
    console.log('Rien publié : la page garde la liste précédente et affichera un avertissement.');
    process.exit(3);
  }

  // Vérification secondaire non bloquante (lematin.ma) : une panne ou un désaccord ici ne doit
  // jamais empêcher la publication déjà validée par les deux sources principales.
  try {
    const lm = await telecharger(SOURCES.lm).then(parseLematin);
    console.log(`lematin.ma : ${lm.date}, ${lm.pharmacies.length} pharmacies (vérification secondaire)`);
    verifierLematin(lm, jour, pharmacies).forEach((w) => console.log('::warning::' + w));
  } catch (e) {
    console.log('::warning::lematin.ma injoignable (vérification secondaire ignorée) : ' + e.message);
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
