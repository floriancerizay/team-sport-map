import { chargerJSON, chargerSport, clubsActifs, frise, liguesDisponibles, stadePour, titres } from "./data.js";
import { construireSecteurs, plusProche, populations, zonesDesertes } from "./geo.js";

/* global L */

const $ = (sel) => document.querySelector(sel);
const nombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const pourcent = (x) => `${x.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const ZOOM_LOGOS = 8;
const NOMS_CARTES = ["A", "B"];

const [sports, france, grille] = await Promise.all([
  chargerJSON("data/sports.json"),
  chargerJSON("data/france.geojson"),
  chargerJSON("data/population.json"),
]);

// ---------- État (synchronisé avec l'URL) ----------
// Une configuration de carte : { saison, choix: { sport: [ids de divisions] } }.
// Dans l'URL : a=2025-26~rugby.top14.prod2~football.ligue1

// Division par défaut : la première (élite).
const liguesParDefaut = (sport) => sports[sport].ligues.slice(0, 1).map((l) => l.id);

function lireConfig(valeur) {
  if (!valeur) return null;
  const [saison, ...morceaux] = valeur.split("~");
  const choix = {};
  for (const m of morceaux) {
    const [sport, ...ids] = m.split(".");
    if (!sports[sport]) continue;
    const valides = ids.filter((id) => sports[sport].ligues.some((l) => l.id === id));
    choix[sport] = valides.length ? valides : liguesParDefaut(sport);
    break; // un seul sport par carte
  }
  return Object.keys(choix).length ? { saison, choix } : null;
}

const ecrireConfig = (cfg) =>
  [cfg.saison, ...Object.entries(cfg.choix).map(([sport, ids]) => [sport, ...ids].join("."))].join("~");

const params = new URLSearchParams(location.search);
const etat = {
  configs: [
    lireConfig(params.get("a")) || { saison: null, choix: { rugby: liguesParDefaut("rugby") } },
    lireConfig(params.get("b")),
  ],
  desert: params.has("desert") ? Number(params.get("desert")) || 120 : null,
  point: null,
  tableau: 0,
  tri: null,
};

function ecrireURL() {
  const p = new URLSearchParams({ a: ecrireConfig(etat.configs[0]) });
  if (etat.configs[1]) p.set("b", ecrireConfig(etat.configs[1]));
  if (etat.desert) p.set("desert", etat.desert);
  history.replaceState(null, "", `?${p}`);
}

// ---------- Logos ----------

function initiales(club) {
  const mots = club.court.split(/[\s-]+/).filter((m) => /^[A-ZÀ-Ý0-9]/.test(m));
  return (mots.length > 1 ? mots.map((m) => m[0]).join("") : club.court.slice(0, 3)).slice(0, 3).toUpperCase();
}

// Logo (copie locale, voir tools/telecharger_logos.py), avec repli sur une
// pastille aux initiales si absent ou cassé.
function htmlLogo(club, sport, taille) {
  const img = club.logo
    ? `<img src="data/logos/${sport}/${club.id}.webp" alt="" loading="lazy"
        onerror="this.parentNode.classList.add('sans')">`
    : "";
  return `<span class="logo${club.logo ? "" : " sans"}" style="--taille:${taille}px">${img}<span
    class="initiales" style="background:${echapper(club.couleur)}">${echapper(initiales(club))}</span></span>`;
}

const badge = (a) =>
  `<span class="badge n${a.niveau}">${sports[a.sport].icone} ${echapper(a.ligue.nom)}</span>`;

// ---------- Cartes ----------

const FOND =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2" +
  "&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const Etiquette = L.Control.extend({
  options: { position: "topright" },
  onAdd() {
    this._div = L.DomUtil.create("div", "etiquette");
    return this._div;
  },
  html(h) {
    this._div.innerHTML = h;
  },
});

const SVG = "http://www.w3.org/2000/svg";

function creerCarte(element, index) {
  const map = L.map(element, { zoomSnap: 0.5 }).fitBounds([[41.3, -5.2], [51.1, 9.6]]);
  // crossOrigin : nécessaire pour l'export PNG (les tuiles IGN autorisent le CORS).
  L.tileLayer(FOND, { attribution: "© IGN Géoplateforme", className: "fond", maxZoom: 18, crossOrigin: true }).addTo(map);

  // Les secteurs ont leur propre calque SVG, découpé par le contour de la France
  // (clipPath) : les cellules de Voronoï restent entières, sans calcul géométrique.
  map.createPane("secteurs").style.zIndex = 350;
  const rendu = L.svg({ pane: "secteurs", padding: 0.5 }).addTo(map);
  const defs = document.createElementNS(SVG, "defs");
  defs.innerHTML = `
    <pattern id="hachures-${index}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#b3261e" stroke-width="2.5" />
    </pattern>
    <clipPath id="france-${index}"></clipPath>`;
  rendu._container.prepend(defs);
  // Leaflet continue de mettre à jour le tracé déplacé dans le clipPath.
  L.geoJSON(france, { renderer: rendu, interactive: false, style: { stroke: false } }).addTo(map)
    .eachLayer((l) => {
      l._path.setAttribute("clip-rule", "evenodd");
      defs.lastElementChild.append(l._path);
    });
  rendu._rootGroup.setAttribute("clip-path", `url(#france-${index})`);

  const c = {
    index,
    map,
    rendu,
    etiquette: new Etiquette().addTo(map),
    couches: Object.fromEntries(["secteurs", "desert", "stades", "point"].map((n) => [n, L.layerGroup().addTo(map)])),
    popup: L.popup({ className: "popup-proches", maxWidth: 340, autoPan: index === 0, autoPanPaddingTopLeft: [16, 56], autoPanPaddingBottomRight: [16, 16] }),
    modeLogos: map.getZoom() >= ZOOM_LOGOS,
    vue: null,
    stats: null,
  };
  map.on("click", (e) => choisirPoint(e.latlng));
  map.on("zoomend", () => {
    if ((map.getZoom() >= ZOOM_LOGOS) === c.modeLogos || !c.vue) return;
    c.modeLogos = !c.modeLogos;
    dessinerStades(c);
  });
  c.popup.on("remove", () => {
    if (!etat.point) return;
    etat.point = null;
    for (const autre of cartes) {
      autre.couches.point.clearLayers();
      autre.map.closePopup(autre.popup);
    }
  });
  return c;
}

