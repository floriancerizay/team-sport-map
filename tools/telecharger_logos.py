"""Télécharge les logos des ligues (champ `logo` de sports.json) et des clubs (champ `logo` des clubs.json, fichiers
Wikimedia) et les enregistre en WebP 64 px dans data/logos/<sport>/<id>.webp.

Usage : python3 tools/telecharger_logos.py [--force]
Les logos déjà présents sont conservés, sauf avec --force.
"""
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

RACINE = Path(__file__).resolve().parent.parent
TAILLE = 64
ENTETES = {"User-Agent": "TeamSportMap/1.0 (https://github.com/; carte des clubs professionnels)"}


def telecharger(url):
    for essai in range(4):
        try:
            url_encodee = urllib.parse.quote(url, safe=":/%")
            req = urllib.request.Request(f"{url_encodee}?width={TAILLE * 2}", headers=ENTETES)
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or essai == 3:
                raise
            time.sleep(5 * (essai + 1))


def main(force):
    sports = json.loads((RACINE / "data/sports.json").read_text(encoding="utf-8"))
    erreurs = 0
    # Logos des ligues : data/logos/ligues/<sport>-<ligue>.webp
    dossier_ligues = RACINE / "data/logos/ligues"
    dossier_ligues.mkdir(parents=True, exist_ok=True)
    for sport, conf in sports.items():
        for ligue in conf["ligues"]:
            cible = dossier_ligues / f"{sport}-{ligue['id']}.webp"
            if not ligue.get("logo") or (cible.exists() and not force):
                continue
            try:
                img = Image.open(io.BytesIO(telecharger(ligue["logo"]))).convert("RGBA")
                img.thumbnail((TAILLE, TAILLE), Image.LANCZOS)
                img.save(cible, "WEBP", quality=80, method=6)
                print(f"✓ ligue {sport}-{ligue['id']}")
            except Exception as e:  # noqa: BLE001
                erreurs += 1
                print(f"✗ ligue {sport}-{ligue['id']} : {e}", file=sys.stderr)
            time.sleep(2)
    for sport in sports:
        fichier = RACINE / f"data/{sport}/clubs.json"
        if not fichier.exists():
            continue
        dossier = RACINE / f"data/logos/{sport}"
        dossier.mkdir(parents=True, exist_ok=True)
        for club in json.loads(fichier.read_text(encoding="utf-8")):
            cible = dossier / f"{club['id']}.webp"
            if not club.get("logo") or (cible.exists() and not force):
                continue
            try:
                img = Image.open(io.BytesIO(telecharger(club["logo"]))).convert("RGBA")
                img.thumbnail((TAILLE, TAILLE), Image.LANCZOS)
                img.save(cible, "WEBP", quality=80, method=6)
                print(f"✓ {sport}/{club['id']}")
            except Exception as e:  # noqa: BLE001 — on continue avec les autres logos
                erreurs += 1
                print(f"✗ {sport}/{club['id']} : {e}", file=sys.stderr)
            time.sleep(0.2)
    sys.exit(1 if erreurs else 0)


if __name__ == "__main__":
    main("--force" in sys.argv)
