const cache = new Map();

export async function chargerJSON(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(url);
}

export async function chargerSport(sport) {
  const [clubs, saisons, champions] = await Promise.all([
    chargerJSON(`data/${sport}/clubs.json`),
    chargerJSON(`data/${sport}/saisons.json`),
    chargerJSON(`data/${sport}/champions.json`).catch(() => ({})),
  ]);
  return { clubs: new Map(clubs.map((c) => [c.id, c])), saisons, champions };
}

// Stade en service pour une saison : dernier stade dont « depuis » <= saison.
export function stadePour(club, saison) {
  let stade = club.stades[0];
  for (const s of club.stades) if (s.depuis <= saison) stade = s;
  return stade;
}

// Division avec le nom qu'elle portait cette saison-là (Pro B → Élite 2…).
function ligueEn(ligue, niveau, saison) {
  let nom = ligue.nom;
  for (const r of ligue.renommages || []) if (r.depuis <= saison) nom = r.nom;
  return { id: ligue.id, nom, niveau };
}

// Divisions disputées cette saison (la Nationale n'existe qu'à partir de 2020-21).
export function liguesDisponibles(donnees, conf, saison) {
  const compo = donnees.saisons[saison] || {};
  return conf.ligues
    .map((l, i) => ligueEn(l, i + 1, saison))
    .filter((l) => compo[l.id]?.length);
}

// ligues : ids des divisions retenues.
export function clubsActifs(donnees, conf, saison, ligues) {
  const compo = donnees.saisons[saison] || {};
  const actifs = [];
  for (const ligue of liguesDisponibles(donnees, conf, saison)) {
    if (!ligues.includes(ligue.id)) continue;
    for (const id of compo[ligue.id]) {
      const club = donnees.clubs.get(id);
      if (!club) {
        console.warn(`Club inconnu : ${id} (${saison})`);
        continue;
      }
      actifs.push({ club, ligue, niveau: ligue.niveau, stade: stadePour(club, saison) });
    }
  }
  return actifs;
}

// Division du club pour chaque saison (null si absent).
export function frise(donnees, conf, clubId) {
  return Object.keys(donnees.saisons).sort().map((saison) => {
    const ligue = liguesDisponibles(donnees, conf, saison)
      .find((l) => donnees.saisons[saison][l.id].includes(clubId)) || null;
    return { saison, niveau: ligue?.niveau ?? null, ligue };
  });
}

// Titres remportés par un club : [{ saison, ligue }].
export function titres(donnees, conf, clubId) {
  return Object.keys(donnees.champions).sort().flatMap((saison) =>
    liguesDisponibles(donnees, conf, saison)
      .filter((l) => donnees.champions[saison][l.id] === clubId)
      .map((ligue) => ({ saison, ligue })));
}