const cartes = [creerCarte("carte-a", 0)];

// Les deux cartes suivent le même cadrage.
let enSynchro = false;
function synchroniser(source, cible) {
  source.map.on("move", () => {
    if (enSynchro) return;
    enSynchro = true;
    cible.map.setView(source.map.getCenter(), source.map.getZoom(), { animate: false });
    enSynchro = false;
  });
}

function carteB() {
  if (!cartes[1]) {
    $("#carte-b").hidden = false;
    cartes[1] = creerCarte("carte-b", 1);
    cartes[1].map.setView(cartes[0].map.getCenter(), cartes[0].map.getZoom(), { animate: false });
    synchroniser(cartes[0], cartes[1]);
    synchroniser(cartes[1], cartes[0]);
  }
  return cartes[1];
}

// ---------- Construction d'une « vue » (saison + sports + divisions) ----------

async function construireVue(cfg) {
  const parSport = await Promise.all(Object.entries(cfg.choix).map(async ([sport, ligues]) => {
    const conf = sports[sport];
    const donnees = await chargerSport(sport);
    return { sport, conf, donnees, ligues };
  }));
  const saisons = [...new Set(parSport.flatMap((s) => Object.keys(s.donnees.saisons)))].sort();
  const saison = saisons.includes(cfg.saison) ? cfg.saison : saisons.at(-1);

  const actifs = [];
  for (const s of parSport) {
    s.disponibles = liguesDisponibles(s.donnees, s.conf, saison);
    s.retenues = s.ligues.filter((id) => s.disponibles.some((l) => l.id === id));
    if (!s.retenues.length) s.retenues = s.disponibles.map((l) => l.id);
    const avecSport = (a) => ({ ...a, sport: s.sport });
    actifs.push(...clubsActifs(s.donnees, s.conf, saison, s.retenues).map(avecSport));
    // Tous les clubs de la saison, pour le club le plus proche par division.
    s.tous = clubsActifs(s.donnees, s.conf, saison, s.disponibles.map((l) => l.id)).map(avecSport);
  }
  const sites = actifs.map((a) => ({ lon: a.stade.lon, lat: a.stade.lat, couleur: a.club.couleur }));
  return { saison, saisons, parSport, actifs, sites, secteurs: construireSecteurs(sites) };
}

