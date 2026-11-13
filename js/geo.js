import { Delaunay } from "https://cdn.jsdelivr.net/npm/d3-delaunay@6.0.4/+esm";

/* global turf */

// Projection équirectangulaire centrée sur la France : à cette échelle,
// la distance euclidienne projetée suit la distance réelle à ~1 % près.
const K = Math.cos((46.5 * Math.PI) / 180);
const EMPRISE = [-6 * K, 40.5, 11 * K, 52];

const hexVersRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbVersHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const ecart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Mélange vers le blanc (t > 0) ou le noir (t < 0).
const nuance = (rgb, t) => rgb.map((v) => (t > 0 ? v + (255 - v) * t : v * (1 + t)));

const ECART_MIN = 70;
const NUANCES = [0, 0.35, -0.35, 0.6, -0.6];

// Couleur du club, éclaircie ou foncée si un secteur voisin a déjà une couleur
// trop proche (beaucoup de clubs sont rouges ou bleus).
function couleurDistincte(base, voisines) {
  const rgb = hexVersRgb(/^#[0-9a-f]{6}$/i.test(base) ? base : "#888888");
  const candidates = NUANCES.map((t) => nuance(rgb, t));
  const ok = candidates.find((c) => voisines.every((v) => ecart(c, v) >= ECART_MIN));
  return ok || candidates.reduce((meilleure, c) =>
    Math.min(...voisines.map((v) => ecart(c, v))) > Math.min(...voisines.map((v) => ecart(meilleure, v))) ? c : meilleure);
}

// sites : [{ lon, lat, couleur }]. Retourne la triangulation et, par site, sa
// cellule de Voronoï (non découpée : la carte la masque hors de France en SVG)
// et sa couleur, celle du club ajustée pour se distinguer des voisines.
export function construireSecteurs(sites) {
  const vus = new Set();
  const pts = sites.map(({ lon, lat }) => {
    // Deux clubs dans le même stade : décalage infime pour garder deux cellules.
    while (vus.has(`${lon},${lat}`)) lon += 0.0005;
    vus.add(`${lon},${lat}`);
    return [lon * K, lat];
  });
  const delaunay = Delaunay.from(pts);
  const voronoi = delaunay.voronoi(EMPRISE);

  const cellules = sites.map((_, i) => {
    const anneau = voronoi.cellPolygon(i);
    return anneau ? turf.polygon([anneau.map(([x, y]) => [x / K, y])]) : null;
  });

  const rgb = [];
  sites.forEach((site, i) => {
    const voisines = [...delaunay.neighbors(i)].filter((j) => rgb[j]).map((j) => rgb[j]);
    rgb[i] = couleurDistincte(site.couleur, voisines);
  });

  return { delaunay, cellules, couleurs: rgb.map(rgbVersHex) };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// Site le plus proche de (lat, lon) : { i, km }.
export function plusProche(sites, lat, lon) {
  let meilleur = { i: -1, km: Infinity };
  sites.forEach((s, i) => {
    const km = distanceKm(lat, lon, s.lat, s.lon);
    if (km < meilleur.km) meilleur = { i, km };
  });
  return meilleur;
}

// grille : { pasLon, pasLat, cellules: [ix, iy, habitants, …] }, une cellule
// ~5 km (centre ix × pasLon, iy × pasLat) par carré à terre. Habitants et
// surface (km²) par secteur, et part située à plus de seuilKm de son stade.
export function populations(secteurs, sites, grille, seuilKm = Infinity) {
  const { pasLon, pasLat, cellules } = grille;
  const parSecteur = new Array(sites.length).fill(0);
  const surfaces = new Array(sites.length).fill(0);
  const kmCellule = pasLon * 111.32 * pasLat * 110.57;
  let isoles = 0;
  let surfaceIsolee = 0;
  let i = 0;
  for (let k = 0; k < cellules.length; k += 3) {
    const lon = cellules[k] * pasLon;
    const lat = cellules[k + 1] * pasLat;
    const hab = cellules[k + 2];
    i = secteurs.delaunay.find(lon * K, lat, i);
    const km2 = kmCellule * Math.cos((lat * Math.PI) / 180);
    parSecteur[i] += hab;
    surfaces[i] += km2;
    if (distanceKm(lat, lon, sites[i].lat, sites[i].lon) > seuilKm) {
      isoles += hab;
      surfaceIsolee += km2;
    }
  }
  return { parSecteur, surfaces, isoles, surfaceIsolee };
}

// Partie de chaque cellule à plus de km de son stade : comme la cellule
// contient les points dont ce stade est le plus proche, l'union de ces
// morceaux est exactement la zone à plus de km de tout stade.
export function zonesDesertes(secteurs, sites, km) {
  const morceaux = [];
  secteurs.cellules.forEach((cellule, i) => {
    if (!cellule) return;
    const cercle = turf.circle([sites[i].lon, sites[i].lat], km, { steps: 96, units: "kilometers" });
    const reste = turf.difference(turf.featureCollection([cellule, cercle]));
    if (reste) morceaux.push(reste);
  });
  return turf.featureCollection(morceaux);
}
