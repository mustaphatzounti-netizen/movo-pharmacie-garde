# movo-pharmacie-garde

Pharmacies de garde à Agadir : un fichier de données maintenu à la main, une tâche GitHub Actions
qui génère chaque jour `public/garde.json`, et un widget à coller dans une page Blogger.

```
data/pharmacies.json      liste des pharmacies (nom, quartier, adresse, téléphone, GPS)
data/planning.json        qui est de garde, par période (du … au …)
scripts/build.mjs         valide les données et écrit public/garde.json
public/garde.json         généré — ne pas modifier à la main
blogger/widget.html       bloc HTML/CSS/JS à coller dans la page Blogger
.github/workflows/garde-quotidienne.yml   tâche quotidienne
```

## ⚠️ Avant la mise en ligne

Les pharmacies fournies sont des **exemples** (`"exemple": true`, noms « Pharmacie Exemple 0X »,
faux numéros). Le widget affiche un bandeau d'avertissement tant que ce drapeau est présent.

1. Remplacer le contenu de `data/pharmacies.json` par les vraies pharmacies d'Agadir, puis passer
   `"exemple"` à `false`.
2. Remplir `data/planning.json` avec le tableau de garde officiel (Conseil régional / syndicat des
   pharmaciens d'Agadir).

## Format des données

`data/pharmacies.json`

```json
{
  "exemple": false,
  "ville": "Agadir",
  "pharmacies": [
    { "id": "talborjt-1", "nom": "Pharmacie …", "zone": "Agadir Centre", "quartier": "Talborjt",
      "adresse": "…", "telephone": "+212528…", "lat": 30.42, "lng": -9.59 }
  ]
}
```

- `id` unique, utilisé dans le planning. `zone` sert à regrouper l'affichage (Agadir, Inezgane, Dcheira…).
- `lat`/`lng` facultatifs : sans eux, le bouton « Itinéraire » cherche le nom + l'adresse sur Google Maps.

`data/planning.json`

```json
{
  "heure_bascule": "09:00",
  "fuseau": "Africa/Casablanca",
  "gardes": [
    { "du": "2026-10-19", "au": "2026-10-25", "pharmacies": ["talborjt-1", "dakhla-2"] }
  ]
}
```

- Une garde du jour J commence à `heure_bascule` le jour J et finit à la même heure le lendemain.
  Entre minuit et 09:00, c'est donc encore la garde de la veille qui s'affiche.
- Les dates `du`/`au` sont incluses. Des périodes qui se chevauchent sont fusionnées (pratique pour
  ajouter une pharmacie de nuit ou un jour férié).

## Tâche quotidienne

`.github/workflows/garde-quotidienne.yml` tourne tous les jours à 08:15 UTC (09:15 au Maroc), à
chaque push sur `main` qui touche `data/` ou `scripts/`, et à la demande (onglet *Actions* →
*Run workflow*). Il lance les tests, régénère `public/garde.json` et le commite.

Le run échoue (et GitHub envoie un e-mail) si les données sont invalides ou si aucune pharmacie
n'est de garde aujourd'hui. Les jours vides dans la semaine à venir produisent un avertissement.

Le JSON contient la veille et les 7 jours suivants : le widget choisit lui-même le bon jour selon
l'heure du Maroc, donc l'affichage reste juste même si la tâche a du retard.

En local :

```bash
npm test
npm run build                       # aujourd'hui
node scripts/build.mjs --date 2026-12-31
```

## Page Blogger

1. Le dépôt doit être **public** (le widget lit
   `https://raw.githubusercontent.com/mustaphatzounti-netizen/movo-pharmacie-garde/main/public/garde.json`).
2. Blogger → *Pages* → nouvelle page (ou page existante) → passer en **Vue HTML**.
3. Coller tout le contenu de `blogger/widget.html`, publier.

Si le dépôt est renommé ou la branche change, modifier `URL_DONNEES` en haut du script du widget.
Il n'y a rien à refaire dans Blogger quand le planning change : la page lit les nouvelles données.

---

### بالدارجة

- عمّر `data/pharmacies.json` بالصيدليات الحقيقية ديال أكادير وبدّل `"exemple"` لـ `false`.
- عمّر `data/planning.json` بجدول الحراسة الرسمي.
- GitHub Actions كيصاوب `public/garde.json` كل نهار مع 9:15 ديال الصباح.
- فـ Blogger: صفحة جديدة ← Vue HTML ← لصق `blogger/widget.html` ← نشر.
