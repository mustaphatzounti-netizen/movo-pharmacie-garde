# movo-pharmacie-garde

Pharmacies de garde à Agadir pour la page « Pharmacie de garde Agadir » de agadir-livraison.com.
Tout tourne sur GitHub : aucun ordinateur n'a besoin d'être allumé.

```
scripts/scrape.mjs        lit les deux sources, les recoupe, écrit public/garde.json
scripts/scrape.test.mjs   tests
public/garde.json         généré — ne pas modifier à la main
blogger/widget.html       bloc à coller une seule fois dans la page Blogger (Vue HTML)
.github/workflows/garde-quotidienne.yml   tâche toutes les heures de 00:20 à 13:20 UTC
```

## Fonctionnement

1. La tâche lit https://agadir.pharmacieenpermanence.ma/ (nom, adresse, téléphone, type de garde)
   et https://www.annuaire-gratuit.ma/pharmacie-garde-agadir.html (quartier, adresse).
2. **Règle de sécurité** : les deux sites doivent afficher la date du jour (heure du Maroc) et
   exactement les mêmes pharmacies. Sinon rien n'est publié, le run est marqué en échec et
   GitHub envoie un e-mail. Aucune pharmacie n'est jamais inventée.
3. `public/garde.json` garde les 2 jours précédents + le jour courant. Le widget le lit sur
   raw.githubusercontent.com et choisit le bon jour (bascule à 09:00, heure du Maroc). S'il n'y a
   pas encore de liste pour aujourd'hui, il affiche un avertissement.

Lancer à la main : onglet *Actions* → *Garde quotidienne* → *Run workflow*.

En local : `npm install && npm test && npm run scrape`
