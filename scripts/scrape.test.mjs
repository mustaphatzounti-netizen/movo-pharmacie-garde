import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTelecontact, parseAg, parseLematin, fusionnerPlusieurs, dateFr, aujourdhui } from './scrape.mjs';

const TC = `<html><body><p>Gardes du mercredi 19 octobre 2026</p>
<article class="pharma-carte">
  <div class="pharma-carte-tete"><h3><a href="#">Pharmacie Boussaïd</a></h3>
  <span class="pharma-badges"><span class="pharma-badge h24">24h/24</span></span></div>
  <p class="pharma-adresse">Hay Farha, Bloc 14</p>
  <div class="pharma-actions"><a class="pharma-appeler" href="tel:+212528238636">05 28 23 86 36</a>
  <details class="pharma-itineraire"><summary>Itinéraire</summary>
  <div class="pharma-itineraire-menu"><a href="https://www.google.com/maps/dir/?api=1&destination=30.41,-9.59">Google Maps</a></div>
  </details></div>
</article>
<article class="pharma-carte">
  <div class="pharma-carte-tete"><h3><a href="#">Pharmacie Al Andaloussia</a></h3>
  <span class="pharma-badges"><span class="pharma-badge h24">24h/24</span></span></div>
  <div class="pharma-actions"><a class="pharma-appeler" href="tel:0528292999">0528 29 29 99</a></div>
</article>
<article class="pharma-carte">
  <div class="pharma-carte-tete"><h3><a href="#">Pharmacie Extra Nuit</a></h3>
  <span class="pharma-badges"><span class="pharma-badge">Nuit</span></span></div>
  <div class="pharma-actions"><a class="pharma-appeler" href="tel:0528111222">0528 11 12 22</a></div>
</article>
</body></html>`;

const AG = `<html><head><title>x</title></head><body><h1>Pharmacie de garde Agadir - Aujourd'hui Lundi 19 Octobre 2026, Propulsé</h1><ul>
<li class="ag_pharmacy_card"><h3 itemprop="name">Pharmacie Al Andaloussia</h3><span itemprop="streetAddress">résidence nasr-3 (bicha)</span>
<div class="ag_pharmacy_info_item">Quartier <b>Cité Salam</b></div><div class="ag_pharmacy_info_item">Garde 24h/24</div></li>
<li class="ag_pharmacy_card"><h3 itemprop="name">Pharmacie Boussaid</h3><span itemprop="streetAddress">hay farha</span>
<div class="ag_pharmacy_info_item">Quartier Hay Farha</div></li>
<li class="ag_pharmacy_card"><h3 itemprop="name">Pharmacie Ag Seule</h3><span itemprop="streetAddress">quartier inconnu</span>
<div class="ag_pharmacy_info_item">Quartier Talborjt</div></li>
</ul></body></html>`;

const LM = `<html><body><p>Mercredi 19 Octobre 2026</p>
<div class="ph-record"><div class="ph-name"><a href="#"><span>Pharmacie</span> Boussaïd</a></div></div>
<div class="ph-record"><div class="ph-name"><a href="#"><span>Pharmacie</span> Al Andaloussia</a></div></div>
<div class="ph-record"><div class="ph-name"><a href="#"><span>Pharmacie</span> Extra Nuit</a></div></div>
</body></html>`;

test('dates en français', () => {
  assert.equal(dateFr('19 octobre 2026'), '2026-10-19');
  assert.equal(dateFr('1er Août 2026'), '2026-08-01');
  assert.match(aujourdhui(), /^\d{4}-\d{2}-\d{2}$/);
});

test('lecture des trois sources', () => {
  const tc = parseTelecontact(TC), ag = parseAg(AG), lm = parseLematin(LM);
  assert.equal(tc.date, '2026-10-19');
  assert.equal(ag.date, '2026-10-19');
  assert.equal(lm.date, '2026-10-19');
  assert.equal(tc.pharmacies.length, 3);
  assert.equal(ag.pharmacies.length, 3);
  assert.equal(lm.pharmacies.length, 3);
});

test('vote majoritaire à 3 sources : une pharmacie confirmée par 2/3 est publiée, 1/3 est écartée', () => {
  const tc = parseTelecontact(TC), ag = parseAg(AG), lm = parseLematin(LM);
  const sources = [{ nom: 'telecontact.ma', data: tc }, { nom: 'annuaire-gratuit', data: ag }, { nom: 'lematin.ma', data: lm }];
  const r = fusionnerPlusieurs(sources, '2026-10-19');
  assert.equal(r.erreurs.length, 0);
  const noms = r.pharmacies.map((p) => p.nom).sort();
  // Boussaïd et Al Andaloussia : 3/3. Extra Nuit (tc+lm) : 2/3 -> publiée. Ag Seule (ag seul) : 1/3 -> écartée.
  assert.deepEqual(noms, ['Pharmacie Al Andaloussia', 'Pharmacie Boussaïd', 'Pharmacie Extra Nuit']);
  assert.match(r.avertissements.join(), /Ag Seule.*1\/3/);

  const andal = r.pharmacies.find((p) => p.nom === 'Pharmacie Al Andaloussia');
  assert.equal(andal.telephone, '+212528292999');
  assert.equal(andal.quartier, 'Cité Salam');
  assert.equal(andal.adresse, 'Résidence Nasr-3 (Bicha)');
  const extra = r.pharmacies.find((p) => p.nom === 'Pharmacie Extra Nuit');
  assert.equal(extra.garde, 'Nuit');
  assert.equal(extra.telephone, '+212528111222');
  assert.equal(extra.quartier, '');
});

test('seulement 2 sources disponibles : les deux doivent être d\'accord', () => {
  const tc = parseTelecontact(TC), ag = parseAg(AG);
  const sources = [{ nom: 'telecontact.ma', data: tc }, { nom: 'annuaire-gratuit', data: ag }];
  const r = fusionnerPlusieurs(sources, '2026-10-19');
  assert.equal(r.erreurs.length, 0);
  const noms = r.pharmacies.map((p) => p.nom).sort();
  // Avec 2 sources seulement, le seuil est 2 : seules Boussaïd et Al Andaloussia (présentes dans les 2) passent.
  assert.deepEqual(noms, ['Pharmacie Al Andaloussia', 'Pharmacie Boussaïd']);
});

test('refuse si moins de 2 sources confirment la date du jour', () => {
  const tc = parseTelecontact(TC), ag = parseAg(AG), lm = parseLematin(LM);
  const sources = [{ nom: 'telecontact.ma', data: tc }, { nom: 'annuaire-gratuit', data: ag }, { nom: 'lematin.ma', data: lm }];
  const r = fusionnerPlusieurs(sources, '2026-10-20');
  assert.ok(r.erreurs.length >= 1);
  assert.equal(r.pharmacies, undefined);
});

test('refuse si aucune pharmacie n\'est confirmée par au moins 2 sources', () => {
  const sources = [
    { nom: 'telecontact.ma', data: { date: '2026-10-19', pharmacies: [{ nom: 'Pharmacie Seule A' }] } },
    { nom: 'annuaire-gratuit', data: { date: '2026-10-19', pharmacies: [{ nom: 'Pharmacie Seule B', adresse: '', quartier: '', garde: '' }] } },
  ];
  const r = fusionnerPlusieurs(sources, '2026-10-19');
  assert.ok(r.erreurs.length >= 1);
  assert.equal(r.pharmacies, undefined);
});
