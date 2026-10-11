/**
 * Layers sheet: a grid of round toggles (Stellarium's own icons) plus two
 * sub-panels with switches, "Constellations" and "Grids & Lines", matching
 * Stellarium Mobile's layout.
 */
import { $, app, haptic, openPanel } from "../state";
import { icon, MDI } from "../icons";
import cstLines from "../icons/btn-cst-lines.svg";
import cstArt from "../icons/btn-cst-art.svg";
import atmosphere from "../icons/btn-atmosphere.svg";
import landscape from "../icons/btn-landscape.svg";
import azGrid from "../icons/btn-azimuthal-grid.svg";
import nebulae from "../icons/btn-nebulae.svg";
import nightMode from "../icons/btn-night-mode.svg";

type Getter = () => boolean;
type Setter = (v: boolean) => void;
interface Toggle { label: string; get: Getter; set: Setter }

const c = () => app.core;

const CONSTELLATIONS: Toggle[] = [
  { label: "Lines", get: () => c().constellations.lines_visible, set: (v) => (c().constellations.lines_visible = v) },
  { label: "Labels", get: () => c().constellations.labels_visible, set: (v) => (c().constellations.labels_visible = v) },
  { label: "Drawings", get: () => c().constellations.images_visible, set: (v) => (c().constellations.images_visible = v) },
  { label: "Boundaries", get: () => c().constellations.bounds_visible, set: (v) => (c().constellations.bounds_visible = v) },
];
const line = (id: string): Toggle => ({ label: "", get: () => c().lines[id].visible, set: (v) => (c().lines[id].visible = v) });
const LINES: Toggle[] = [
  { ...line("ecliptic"), label: "Ecliptic" },
  { ...line("meridian"), label: "Meridian" },
  { ...line("equator_line"), label: "Celestial Equator" },
];
const GRIDS: Toggle[] = [
  { ...line("azimuthal"), label: "Azimuthal" },
  { ...line("equatorial_jnow"), label: "Equatorial" },
  { ...line("equatorial"), label: "Equatorial J2000" },
];

export function setNight(on: boolean) {
  document.body.classList.toggle("night", on);
  try {
    localStorage.setItem("night", on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

interface Tile { label: string; img?: string; svg?: string; get?: Getter; set?: Setter; open?: () => void }

function tiles(): Tile[] {
  return [
    { label: "Constellations", img: cstLines, get: () => c().constellations.lines_visible, open: () => sub("Constellations", [CONSTELLATIONS]) },
    { label: "Drawings", img: cstArt, get: CONSTELLATIONS[2].get, set: CONSTELLATIONS[2].set },
    { label: "Grids & Lines", img: azGrid, get: () => [...LINES, ...GRIDS].some((t) => t.get()), open: () => sub("Grids & Lines", [LINES, GRIDS], ["Lines", "Grids"]) },
    { label: "Atmosphere", img: atmosphere, get: () => c().atmosphere.visible, set: (v) => (c().atmosphere.visible = v) },
    { label: "Landscape", img: landscape, get: () => c().landscapes.visible, set: (v) => (c().landscapes.visible = v) },
    { label: "Deep sky", img: nebulae, get: () => c().dsos.visible, set: (v) => (c().dsos.visible = v) },
    { label: "Satellites", svg: icon(MDI.mdiSatelliteVariant), get: () => c().satellites.visible, set: (v) => (c().satellites.visible = v) },
    { label: "Milky Way", svg: icon(MDI.mdiChartBellCurve), get: () => c().milkyway.visible, set: (v) => (c().milkyway.visible = v) },
    // Real photos of the sky (DSS) when zoomed in; streamed when online.
    { label: "Sky photos", svg: icon(MDI.mdiImageFilterHdr), get: () => c().dss.visible, set: (v) => (c().dss.visible = v) },
    { label: "Night mode", img: nightMode, get: () => document.body.classList.contains("night"), set: setNight },
  ];
}

function renderRoot() {
  const root = $("layers-root");
  root.innerHTML = "";
  for (const t of tiles()) {
    const b = document.createElement("button");
    b.className = "layer-tile" + (t.open ? " nav" : "") + (t.get?.() ? " on" : "");
    b.innerHTML = `<span class="tile-ic">${t.img ? `<img src="${t.img}" alt="">` : t.svg}</span><span></span>`;
    b.lastElementChild!.textContent = t.label;
    b.addEventListener("click", () => {
      haptic("light");
      if (t.open) return t.open();
      t.set!(!t.get!());
      b.classList.toggle("on", t.get!());
    });
    root.appendChild(b);
  }
}

function switchEl(t: Toggle): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "switch" + (t.get() ? " on" : "");
  b.innerHTML = `<span class="track"></span><span></span>`;
  b.lastElementChild!.textContent = t.label;
  b.addEventListener("click", () => {
    t.set(!t.get());
    b.classList.toggle("on", t.get());
    haptic("light");
  });
  return b;
}

/** Sub-panel: one or two columns of switches. */
function sub(title: string, columns: Toggle[][], heads?: string[]) {
  $("layers-root").hidden = true;
  $("layers-sub").hidden = false;
  $("sub-title").textContent = title;
  const body = $("sub-body");
  body.innerHTML = "";
  if (columns.length === 1) {
    for (const t of columns[0]) body.appendChild(switchEl(t));
    return;
  }
  // Interleave columns row by row so the grid reads like two columns.
  const rows = Math.max(...columns.map((c) => c.length));
  if (heads) for (const h of heads) body.insertAdjacentHTML("beforeend", `<div class="col-head">${h}</div>`);
  for (let r = 0; r < rows; r++) for (const col of columns) body.appendChild(col[r] ? switchEl(col[r]) : document.createElement("span"));
}

export function openLayers() {
  renderRoot();
  $("layers-root").hidden = false;
  $("layers-sub").hidden = true;
  openPanel("layers-sheet");
}

export function initLayers() {
  $("layers-btn").innerHTML = icon(MDI.mdiLayersOutline);
  $("sub-back").innerHTML = icon(MDI.mdiArrowLeft);
  $("layers-btn").addEventListener("click", () => ($("layers-sheet").hidden ? openLayers() : openPanel(null)));
  $("sub-back").addEventListener("click", () => {
    renderRoot();
    $("layers-root").hidden = false;
    $("layers-sub").hidden = true;
  });
  try {
    if (localStorage.getItem("night") === "1") setNight(true);
  } catch {
    /* ignore */
  }
}