// Logo officiel d'une ligue (data/logos/ligues/), masqué s'il est absent.
const htmlLogoLigue = (sport, ligue, taille) =>
  `<img class="logo-ligue" src="data/logos/ligues/${sport}-${ligue.id}.webp" alt="" width="${taille}" height="${taille}"
        onerror="this.remove()">`;

const libelleVue = (v) => {
  const ligues = v.parSport.map((s) =>
    s.disponibles.filter((l) => s.retenues.includes(l.id)).map((l) =>
      `<span class="ligue-etiq">${htmlLogoLigue(s.sport, l, 20)}${echapper(l.nom)}</span>`).join(""));
  return `${ligues.join("")}<span class="saison-etiq">${echapper(v.saison)}</span>`;
};

async function rafraichir() {
  const comparer = !!etat.configs[1];
  $("#carte-b").hidden = !comparer;
  if (comparer) carteB();
  const actives = comparer ? cartes : [cartes[0]];

  for (const [i, c] of actives.entries()) {
    c.vue = await construireVue(etat.configs[i]);
    etat.configs[i].saison = c.vue.saison;
    c.stats = populations(c.vue.secteurs, c.vue.sites, grille, etat.desert ?? Infinity);
  }
  for (const c of cartes) c.map.invalidateSize();

  majControles();
  for (const c of actives) {
    c.etiquette.html(`${comparer ? `<span class="saison-etiq">${echapper(NOMS_CARTES[c.index])}</span>` : ""}${libelleVue(c.vue)}`);
    dessinerSecteurs(c);
    dessinerDesert(c);
    dessinerStades(c);
  }
  afficherStatsDesert(actives);
  if (etat.tableau >= actives.length) etat.tableau = 0;
  dessinerTableau();
  afficherProches();
  ecrireURL();
}

// ---------- Contrôles ----------

function bouton(texte, { actif, role = "aria-pressed", desactive, titre, surClic }) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = texte;
  b.setAttribute(role, !!actif);
  if (role === "aria-checked") b.setAttribute("role", "radio");
  if (desactive) b.disabled = true;
  if (titre) b.title = titre;
  b.onclick = surClic;
  return b;
}

function el(tag, classe, ...enfants) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  e.append(...enfants);
  return e;
}

