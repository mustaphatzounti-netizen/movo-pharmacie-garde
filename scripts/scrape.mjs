// Récupère la garde du jour à Agadir sur deux sources, les recoupe et met à jour public/garde.json.
// Règle de sécurité : si une source n'affiche pas la date du jour, ou si les deux listes ne
// contiennent pas exactement les mêmes pharmacies, rien n'est écrit et le script échoue.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';

export const SOURCES = {
  pep: 'https://agadir.pharmacieenpermanence.ma/',
  ag: 'https://www.annuaire-gratuit.ma/pharmacie-garde-agadir.html',
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

export function parsePep(html) {
  const $ = cheerio.load(html);
  const date = dateFr(($('body').text().match(/Mise à jour enregistrée le\s+([^\n<]{6,40})/) || [])[1] || '');
  const pharmacies = $('article').map((_, a) => {
    const $a = $(a);
    const nom = propre($a.find('h3').first().text());
    const tel = $a.find('a[href^="tel:"]').first().attr('href') || ($a.text().match(/0\d{3}(?:\s?\d{2}){3}/) || [])[0];
    return {
      nom,
      adresse: propre($a.find('.line-clamp-2').first().text()),
      telephone: telephone(tel),
      type: propre($a.find('span').first().text()),
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

const titreAdresse = (s) => s.replace(/(^|[\s,(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());

export function fusionner(pep, ag, jour) {
  const erreurs = [];
  if (pep.date !== jour) erreurs.push(`pharmacieenpermanence affiche la date ${pep.date}, pas ${jour}`);
  if (ag.date !== jour) erreurs.push(`annuaire-gratuit affiche la date ${ag.date}, pas ${jour}`);
  if (!pep.pharmacies.length) erreurs.push('pharmacieenpermanence : aucune pharmacie lue');
  if (!ag.pharmacies.length) erreurs.push('annuaire-gratuit : aucune pharmacie lue');
  const parAg = new Map(ag.pharmacies.map((p) => [cle(p.nom), p]));
  const clesPep = new Set(pep.pharmacies.map((p) => cle(p.nom)));
  const absentesAg = pep.pharmacies.filter((p) => !parAg.has(cle(p.nom))).map((p) => p.nom);
  const absentesPep = ag.pharmacies.filter((p) => !clesPep.has(cle(p.nom))).map((p) => p.nom);
  if (absentesAg.length) erreurs.push('absentes d\'annuaire-gratuit : ' + absentesAg.join(', '));
  if (absentesPep.length) erreurs.push('absentes de pharmacieenpermanence : ' + absentesPep.join(', '));
  if (erreurs.length) return { erreurs };

  const pharmacies = pep.pharmacies.map((p) => {
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
      lat: null,
      lng: null,
    };
  }).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
  return { erreurs, pharmacies };
}

async function telecharger(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; movo-pharmacie-garde; +https://www.agadir-livraison.com/)', 'accept-language': 'fr' } });
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  return r.text();
}

async function main() {
  const jour = process.argv.includes('--date') ? process.argv[process.argv.indexOf('--date') + 1] : aujourdhui();
  const [pep, ag] = await Promise.all([telecharger(SOURCES.pep).then(parsePep), telecharger(SOURCES.ag).then(parseAg)]);
  console.log(`pharmacieenpermanence : ${pep.date}, ${pep.pharmacies.length} pharmacies`);
  console.log(`annuaire-gratuit : ${ag.date}, ${ag.pharmacies.length} pharmacies`);
  const { erreurs, pharmacies } = fusionner(pep, ag, jour);
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
  if (avant === JSON.stringify(pharmacies) && !ancien.exemple) { console.log('Déjà à jour.'); return; }

  const sortie = {
    ville: 'Agadir', exemple: false, genere_le: new Date().toISOString(), fuseau: FUSEAU,
    heure_bascule: '09:00', aujourdhui: jour,
    sources: [SOURCES.pep, SOURCES.ag], jours,
  };
  await mkdir(new URL('../public/', import.meta.url), { recursive: true });
  await writeFile(SORTIE, JSON.stringify(sortie, null, 2) + '\n');
  console.log(`public/garde.json : ${pharmacies.length} pharmacies pour le ${jour}`);
  pharmacies.forEach((p) => console.log(` - ${p.nom} | ${p.quartier} | ${p.telephone}`));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
