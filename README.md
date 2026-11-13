# Team Sport Map

Carte de France découpée en secteurs selon le **stade (ou la salle) de club professionnel le plus proche** :

- **Rugby** : Top 14, Pro D2
- **Football** : Ligue 1, Ligue 2
- **Basket** : Betclic Élite (ex-Pro A, Jeep Élite), Élite 2 (ex-Pro B)
- **Handball** : Starligue, Proligue

Fonctionnalités :

- un sport à la fois par carte (divisions combinables) ;
- **deux cartes côte à côte** (cadrage synchronisé) pour comparer sports ou saisons ;
- clic sur la carte → popup avec le club le plus proche **dans chaque division** (logo, distance) ;
- **secteurs** : population et superficie de chaque secteur, zones « désertes » (à plus de X km d'un club) en hachures ;
- export PNG de la carte (ou des deux cartes) ;
- fiche club : stade, capacité, frise des divisions par saison, logo ;
- état dans l'URL : `?a=2025-26~rugby.top14.prod2~football.ligue1&b=2016-17~rugby.top14`.

## Stack

Site statique, sans build : HTML/CSS/JS (modules ES), [Leaflet](https://leafletjs.com),
[d3-delaunay](https://github.com/d3/d3-delaunay) (Voronoï) et [Turf](https://turfjs.org) (découpage), chargés depuis un CDN.

## Développement

```sh
python3 -m http.server 8000
# http://localhost:8000
```

## Déploiement

Le workflow [`pages.yml`](.github/workflows/pages.yml) publie le site tel quel sur GitHub Pages à chaque push sur `main` (il n'utilise que des chemins relatifs). Activer au préalable *Settings → Pages → Source : GitHub Actions*.

## Données

| Fichier | Contenu |
|---|---|
| `data/sports.json` | sports, icône, divisions (et leurs renommages par saison) |
| `data/<sport>/clubs.json` | clubs : nom, couleur, lien Wikipédia, logo, stades (`depuis` = 1ʳᵉ saison dans ce stade, lat/lon, capacité) |
| `data/<sport>/saisons.json` | composition des divisions par saison (ids de clubs) |
| `data/france.geojson` | contour métropole + Corse simplifié ([france-geojson](https://github.com/gregoiredavid/france-geojson)) |
| `data/population.json` | grille ~5 km des cellules à terre, triplets `[ix, iy, habitants]` (`tools/build_population.py`) |
| `data/logos/<sport>/<id>.webp` | logos 64 px, téléchargés depuis le champ `logo` (`tools/telecharger_logos.py`) |

Compositions et coordonnées des stades relevées sur Wikipédia ; signalez ou corrigez toute erreur
directement dans les JSON, puis vérifiez avec :

```sh
node tools/verifier.mjs
```

Les logos proviennent de Wikimedia Commons / Wikipédia (URL source dans le champ `logo`) ; ce sont des
marques de leurs titulaires. Après ajout ou modification de clubs : `python3 tools/telecharger_logos.py`.
À défaut de logo, une pastille aux initiales est affichée.

Ajouter un sport : une entrée dans `sports.json` et un dossier `data/<sport>/`.

Les secteurs sont des cellules de Voronoï calculées en projection équirectangulaire locale
(écart négligeable avec la distance géodésique à l'échelle de la France), découpées à l'affichage par
un `clipPath` SVG du contour de la France. Population et surfaces sont sommées sur la grille ~5 km
(surface totale 551 654 km²). Les distances affichées sont à vol d'oiseau (haversine).

## Licence

MIT (voir `LICENSE`).
