import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titreDuJour } from './titre-du-jour.mjs';

const FIXE = "Pharmacie de garde Agadir aujourd'hui (24h/24) — liste du jour | MOVO";
const fab = (d) => `Pharmacie de garde Agadir aujourd'hui (${d}) | MOVO`;

test('liste du jour : titre daté', () => {
  const jour = { pharmacies: [{ nom: 'Pharmacie A' }], date: '2026-11-24', veille: false };
  assert.equal(titreDuJour(jour, fab, FIXE), "Pharmacie de garde Agadir aujourd'hui (2026-11-24) | MOVO");
});

test('liste de la veille en secours : titre fixe', () => {
  const jour = { pharmacies: [{ nom: 'Pharmacie A' }], date: '2026-11-23', veille: true };
  assert.equal(titreDuJour(jour, fab, FIXE), FIXE);
});

test('pas de liste : titre fixe', () => {
  assert.equal(titreDuJour({ pharmacies: null, date: '2026-11-24', veille: false }, fab, FIXE), FIXE);
  assert.equal(titreDuJour({ pharmacies: [], date: '2026-11-24', veille: false }, fab, FIXE), FIXE);
});
