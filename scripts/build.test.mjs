import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dateDeGarde, validate, build } from './build.mjs';

const pharmacies = {
  ville: 'Agadir',
  pharmacies: [
    { id: 'a', nom: 'A', telephone: '+212528000001' },
    { id: 'b', nom: 'B' },
  ],
};
const planning = {
  heure_bascule: '09:00',
  fuseau: 'Africa/Casablanca',
  gardes: [
    { du: '2026-10-19', au: '2026-10-25', pharmacies: ['a'] },
    { du: '2026-10-25', au: '2026-10-31', pharmacies: ['b'] },
  ],
};

test('addDays traverse les mois', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('avant l\'heure de bascule, on reste sur la garde de la veille', () => {
  // Maroc = UTC+1 hors Ramadan : 07:30Z = 08:30 locale.
  assert.equal(dateDeGarde(new Date('2026-10-20T07:30:00Z'), 'Africa/Casablanca', '09:00'), '2026-10-19');
  assert.equal(dateDeGarde(new Date('2026-10-20T08:30:00Z'), 'Africa/Casablanca', '09:00'), '2026-10-20');
});

test('validate détecte les erreurs', () => {
  assert.deepEqual(validate(pharmacies, planning), []);
  const errs = validate(
    { pharmacies: [{ id: 'a', nom: 'A' }, { id: 'a', nom: 'A2', telephone: 'abc' }] },
    { heure_bascule: '9h', fuseau: 'Africa/Casablanca', gardes: [{ du: '2026-10-10', au: '2026-10-01', pharmacies: ['z'] }] },
  );
  assert.equal(errs.length, 5);
});

test('build fusionne les périodes qui se chevauchent et couvre la veille', () => {
  const out = build(pharmacies, planning, { maintenant: new Date('2026-10-25T12:00:00Z'), jours: 2 });
  assert.equal(out.aujourdhui, '2026-10-25');
  assert.deepEqual(out.jours.map((j) => j.date), ['2026-10-24', '2026-10-25', '2026-10-26']);
  assert.deepEqual(out.jours[1].pharmacies.map((p) => p.id), ['a', 'b']);
  assert.deepEqual(out.jours[2].pharmacies.map((p) => p.id), ['b']);
});
