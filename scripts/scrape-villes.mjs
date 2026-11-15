// Garde du jour à Inezgane et Aït Melloul, sur deux sources recoupées :
// telecontact.ma (nom, adresse, téléphone, type de garde, GPS) et annuaire-gratuit.ma.
//
// Même règle de sécurité que pour Agadir (scripts/scrape.mjs) : les deux sources doivent afficher
// la date du jour, et une pharmacie n'est publiée que si les DEUX la citent. Aucune pharmacie n'est
// jamais inventée. Si une ville échoue, son fichier n'est pas modifié (la page garde la liste
// précédente et affiche l'avertissement « liste d'hier »). Ce script ne touche pas à garde.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseTelecontact, parseAg, fusionnerPlusieurs, aujourdhui } from './scrape.mjs';

const FUSEAU = 'Africa/Casablanca';

export const VILLES = [
  {
    id: 'inezgane',
    ville: 'Inezgane',
    tc: 'https://www.telecontact.ma/pharmacie-de-garde-zone/inezgane/autre.html',
    ag: 'https://www.annuaire-gratuit.ma/pharmacie-garde-inezgane.html',
  },
  {
    id: 'ait-melloul',
    ville: 'Aït Melloul',
    tc: 'https://www.telecontact.ma/pharmacie-de-garde-zone/ait-melloul/autre.html',
    ag: 'https://www.annuaire-gratuit.ma/pharmacie-garde-ait-melloul.html',
  },
];

async function telecharger(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; movo-pharmacie-garde; +https://www.agadir-livraison.com/)', 'accept-language': 'fr' } });
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  return r.text();
}

// Construit le contenu du fichier JSON d'une ville (même format que public/garde.json).
export function construireSortie(v, jour, pharmacies, ancien, maintenant = new Date()) {
  const jours = (ancien.jours || []).filter((j) => j.date < jour).slice(-2);
  jours.push({ date: jour, pharmacies: pharmacies.map((p) => ({ ...p, zone: v.ville })) });
  return {
    ville: v.ville, exemple: false, genere_le: maintenant.toISOString(), fuseau: FUSEAU,
    heure_bascule: '00:00', aujourdhui: jour,
    sources: [v.tc, v.ag], jours,
  };
}

async function traiterVille(v, jour) {
  const [tc, ag] = await Promise.all([telecharger(v.tc).then(parseTelecontact), telecharger(v.ag).then(parseAg)]);
  console.log(`[${v.id}] telecontact.ma : ${tc.date}, ${tc.pharmacies.length} pharmacies`);
  console.log(`[${v.id}] annuaire-gratuit : ${ag.date}, ${ag.pharmacies.length} pharmacies`);

  const { erreurs, avertissements, pharmacies } = fusionnerPlusieurs(
    [{ nom: 'telecontact.ma', data: tc }, { nom: 'annuaire-gratuit', data: ag }], jour);
  (avertissements || []).forEach((w) => console.log(`::warning::[${v.id}] ${w}`));
  if (erreurs.length) {
    erreurs.forEach((e) => console.log(`::warning::[${v.id}] ${e}`));
    console.log(`[${v.id}] Rien publié : la page garde la liste précédente.`);
    return false;
  }

  const fichier = new URL(`../public/garde-${v.id}.json`, import.meta.url);
  let ancien = { jours: [] };
  try { ancien = JSON.parse(await readFile(fichier, 'utf8')); } catch {}
  const avant = JSON.stringify((ancien.jours || []).find((j) => j.date === jour)?.pharmacies);
  const sortie = construireSortie(v, jour, pharmacies, ancien);
  if (avant === JSON.stringify(sortie.jours[sortie.jours.length - 1].pharmacies)) {
    console.log(`[${v.id}] Déjà à jour.`);
    return true;
  }
  await mkdir(new URL('../public/', import.meta.url), { recursive: true });
  await writeFile(fichier, JSON.stringify(sortie, null, 2) + '\n');
  console.log(`[${v.id}] public/garde-${v.id}.json : ${pharmacies.length} pharmacies pour le ${jour}`);
  pharmacies.forEach((p) => console.log(` - ${p.nom} | ${p.telephone} | ${p.garde}`));
  return true;
}

async function main() {
  const jour = process.argv.includes('--date') ? process.argv[process.argv.indexOf('--date') + 1] : aujourdhui();
  let echecs = 0;
  for (const v of VILLES) {
    try {
      if (!(await traiterVille(v, jour))) echecs++;
    } catch (e) {
      echecs++;
      console.log(`::warning::[${v.id}] ${e.message}`);
    }
  }
  if (echecs) process.exit(3);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
