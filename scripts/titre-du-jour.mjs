// Titre de page daté, ex. « Pharmacie de garde Agadir aujourd'hui (mardi 24 novembre) | MOVO ».
// La date n'apparaît que si la liste affichée est bien celle du jour.
// Sinon (liste de la veille en secours, ou pas de liste) : le titre fixe habituel.
export function titreDuJour(jour, fabrique, titreFixe) {
  if (!jour || !jour.pharmacies || !jour.pharmacies.length || jour.veille) return titreFixe;
  return fabrique(jour.date);
}