// Panneau de réglage d'une carte : sport, saison, divisions.
function controles(conteneur, cfg, v) {
  const changer = () => rafraichir();

  const ligneSports = el("div", "segment sports", ...Object.entries(sports).map(([id, s]) =>
    bouton(s.nom, {
      actif: id in cfg.choix,
      surClic: () => {
        if (id in cfg.choix) return;
        cfg.choix = { [id]: liguesParDefaut(id) };
        changer();
      },
    })));
  ligneSports.setAttribute("aria-label", "Sports");

  const select = el("select", "", ...v.saisons.map((s) => new Option(s, s, false, s === v.saison)).reverse());
  select.setAttribute("aria-label", "Saison");
  select.onchange = () => {
    cfg.saison = select.value;
    changer();
  };
  const idx = v.saisons.indexOf(v.saison);
  const pas = (n, texte, label) => {
    const b = bouton(texte, { desactive: !v.saisons[idx + n], surClic: () => {
      cfg.saison = v.saisons[idx + n];
      changer();
    } });
    b.className = "icone";
    b.setAttribute("aria-label", label);
    return b;
  };
  const ligneSaison = el("div", "ligne", pas(-1, "‹", "Saison précédente"), select, pas(1, "›", "Saison suivante"));

  // Une rangée de divisions par sport ; au moins une division reste choisie.
  const divisions = v.parSport.map((s) => {
    const noms = new Map(s.disponibles.map((l) => [l.id, l.nom]));
    const boutons = s.conf.ligues.map((l) => bouton(noms.get(l.id) || l.nom, {
      actif: noms.has(l.id) && s.retenues.includes(l.id),
      desactive: !noms.has(l.id),
      titre: noms.has(l.id) ? "" : `Pas de ${l.nom} en ${v.saison}`,
      surClic: () => {
        const ids = s.retenues.includes(l.id) ? s.retenues.filter((x) => x !== l.id) : [...s.retenues, l.id];
        if (!ids.length) return;
        // Garder aussi les divisions choisies mais absentes cette saison.
        cfg.choix[s.sport] = [...new Set([...ids, ...cfg.choix[s.sport].filter((x) => !noms.has(x))])];
        changer();
      },
    }));
    const rangee = el("div", "segment bascules", ...boutons);
    rangee.setAttribute("aria-label", `Divisions ${s.conf.nom}`);
    return rangee;
  });

  conteneur.replaceChildren(ligneSports, ligneSaison, ...divisions);
}

function majControles() {
  const comparer = !!etat.configs[1];
  controles($("#ctrl-a"), etat.configs[0], cartes[0].vue);
  if (comparer) {
    controles($("#ctrl-b"), etat.configs[1], cartes[1].vue);
    $("#ctrl-a").prepend(el("h2", "titre-carte", "Carte A"));
    $("#ctrl-b").prepend(el("h2", "titre-carte", "Carte B"));
  }
  $("#ctrl-b").hidden = !comparer;
  $("#cmp-actif").checked = comparer;

  $("#desert-actif").checked = !!etat.desert;
  $("#desert-reglage").hidden = $("#desert-stats").hidden = !etat.desert;
  if (etat.desert) {
    $("#desert-km").value = etat.desert;
    $("#desert-valeur").textContent = `${etat.desert} km`;
    $("#options").open = true;
  }

  $("#tableau-choix").hidden = !comparer;
  $("#tableau-choix").replaceChildren(...(comparer ? cartes : []).map((c) =>
    bouton(`Carte ${NOMS_CARTES[c.index]}`, {
      role: "aria-checked",
      actif: etat.tableau === c.index,
      surClic: () => {
        etat.tableau = c.index;
        majControles();
        dessinerTableau();
      },
    })));
}

$("#cmp-actif").onchange = (e) => {
  if (e.target.checked) {
    // Par défaut, la carte B montre un autre sport sur la même saison.
    const a = etat.configs[0];
    const autre = Object.keys(sports).find((s) => !(s in a.choix)) || Object.keys(sports)[0];
    etat.configs[1] = { saison: a.saison, choix: { [autre]: liguesParDefaut(autre) } };
  } else {
    etat.configs[1] = null;
  }
  rafraichir();
};

$("#desert-actif").onchange = (e) => {
  etat.desert = e.target.checked ? Number($("#desert-km").value) : null;
  rafraichir();
};
$("#desert-km").oninput = (e) => ($("#desert-valeur").textContent = `${e.target.value} km`);
$("#desert-km").onchange = (e) => {
  etat.desert = Number(e.target.value);
  rafraichir();
};

// ---------- Dessin ----------

// Vainqueur(s) de la saison dans les divisions affichées : zone en surbrillance.
function estChampion(c, a) {
  const { champions } = c.vue.parSport.find((s) => s.sport === a.sport).donnees;
  return champions[c.vue.saison]?.[a.ligue.id] === a.club.id;
}

