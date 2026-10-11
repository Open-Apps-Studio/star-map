/**
 * Search sheet: field + Cancel, category chips, and result rows with an
 * object icon, name, type (blue) and where it is right now.
 *
 * Results merge the hand-made catalogue (friendly names, aliases like
 * "Big Dipper") with the full offline index (every bundled star and DSO by
 * any catalogue number, plus asteroids, comets and satellites).
 */
import { $, app, haptic, toast } from "../state";
import { icon, kindFromOtype, MDI, objectIcon, type IconKind } from "../icons";
import { azAlt, D2R, displayName, knownNames, type SweObj } from "../engine";
import { compass } from "../astro";
import { resolve, search, type Entry, type Kind } from "../catalog";
import { hitDirection, loadIndex, resolveHit, searchIndex, type Hit } from "../search-index";
import { settings, type Favourite } from "../settings";
import { iconFor, iconKind, typeLabel } from "./card";
import { startGuide } from "./pointer";

type Chip = { label: string; kinds?: Kind[]; favourites?: boolean; satellites?: boolean };
const CHIPS: Chip[] = [
  { label: "Favourites", favourites: true },
  { label: "Solar system", kinds: ["planet"] },
  { label: "Bright stars", kinds: ["star"] },
  { label: "Constellations", kinds: ["constellation"] },
  { label: "Deep sky", kinds: ["deep-sky"] },
  { label: "Satellites", satellites: true },
];
let activeChip: Chip | null = null;

const FALLBACK_ICON: Record<Kind, IconKind> = { planet: "planet", satellite: "satellite", star: "star", constellation: "constellation", "deep-sky": "galaxy" };

/** One row: a hand-made entry, an index hit, or a favourite. */
type Row =
  | { t: "entry"; e: Entry }
  | { t: "hit"; h: Hit }
  | { t: "fav"; f: Favourite };

function whereText(az: number, alt: number) {
  return alt > 0 ? `${Math.round(alt / D2R)}° · ${compass(az)}` : "Below horizon";
}

function whereNow(obj: SweObj | null): string {
  if (!obj) return "";
  try {
    const { az, alt } = azAlt(app.stel, obj);
    return whereText(az, alt);
  } catch {
    return "";
  }
}

function whereDir(dir: number[] | null): string {
  if (!dir) return "";
  const [az, alt] = app.stel.c2s(dir);
  return whereText(app.stel.anp(az), app.stel.anpm(alt));
}

function rowView(r: Row): { ic: string; name: string; type: string; aka: string; where: string } {
  if (r.t === "entry") {
    const obj = resolve(app.stel, r.e);
    return {
      ic: obj ? iconFor(obj) : objectIcon(FALLBACK_ICON[r.e.kind], { name: r.e.name }),
      name: r.e.name,
      type: obj ? typeLabel(obj) : r.e.kind === "deep-sky" ? "Deep sky object" : r.e.kind[0].toUpperCase() + r.e.kind.slice(1),
      aka: "",
      where: whereNow(obj),
    };
  }
  if (r.t === "fav") {
    const h = favHit(r.f);
    return { ic: objectIcon(r.f.icon ?? "star", { name: r.f.name }), name: r.f.name, type: r.f.type ?? "", aka: "", where: h.ra != null ? whereDir(hitDirection(app.stel, h)) : "" };
  }
  const h = r.h;
  const kind: IconKind = h.otype ? kindFromOtype(h.otype) : h.icon;
  let type = h.kindLabel;
  if (h.otype) {
    try {
      type = app.stel.otypeToStr(h.otype) || type;
    } catch {
      /* keep the generic label */
    }
  }
  let where = whereDir(hitDirection(app.stel, h));
  if (!where && h.ra == null) where = whereNow(resolveHit(app.stel, h));
  return { ic: objectIcon(kind, { name: h.name }), name: h.name, type, aka: h.aka, where };
}

