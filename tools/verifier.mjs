// Contrôle de cohérence des données : node tools/verifier.mjs
import { readFileSync } from "node:fs";

const lire = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const sports = lire("sports.json");
let erreurs = 0;
const erreur = (msg) => {
  erreurs++;
  console.error(`✗ ${msg}`);
};

for (const [sport, conf] of Object.entries(sports)) {
  const clubs = lire(`${sport}/clubs.json`);
  const saisons = lire(`${sport}/saisons.json`);
  const ids = new Set(clubs.map((c) => c.id));
  const utilises = new Set();

  for (const c of clubs) {
    if (!c.stades?.length) erreur(`${sport}/${c.id} : aucun stade`);
    if (c.logo && !/^https:\/\/(commons\.wikimedia|fr\.wikipedia)\.org\/wiki\/Special:FilePath\//.test(c.logo)) {
      erreur(`${sport}/${c.id} : logo inattendu ${c.logo}`);
    }
    for (const s of c.stades ?? []) {
      if (!(s.lat > 41 && s.lat < 51.2 && s.lon > -5.2 && s.lon < 9.7)) erreur(`${sport}/${c.id} : coordonnées hors France (${s.lat}, ${s.lon})`);
    }
  }

  for (const saison of Object.keys(saisons).sort()) {
    const vus = new Set();
    const effectifs = conf.ligues.filter((l) => saisons[saison][l.id]).map((l) => {
      const liste = saisons[saison][l.id];
      for (const id of liste) {
        if (!ids.has(id)) erreur(`${sport} ${saison} : club inconnu ${id}`);
        if (vus.has(id)) erreur(`${sport} ${saison} : ${id} présent deux fois`);
        vus.add(id);
        utilises.add(id);
      }
      return `${l.nom} ${liste.length}`;
    });
    console.log(`${sport} ${saison} : ${effectifs.join(", ")}`);
  }
  for (const id of ids) if (!utilises.has(id)) erreur(`${sport} : club jamais utilisé ${id}`);

  let champions = {};
  try {
    champions = lire(`${sport}/champions.json`);
  } catch {
    // Pas de palmarès pour ce sport.
  }
  for (const [saison, gagnants] of Object.entries(champions)) {
    for (const [ligue, id] of Object.entries(gagnants)) {
      if (!saisons[saison]?.[ligue]?.includes(id)) erreur(`${sport} ${saison} : champion ${id} absent de ${ligue}`);
    }
  }
}

process.exit(erreurs ? 1 : 0);
