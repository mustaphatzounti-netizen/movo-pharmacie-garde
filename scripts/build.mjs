// Génère public/garde.json à partir de data/pharmacies.json et data/planning.json.
// Usage : node scripts/build.mjs [--date YYYY-MM-DD] [--jours 7]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Date locale (YYYY-MM-DD) et heure (HH:MM) d'un instant dans un fuseau donné.
export function localParts(instant, fuseau) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, heure: `${parts.hour}:${parts.minute}` };
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Une garde commence à l'heure de bascule : avant cette heure, on est encore sur la garde de la veille.
export function dateDeGarde(instant, fuseau, heureBascule) {
  const { date, heure } = localParts(instant, fuseau);
  return heure < heureBascule ? addDays(date, -1) : date;
}

export function validate(pharmaciesData, planning) {
  const errors = [];
  const ids = new Set();
  for (const [i, p] of (pharmaciesData.pharmacies ?? []).entries()) {
    if (!p.id) errors.push(`pharmacies[${i}] : "id" manquant`);
    else if (ids.has(p.id)) errors.push(`pharmacies[${i}] : id "${p.id}" en double`);
    else ids.add(p.id);
    if (!p.nom) errors.push(`pharmacies[${i}] (${p.id}) : "nom" manquant`);
    if (p.telephone && !/^\+?[0-9 ]{9,15}$/.test(p.telephone)) {
      errors.push(`pharmacies[${i}] (${p.id}) : téléphone invalide "${p.telephone}"`);
    }
  }
  if (!HEURE_RE.test(planning.heure_bascule ?? '')) errors.push('planning : "heure_bascule" doit être au format HH:MM');
  if (!planning.fuseau) errors.push('planning : "fuseau" manquant');
  for (const [i, g] of (planning.gardes ?? []).entries()) {
    if (!DATE_RE.test(g.du ?? '') || !DATE_RE.test(g.au ?? '')) {
      errors.push(`gardes[${i}] : "du" et "au" doivent être au format YYYY-MM-DD`);
    } else if (g.du > g.au) {
      errors.push(`gardes[${i}] : "du" (${g.du}) est après "au" (${g.au})`);
    }
    if (!Array.isArray(g.pharmacies) || g.pharmacies.length === 0) {
      errors.push(`gardes[${i}] : liste "pharmacies" vide`);
    } else {
      for (const id of g.pharmacies) if (!ids.has(id)) errors.push(`gardes[${i}] : pharmacie inconnue "${id}"`);
    }
  }
  return errors;
}

export function pharmaciesDuJour(date, pharmaciesData, planning) {
  const byId = new Map(pharmaciesData.pharmacies.map((p) => [p.id, p]));
  const ids = new Set();
  for (const g of planning.gardes) if (g.du <= date && date <= g.au) g.pharmacies.forEach((id) => ids.add(id));
  return [...ids].map((id) => byId.get(id));
}

export function build(pharmaciesData, planning, { maintenant = new Date(), jours = 7 } = {}) {
  const aujourdhui = dateDeGarde(maintenant, planning.fuseau, planning.heure_bascule);
  const liste = [];
  for (let i = -1; i < jours; i++) {
    const date = addDays(aujourdhui, i);
    liste.push({ date, pharmacies: pharmaciesDuJour(date, pharmaciesData, planning) });
  }
  return {
    ville: pharmaciesData.ville,
    exemple: Boolean(pharmaciesData.exemple),
    genere_le: maintenant.toISOString(),
    fuseau: planning.fuseau,
    heure_bascule: planning.heure_bascule,
    aujourdhui,
    jours: liste,
  };
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const pharmaciesData = JSON.parse(readFileSync(join(ROOT, 'data/pharmacies.json'), 'utf8'));
  const planning = JSON.parse(readFileSync(join(ROOT, 'data/planning.json'), 'utf8'));

  const errors = validate(pharmaciesData, planning);
  if (errors.length) {
    for (const e of errors) console.error(`::error::${e}`);
    process.exit(1);
  }

  const date = arg('--date');
  // Midi heure locale du jour demandé, pour tomber après l'heure de bascule.
  const maintenant = date ? new Date(`${date}T12:00:00Z`) : new Date();
  const out = build(pharmaciesData, planning, { maintenant, jours: Number(arg('--jours') ?? 7) });

  const dest = join(ROOT, 'public/garde.json');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`public/garde.json écrit — garde du ${out.aujourdhui}`);

  if (out.exemple) console.log('::warning::data/pharmacies.json contient des données d\'exemple ("exemple": true).');
  let ko = false;
  for (const j of out.jours.slice(1)) {
    if (j.pharmacies.length) continue;
    if (j.date === out.aujourdhui) { console.error(`::error::Aucune pharmacie de garde pour aujourd'hui (${j.date}).`); ko = true; }
    else console.log(`::warning::Planning vide pour le ${j.date} — pensez à compléter data/planning.json.`);
  }
  if (ko) process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