function dessinerSecteurs(c) {
  c.couches.secteurs.clearLayers();
  const champions = c.vue.actifs.map((a) => estChampion(c, a));
  const surbrillance = champions.some(Boolean);
  const dessiner = (i) => {
    const cellule = c.vue.secteurs.cellules[i];
    if (!cellule) return;
    const { club, ligue } = c.vue.actifs[i];
    const champion = champions[i];
    L.geoJSON(cellule, {
      renderer: c.rendu,
      style: champion
        ? { color: "#b8860b", weight: 4, fillColor: c.vue.secteurs.couleurs[i], fillOpacity: 0.9 }
        : { color: "#fff", weight: 1.5, fillColor: c.vue.secteurs.couleurs[i], fillOpacity: surbrillance ? 0.3 : 0.5 },
    })
      .bindTooltip(`${champion ? `★ Champion ${echapper(ligue.nom)} ${c.vue.saison}<br>` : ""}` +
        `${echapper(club.court)} · ${nombre.format(c.stats.parSecteur[i])} hab.`, { sticky: true })
      .addTo(c.couches.secteurs);
  };
  // Les vainqueurs en dernier, pour que leur contour passe au-dessus.
  c.vue.actifs.forEach((_, i) => !champions[i] && dessiner(i));
  c.vue.actifs.forEach((_, i) => champions[i] && dessiner(i));
}

function dessinerDesert(c) {
  c.couches.desert.clearLayers();
  if (!etat.desert) return;
  L.geoJSON(zonesDesertes(c.vue.secteurs, c.vue.sites, etat.desert), {
    renderer: c.rendu,
    style: { color: "#b3261e", weight: 1, fillColor: `url(#hachures-${c.index})`, fillOpacity: 1 },
    interactive: false,
  }).addTo(c.couches.desert);
}

function afficherStatsDesert(actives) {
  if (!etat.desert) return;
  $("#desert-stats").innerHTML = `À plus de ${etat.desert} km d'un club :` + actives.map((c) => {
    const part = (100 * c.stats.isoles) / c.stats.parSecteur.reduce((a, b) => a + b, 0);
    return `<br>${actives.length > 1 ? `<b>${NOMS_CARTES[c.index]}</b> : ` : ""}${nombre.format(c.stats.surfaceIsolee)} km², ` +
      `${nombre.format(c.stats.isoles)} hab. (${pourcent(part)})`;
  }).join("");
}

const STYLE_NIVEAU = { 1: { radius: 7, weight: 2.5 }, 2: { radius: 5, weight: 1.2 } };

// Marqueur de stade : rond coloré de loin, logo au zoom ≥ ZOOM_LOGOS.
function dessinerStades(c) {
  c.couches.stades.clearLayers();
  const logos = c.map.getZoom() >= ZOOM_LOGOS;
  const visibles = c.vue.actifs;
  for (const a of visibles) {
    const pos = [a.stade.lat, a.stade.lon];
    const m = logos
      ? L.marker(pos, {
        icon: L.divIcon({ html: htmlLogo(a.club, a.sport, 30), className: `marqueur-logo n${a.niveau}`, iconSize: [36, 36] }),
      })
      : L.circleMarker(pos, {
        ...STYLE_NIVEAU[a.niveau], color: "#1d1d1f", fillColor: a.club.couleur, fillOpacity: 1, bubblingMouseEvents: false,
      });
    m.bindTooltip(`<b>${echapper(a.club.nom)}</b><br>${echapper(a.stade.nom)} · ${badge(a)}`)
      .on("click", () => ouvrirFiche(a.sport, a.club.id, c.vue.saison))
      .addTo(c.couches.stades);
  }
}

// Colonnes du tableau : [clé, titre, numérique].
const COLONNES = [["nom", "Club"], ["pop", "Habitants", true], ["km2", "km²", true]];
const TRI_DEFAUT = { cle: "pop", sens: -1 };
const LIGNES_MAX = 60;

function lignesTableau(c) {
  const saison = c.vue.saison;
  return c.vue.actifs.map((a, i) => ({
      nom: a.club.court,
      pop: c.stats.parSecteur[i],
      km2: c.stats.surfaces[i],
      cellules: [
        `<span class="club"><span class="pastille" style="background:${c.vue.secteurs.couleurs[i]}"></span>${htmlLogo(a.club, a.sport, 20)}
          ${echapper(a.club.court)} ${badge(a)}</span>`,
        nombre.format(c.stats.parSecteur[i]),
        nombre.format(c.stats.surfaces[i]),
      ],
      clic: () => {
        c.map.flyTo([a.stade.lat, a.stade.lon], 9);
        ouvrirFiche(a.sport, a.club.id, saison);
      },
  }));
}

