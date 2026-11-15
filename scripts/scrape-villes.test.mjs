import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionnerPlusieurs } from './scrape.mjs';
import { VILLES, construireSortie } from './scrape-villes.mjs';

const tc = (noms, date = '2026-11-15') => ({
  date,
  pharmacies: noms.map((nom) => ({ nom, adresse: 'Adresse ' + nom, telephone: '+212528000000', type: 'Jour', lat: 30.3, lng: -9.5 })),
});
const ag = (noms, date = '2026-11-15') => ({
  date,
  pharmacies: noms.map((nom) => ({ nom, adresse: '', quartier: '', garde: '' })),
});

test('Aït Melloul : seules les pharmacies citées par les deux sources sont publiées', () => {
  const r = fusionnerPlusieurs([
    { nom: 'telecontact.ma', data: tc(['Pharmacie alhouda', 'Pharmacie Ifoulki', 'Pharmacie Essaada', 'Pharmacie Chouhada', 'Pharmacie kanissi', "Pharmacie Assaïs d'Aït Melloul"]) },
    { nom: 'annuaire-gratuit', data: ag(['Pharmacie Admine', 'Pharmacie Ifoulki', 'Pharmacie Chouhada', 'Pharmacie Essaada', 'Pharmacie Kanissi']) },
  ], '2026-11-15');
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.pharmacies.map((p) => p.id).sort(), ['chouhada', 'essaada', 'ifoulki', 'kanissi']);
});

test('une source avec une autre date bloque la publication', () => {
  const r = fusionnerPlusieurs([
    { nom: 'telecontact.ma', data: tc(['Pharmacie Annour'], '2026-11-14') },
    { nom: 'annuaire-gratuit', data: ag(['Pharmacie Annour']) },
  ], '2026-11-15');
  assert.ok(r.erreurs.length > 0);
  assert.equal(r.pharmacies, undefined);
});

test('le fichier de la ville garde 2 jours précédents et met la ville comme zone', () => {
  const v = VILLES.find((x) => x.id === 'inezgane');
  const ancien = { jours: [{ date: '2026-11-12', pharmacies: [] }, { date: '2026-11-13', pharmacies: [] }, { date: '2026-11-14', pharmacies: [] }] };
  const s = construireSortie(v, '2026-11-15', [{ id: 'annour', nom: 'Pharmacie Annour', zone: 'Agadir' }], ancien, new Date('2026-11-15T06:00:00Z'));
  assert.equal(s.ville, 'Inezgane');
  assert.deepEqual(s.jours.map((j) => j.date), ['2026-11-13', '2026-11-14', '2026-11-15']);
  assert.equal(s.jours[2].pharmacies[0].zone, 'Inezgane');
  assert.equal(s.heure_bascule, '00:00');
});

test('même pharmacie reconnue malgré les lettres cyrilliques et le « de »', async () => {
  const { cle } = await import('./scrape.mjs');
  assert.equal(cle('Pharmacie AL OUMАНАТЕ'), cle('Pharmacie Al Oumahate'));
  assert.equal(cle('Pharmacie Talborjt'), cle('Pharmacie de Talborjt'));
  assert.equal(cle('Pharmacie Des Hopitaux'), cle('Pharmacie des Hopitaux'));
  assert.notEqual(cle('Pharmacie Anza'), cle('Pharmacie Arrahma'));
});
