import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTelecontact, parseAg, parseLematin, fusionner, verifierLematin, dateFr, aujourdhui } from './scrape.mjs';

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
</body></html>`;

const AG = `<html><head><title>x</title></head><body><h1>Pharmacie de garde Agadir - Aujourd'hui Lundi 19 Octobre 2026, Propulsé</h1><ul>
<li class="ag_pharmacy_card"><h3 itemprop="name">Pharmacie Al Andaloussia</h3><span itemprop="streetAddress">résidence nasr-3 (bicha)</span>
<div class="ag_pharmacy_info_item">Quartier <b>Cité Salam</b></div><div class="ag_pharmacy_info_item">Garde 24h/24</div></li>
<li class="ag_pharmacy_card"><h3 itemprop="name">Pharmacie Boussaid</h3><span itemprop="streetAddress">hay farha</span>
<div class="ag_pharmacy_info_item">Quartier Hay Farha</div></li>
</ul></body></html>`;

const LM = `<html><body><p>Mercredi 19 Octobre 2026</p>
<div class="ph-record"><div class="ph-name"><a href="#"><span>Pharmacie</span> Boussaïd</a></div></div>
<div class="ph-record"><div class="ph-name"><a href="#"><span>Pharmacie</span> Al Andaloussia</a></div></div>
</body></html>`;

test('dates en français', () => {
  assert.equal(dateFr('19 octobre 2026'), '2026-10-19');
  assert.equal(dateFr('1er Août 2026'), '2026-08-01');
  assert.match(aujourdhui(), /^\d{4}-\d{2}-\d{2}$/);
});

test('lecture et fusion', () => {
  const tc = parseTelecontact(TC), ag = parseAg(AG);
  assert.equal(tc.date, '2026-10-19');
  assert.equal(ag.date, '2026-10-19');
  const r = fusionner(tc, ag, '2026-10-19');
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.pharmacies.length, 2);
  const andal = r.pharmacies.find((p) => p.nom === 'Pharmacie Al Andaloussia');
  assert.equal(andal.telephone, '+212528292999');
  assert.equal(andal.quartier, 'Cité Salam');
  assert.equal(andal.adresse, 'Résidence Nasr-3 (Bicha)');
  const boussaid = r.pharmacies.find((p) => p.nom === 'Pharmacie Boussaïd');
  assert.equal(boussaid.adresse, 'Hay Farha, Bloc 14');
  assert.equal(boussaid.lat, 30.41);
  assert.equal(boussaid.lng, -9.59);
});

test('refuse une date périmée ou des listes différentes', () => {
  const tc = parseTelecontact(TC), ag = parseAg(AG);
  assert.ok(fusionner(tc, ag, '2026-10-20').erreurs.length >= 2);
  ag.pharmacies.pop();
  assert.match(fusionner(tc, ag, '2026-10-19').erreurs.join(), /Boussa/);
});

test('vérification secondaire lematin.ma, jamais bloquante', () => {
  const tc = parseTelecontact(TC), ag = parseAg(AG);
  const { pharmacies } = fusionner(tc, ag, '2026-10-19');
  const lm = parseLematin(LM);
  assert.equal(lm.date, '2026-10-19');
  assert.deepEqual(verifierLematin(lm, '2026-10-19', pharmacies), []);
  const lmIncomplet = parseLematin(LM.replace('Al Andaloussia', 'Autre Nom'));
  assert.match(verifierLematin(lmIncomplet, '2026-10-19', pharmacies).join(), /Andaloussia/);
  assert.deepEqual(verifierLematin({ date: '2026-10-18', pharmacies: [] }, '2026-10-19', pharmacies).length, 1);
});