function dessinerTableau() {
  const c = cartes[etat.tableau];
  const colonnes = COLONNES;
  if (!etat.tri || !colonnes.some(([cle]) => cle === etat.tri.cle)) etat.tri = { ...TRI_DEFAUT };
  const { cle, sens } = etat.tri;

  $("#secteurs thead tr").replaceChildren(...colonnes.map(([k, titre, num]) => {
    const th = el("th", num ? "num" : "", titre);
    th.setAttribute("aria-sort", k === cle ? (sens > 0 ? "ascending" : "descending") : "none");
    th.onclick = () => {
      etat.tri = { cle: k, sens: cle === k ? -sens : num ? -1 : 1 };
      dessinerTableau();
    };
    return th;
  }));

  const lignes = lignesTableau(c);
  lignes.sort((x, y) => (cle === "nom" ? x.nom.localeCompare(y.nom, "fr") : x[cle] - y[cle]) * sens);
  $("#secteurs tbody").replaceChildren(...lignes.slice(0, LIGNES_MAX).map((l) => {
    const tr = document.createElement("tr");
    tr.innerHTML = l.cellules.map((html, k) => `<td class="${colonnes[k][2] ? "num" : ""}">${html}</td>`).join("");
    tr.onclick = l.clic;
    return tr;
  }));
  if (!lignes.length) {
    $("#secteurs tbody").innerHTML = `<tr><td colspan="${colonnes.length}" class="note">Aucun résultat.</td></tr>`;
  }
}

// ---------- Club le plus proche, par division (popup au clic) ----------

const EPAISSEUR = { 1: 3, 2: 2 };

function contenuProches(c, lat, lng) {
  return c.vue.parSport.map((s) => {
    const proches = s.disponibles.map((ligue) => {
      const candidats = s.tous.filter((a) => a.ligue.id === ligue.id);
      const p = plusProche(candidats.map((a) => a.stade), lat, lng);
      return { a: candidats[p.i], km: p.km };
    });
    for (const { a } of proches) {
      L.polyline([[lat, lng], [a.stade.lat, a.stade.lon]], {
        color: "#1d1d1f", weight: EPAISSEUR[a.niveau], dashArray: "4 6", interactive: false,
      }).addTo(c.couches.point);
    }
    return `<ul>${proches.map(({ a, km }) => `
      <li>${htmlLogo(a.club, a.sport, 28)}
        <div><button type="button" class="lien" data-sport="${a.sport}" data-club="${a.club.id}"
          data-saison="${c.vue.saison}">${echapper(a.club.nom)}</button>
          <div class="note">${badge(a)} ${nombre.format(km)} km</div></div></li>`).join("")}</ul>`;
  }).join("");
}

function afficherProches() {
  for (const c of cartes) c.couches.point.clearLayers();
  if (!etat.point) return;
  const { lat, lng } = etat.point;
  for (const c of cartes) {
    if (!c.vue || (c.index === 1 && !etat.configs[1])) continue;
    L.circleMarker([lat, lng], { radius: 5, color: "#1d1d1f", fillColor: "#fff", fillOpacity: 1, interactive: false })
      .addTo(c.couches.point);
    c.popup.setLatLng(etat.point).setContent(`<div class="proches">${contenuProches(c, lat, lng)}</div>`);
    if (!c.popup.isOpen()) c.popup.openOn(c.map);
  }
}

$("#cartes").addEventListener("click", (e) => {
  const b = e.target.closest(".popup-proches [data-club]");
  if (b) ouvrirFiche(b.dataset.sport, b.dataset.club, b.dataset.saison);
});

function choisirPoint(latlng) {
  etat.point = latlng;
  afficherProches();
}

// ---------- Export PNG ----------

const HTML_TO_IMAGE = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js";

