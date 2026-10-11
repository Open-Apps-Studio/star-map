/**
 * Search sheet: field + Cancel, category chips, and result rows with an
 * object icon, name, type (blue) and where it is right now.
 */
import { $, app, haptic } from "../state";
import { icon, MDI, objectIcon, type IconKind } from "../icons";
import { azAlt, D2R, knownNames, type SweObj } from "../engine";
import { compass } from "../astro";
import { resolve, search, type Entry, type Kind } from "../catalog";
import { iconFor, typeLabel } from "./card";
import { startGuide } from "./pointer";

type Chip = { label: string; kinds: Kind[] };
const CHIPS: Chip[] = [
  { label: "Solar system", kinds: ["planet", "satellite"] },
  { label: "Bright stars", kinds: ["star"] },
  { label: "Constellations", kinds: ["constellation"] },
  { label: "Deep sky", kinds: ["deep-sky"] },
];
let activeChip: Chip | null = null;

const FALLBACK_ICON: Record<Kind, IconKind> = { planet: "planet", satellite: "satellite", star: "star", constellation: "constellation", "deep-sky": "galaxy" };

function whereNow(obj: SweObj | null): string {
  if (!obj) return "";
  try {
    const { az, alt } = azAlt(app.stel, obj);
    return alt > 0 ? `${Math.round(alt / D2R)}° · ${compass(az)}` : "Below horizon";
  } catch {
    return "";
  }
}

function render(list: Entry[]) {
  const ul = $("search-results");
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = `<li class="empty">No results</li>`;
    return;
  }
  for (const e of list) {
    const obj = resolve(app.stel, e);
    const li = document.createElement("li");
    const ic = obj ? iconFor(obj) : objectIcon(FALLBACK_ICON[e.kind], { name: e.name });
    const type = obj ? typeLabel(obj) : e.kind === "deep-sky" ? "Deep sky object" : e.kind[0].toUpperCase() + e.kind.slice(1);
    li.innerHTML = `<button><span class="obj-icon">${ic}</span><span class="r-main"><span class="r-text"><div class="r-name"></div><div class="r-type"></div></span><span class="r-where"></span></span></button>`;
    li.querySelector(".r-name")!.textContent = e.name;
    li.querySelector(".r-type")!.textContent = type;
    li.querySelector(".r-where")!.textContent = whereNow(obj);
    li.querySelector("button")!.addEventListener("click", () => choose(e));
    ul.appendChild(li);
  }
}

/** Stars resolve once their sky tile is loaded, so retry briefly. */
function choose(e: Entry) {
  close();
  haptic("selection");
  let tries = 0;
  const attempt = () => {
    const o = resolve(app.stel, e);
    if (!o) return ++tries < 10 && setTimeout(attempt, 300);
    const first = o.designations()[0];
    if (first) knownNames.set(first, e.name);
    if (app.pointing) startGuide(o);
    else {
      app.core.selection = o;
      // Same as tapping Center on the card.
      ($("center-btn") as HTMLButtonElement).click();
    }
  };
  attempt();
}

function refresh() {
  const q = ($("search-input") as HTMLInputElement).value.trim();
  let list: Entry[];
  if (q) list = search(app.catalog, q, 30);
  else if (activeChip) list = app.catalog.filter((e) => activeChip!.kinds.includes(e.kind));
  else {
    const popular = ["Moon", "Jupiter", "Saturn", "Mars", "Venus", "International Space Station", "Polaris", "Sirius", "Vega", "Orion", "Andromeda Galaxy", "Pleiades", "Orion Nebula"];
    list = popular.map((n) => app.catalog.find((e) => e.name === n)).filter(Boolean) as Entry[];
  }
  render(list);
}

function renderChips() {
  const box = $("search-chips");
  box.innerHTML = "";
  for (const c of CHIPS) {
    const b = document.createElement("button");
    b.className = "chip" + (activeChip === c ? " on" : "");
    b.textContent = c.label;
    b.addEventListener("click", () => {
      activeChip = activeChip === c ? null : c;
      renderChips();
      refresh();
    });
    box.appendChild(b);
  }
}

export function open() {
  $("search").hidden = false;
  ($("search-input") as HTMLInputElement).value = "";
  activeChip = null;
  renderChips();
  refresh();
  // Focus inside the tap's handler: iOS only raises the keyboard for a focus
  // that happens during a user gesture (a delayed focus left it down).
  $("search-input").focus();
}

export function close() {
  $("search").hidden = true;
  $("search-input").blur();
}

export function initSearch() {
  $("search-btn").innerHTML = icon(MDI.mdiMagnify);
  document.querySelector("#search .search-field .ic")!.innerHTML = icon(MDI.mdiMagnify);
  $("search-btn").addEventListener("click", open);
  $("search-cancel").addEventListener("click", close);
  $("search-input").addEventListener("input", refresh);
  $("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") ($("search-results").querySelector("button") as HTMLButtonElement | null)?.click();
  });
}
