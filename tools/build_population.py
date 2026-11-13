"""Grille ~5 km de la France métropolitaine : population (INSEE) et surface.

Chaque cellule dont le centre est à terre est gardée, même sans habitant, pour
que l'application puisse estimer la surface des secteurs (nombre de cellules
× surface d'une cellule) sans découper de géométrie. Les habitants d'une
commune sont comptés dans la cellule de son centre.

Usage :
  curl -o communes.json "https://geo.api.gouv.fr/communes?fields=code,nom,centre,population&format=json"
  python3 tools/build_population.py communes.json data/france.geojson data/population.json
"""
import json
import sys
from pathlib import Path

import numpy as np

PAS_LAT = 0.045  # ~5 km
PAS_LON = 0.065  # ~5 km à 46.5°N


def anneaux(france):
    geom = france["geometry"] if france.get("type") == "Feature" else france
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return [np.array(r) for p in polys for r in p]


def a_terre(lon, lat, rings):
    """Pair-impair sur tous les anneaux (trous compris), vectorisé sur les points."""
    dedans = np.zeros(lon.shape, dtype=bool)
    for r in rings:
        x1, y1 = r[:-1, 0], r[:-1, 1]
        x2, y2 = r[1:, 0], r[1:, 1]
        for a, b, c, d in zip(x1, y1, x2, y2):
            croise = ((b > lat) != (d > lat)) & (lon < (c - a) * (lat - b) / (d - b + 1e-15) + a)
            dedans ^= croise
    return dedans


def main(src, contour, dst):
    with open(src, encoding="utf-8") as f:
        communes = json.load(f)
    with open(contour, encoding="utf-8") as f:
        rings = anneaux(json.load(f))

    cellules = {}  # (ix, iy) -> habitants
    for c in communes:
        if c["code"].startswith("97") or not c.get("centre") or not c.get("population"):
            continue
        lon, lat = c["centre"]["coordinates"]
        cle = (round(lon / PAS_LON), round(lat / PAS_LAT))
        cellules[cle] = cellules.get(cle, 0) + c["population"]

    ix = np.arange(round(-5.3 / PAS_LON), round(9.7 / PAS_LON) + 1)
    iy = np.arange(round(41.2 / PAS_LAT), round(51.2 / PAS_LAT) + 1)
    gx, gy = np.meshgrid(ix, iy)
    terre = a_terre(gx * PAS_LON, gy * PAS_LAT, rings)
    for i, j in zip(gx[terre], gy[terre]):
        cellules.setdefault((int(i), int(j)), 0)

    # Triplets à plat [ix, iy, habitants, …], centre de cellule = (ix × PAS_LON, iy × PAS_LAT).
    plat = [v for (i, j), p in sorted(cellules.items()) for v in (i, j, p)]
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"pasLon": PAS_LON, "pasLat": PAS_LAT, "cellules": plat}, f, separators=(",", ":"))
    print(f"{len(cellules)} cellules, {sum(cellules.values()):,} habitants")


if __name__ == "__main__":
    main(*sys.argv[1:4])