function chargerScript(src) {
  return new Promise((ok, echec) => {
    const script = Object.assign(document.createElement("script"), { src, onload: ok, onerror: echec });
    document.head.append(script);
  });
}

$("#exporter").onclick = async () => {
  const b = $("#exporter");
  b.disabled = true;
  b.textContent = "Export en cours…";
  try {
    if (!window.htmlToImage) await chargerScript(HTML_TO_IMAGE);
    const url = await window.htmlToImage.toPng($("#cartes"), {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      skipFonts: true,
      filter: (n) => !n.classList?.contains("leaflet-control-zoom") && n.id !== "fiche",
    });
    const nom = ["secteurs", ...etat.configs.filter(Boolean).map((cfg) => cfg.saison)].join("-");
    Object.assign(document.createElement("a"), { href: url, download: `sectormap-${nom}.png` }).click();
  } catch (err) {
    console.error(err);
    $("#resultat").textContent = `Export impossible : ${err.message || err}`;
  } finally {
    b.disabled = false;
    b.textContent = "Exporter en PNG";
  }
};

// ---------- Fiche club ----------

async function ouvrirFiche(sport, clubId, saison) {
  const conf = sports[sport];
  const donnees = await chargerSport(sport);
  const club = donnees.clubs.get(clubId);
  const historique = frise(donnees, conf, clubId);
  const palmaresClub = titres(donnees, conf, clubId);
  const titresParSaison = new Set(palmaresClub.map((t) => t.saison));
  const stade = stadePour(club, saison);
  const presences = conf.ligues
    .map((l, n) => [l.nom, historique.filter((h) => h.niveau === n + 1).length])
    .filter(([, nb]) => nb)
    .map(([nom, nb]) => `${nb} en ${nom}`);

  $("#fiche-contenu").innerHTML = `
    <div class="fiche-titre">${htmlLogo(club, sport, 48)}<div>
      <h2>${echapper(club.nom)}</h2>
      <div class="note">${echapper(club.ville)} · ${conf.icone} ${echapper(conf.nom)}</div></div></div>
    <dl>
      <dt>Stade</dt><dd>${echapper(stade.nom)}</dd>
      ${stade.capacite ? `<dt>Capacité</dt><dd>${nombre.format(stade.capacite)} places</dd>` : ""}
      <dt>Saisons</dt><dd>${presences.join(", ") || "—"}</dd>
      ${palmaresClub.length ? `<dt>Titres</dt><dd>${palmaresClub.map((t) => `★ ${t.saison} ${echapper(t.ligue.nom)}`).join("<br>")}</dd>` : ""}
      ${club.stades.length > 1 ? `<dt>Stades</dt><dd>${club.stades.map((s) => `${echapper(s.nom)} (dès ${s.depuis})`).join("<br>")}</dd>` : ""}
    </dl>
    <div class="frise">${historique.map((h) =>
      `<span class="${h.niveau ? `n${h.niveau}` : ""}" title="${h.saison} : ${h.ligue ? echapper(h.ligue.nom) : "absent"}${titresParSaison.has(h.saison) ? ", champion" : ""}"${titresParSaison.has(h.saison) ? ' data-titre=""' : ""}></span>`).join("")}</div>
    <div class="frise-legende"><span>${historique[0].saison}</span><span>${historique.at(-1).saison}</span></div>
    <p class="note frise-cles">${conf.ligues.map((l, n) => `<span><i class="n${n + 1}"></i>${echapper(l.nom)}</span>`).join("")}
      <span><i></i>absent</span>${palmaresClub.length ? '<span><i data-titre=""></i>titre</span>' : ""}</p>
    ${club.wiki ? `<p><a href="${echapper(club.wiki)}" target="_blank" rel="noopener">Wikipédia ↗</a></p>` : ""}`;
  $("#fiche").hidden = false;
}

$("#fiche .fermer").onclick = () => ($("#fiche").hidden = true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#fiche").hidden = true;
});

rafraichir().catch((err) => {
  console.error(err);
  $("#resultat").textContent = `Erreur de chargement des données : ${err.message}`;
});
