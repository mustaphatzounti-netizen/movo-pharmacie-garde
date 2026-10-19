import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePep, parseAg, fusionner, dateFr, aujourdhui } from './scrape.mjs';

const PEP = `<html><body><p>Mise à jour enregistrée le 19 octobre 2026</p><ul>
<li><article><span>Garde Jour et Nuit</span><h3><a href="#">Pharmacie Boussaïd</a></h3><span class="line-clamp-2">Hay Farha, Bloc 14</span><a href="tel:+212528238636">0528 23 86 36</a></article></li>
<li><article><span>Garde Jour et Nuit</span><h3><a href="#">Pharmacie Al Andaloussia</a></h3><a href="tel:0528292999">0528 29 29 99</a></article></li>
</ul></body></html>`;
const AG = `<html><head><title>x</title></head><body><h1>Pharmacie de garde Agadir - Aujourd'hui Lundi 19 Octobre 2026, Propulsé</h1><ul>
<li class="ag_pharmacy_card"><h3 itemprop="name">Pharmacie Al Andaloussia</h3><span itemprop="streetAddress">résidence nasr-3 (bicha)</span>
<div class="ag_pharmacy_info_item">Quartier <b>Cité Salam</b></div><div class="ag_pharmacy_info_item">Garde 24h/24</div></li>
<li class="ag_pharmacy_card"><h3 itemprop="name">Pharmacie Boussaid</h3><span itemprop="streetAddress">hay farha</span>
<div class="ag_pharmacy_info_item">Quartier Hay Farha</div></li>
</ul></body></html>`;

test('dates en français', () => {
  assert.equal(dateFr('19 octobre 2026'), '2026-10-19');
  assert.equal(dateFr('1er Août 2026'), '2026-08-01');
  assert.equal(aujourdhui(new Date('2026-10-19T23:30:00Z')), '2026-10-20');
});

test('lecture et fusion', () => {
  const pep = parsePep(PEP), ag = parseAg(AG);
  assert.equal(pep.date, '2026-10-19');
  assert.equal(ag.date, '2026-10-19');
  const r = fusionner(pep, ag, '2026-10-19');
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.pharmacies.length, 2);
  const andal = r.pharmacies.find((p) => p.nom === 'Pharmacie Al Andaloussia');
  assert.equal(andal.telephone, '+212528292999');
  assert.equal(andal.quartier, 'Cité Salam');
  assert.equal(andal.adresse, 'Résidence Nasr-3 (Bicha)');
  assert.equal(r.pharmacies.find((p) => p.nom === 'Pharmacie Boussaïd').adresse, 'Hay Farha, Bloc 14');
});

test('refuse une date périmée ou des listes différentes', () => {
  const pep = parsePep(PEP), ag = parseAg(AG);
  assert.ok(fusionner(pep, ag, '2026-10-20').erreurs.length >= 2);
  ag.pharmacies.pop();
  assert.match(fusionner(pep, ag, '2026-10-19').erreurs.join(), /Boussa/);
});