function render(rows: Row[], empty = "No results") {
  const ul = $("search-results");
  ul.innerHTML = "";
  if (!rows.length) {
    ul.innerHTML = `<li class="empty"></li>`;
    ul.firstElementChild!.textContent = empty;
    return;
  }
  for (const r of rows) {
    const v = rowView(r);
    const li = document.createElement("li");
    li.innerHTML = `<button><span class="obj-icon">${v.ic}</span><span class="r-main"><span class="r-text"><div class="r-name"></div><div class="r-type"></div><div class="r-aka"></div></span><span class="r-where"></span></span></button>`;
    li.querySelector(".r-name")!.textContent = v.name;
    li.querySelector(".r-type")!.textContent = v.type;
    li.querySelector(".r-aka")!.textContent = v.aka;
    li.querySelector(".r-where")!.textContent = v.where;
    li.querySelector("button")!.addEventListener("click", () => choose(r));
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- choosing
function select(o: SweObj, name: string) {
  const first = o.designations()[0];
  if (first) knownNames.set(first, name);
  if (app.pointing) startGuide(o);
  else {
    app.core.selection = o;
    // Same as tapping Center on the card.
    ($("center-btn") as HTMLButtonElement).click();
  }
}

const favHit = (f: Favourite): Hit => ({
  name: f.name, aka: "", icon: "star", ids: f.ids, ra: f.ra, de: f.de, kindLabel: "", keys: [], nameKeys: 0,
});

/**
 * Resolve and select. Objects whose sky tile isn't loaded yet can't be found
 * by name, so turn towards their catalogue position first and keep trying
 * while the tile streams in.
 */
function chooseHit(h: Hit) {
  const now = resolveHit(app.stel, h);
  if (now) return select(now, h.name);
  const dir = hitDirection(app.stel, h);
  if (dir && !app.pointing) {
    app.core.lock = 0;
    app.stel.lookAt(dir, 0.8);
  }
  let tries = 0;
  const attempt = () => {
    const o = resolveHit(app.stel, h);
    if (o) return select(o, h.name);
    if (++tries < 30) setTimeout(attempt, 250);
    else toast(`Couldn't load ${h.name}`);
  };
  setTimeout(attempt, 250);
}

function choose(r: Row) {
  close();
  haptic("selection");
  if (r.t === "hit") return chooseHit(r.h);
  if (r.t === "fav") return chooseHit(favHit(r.f));
  // Hand-made entries: stars resolve once their tile is loaded, so retry briefly.
  const e = r.e;
  let tries = 0;
  const attempt = () => {
    const o = resolve(app.stel, e);
    if (!o) return ++tries < 10 ? setTimeout(attempt, 300) : toast(`Couldn't load ${e.name}`);
    select(o, e.name);
  };
  attempt();
}

// ---------------------------------------------------------------- listing
const POPULAR = ["Moon", "Jupiter", "Saturn", "Mars", "Venus", "International Space Station", "Polaris", "Sirius", "Vega", "Orion", "Andromeda Galaxy", "Pleiades", "Orion Nebula"];

let searchSeq = 0;
async function refresh() {
  const q = ($("search-input") as HTMLInputElement).value.trim();
  const seq = ++searchSeq;
  if (!q) {
    if (activeChip?.favourites) {
      render(settings.favourites.map((f) => ({ t: "fav", f }) as Row), "No favourites yet. Open an object and tap the star to add it.");
    } else if (activeChip?.satellites) {
      const index = await loadIndex();
      if (seq !== searchSeq) return;
      render(index.filter((h) => h.icon === "satellite").map((h) => ({ t: "hit", h }) as Row));
    } else if (activeChip?.kinds) {
      render(app.catalog.filter((e) => activeChip!.kinds!.includes(e.kind)).map((e) => ({ t: "entry", e }) as Row));
    } else {
      render(POPULAR.map((n) => app.catalog.find((e) => e.name === n)).filter(Boolean).map((e) => ({ t: "entry", e: e! }) as Row));
    }
    return;
  }
  const curated = search(app.catalog, q, 12);
  const rows: Row[] = curated.map((e) => ({ t: "entry", e }));
  render(rows);
  const index = await loadIndex().catch(() => null);
  if (!index || seq !== searchSeq) return;
  const taken = new Set(curated.flatMap((e) => e.ids));
  const more = searchIndex(index, q, 40).filter((h) => !h.ids.some((id) => taken.has(id)));
  render([...rows, ...more.map((h) => ({ t: "hit", h }) as Row)].slice(0, 40));
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
  loadIndex().catch(() => {}); // warm up while the user types
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
  $("search-input").addEventListener("input", () => refresh());
  $("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") ($("search-results").querySelector("button") as HTMLButtonElement | null)?.click();
  });
}

/** Favourite entry for an engine object (for the card's star button). */
export function favouriteFor(obj: SweObj): Favourite {
  let ra: number | undefined, de: number | undefined;
  try {
    const v = obj.getInfo("radec") as number[];
    const [a, d] = app.stel.c2s(v);
    ra = app.stel.anp(a);
    de = app.stel.anpm(d);
  } catch {
    /* constellations have no single position */
  }
  const kind = iconKind(obj);
  // Moving bodies are found by name; a stored position would go stale.
  if (["planet", "moon", "sun", "comet", "asteroid", "satellite"].includes(kind)) ra = de = undefined;
  return { name: displayName(obj), ids: obj.designations().slice(0, 4), ra, de, type: typeLabel(obj), icon: kind };
}
