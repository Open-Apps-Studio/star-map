/**
 * Selected-object card (Stellarium Mobile style): icon, name, type in blue,
 * a Center button that becomes Zoom −/+ once centred. Swipe up for details
 * (facts + Wikipedia summary when online), swipe down to dismiss.
 */
import { $, app, haptic } from "../state";
import { icon, MDI, objectIcon, kindFromOtype, type IconKind } from "../icons";
import { azAlt, displayName, withObserverCopy, type SweObj } from "../engine";
import { fmtTime, whereText } from "../astro";
import { startGuide } from "./pointer";

const D2R = Math.PI / 180;
let current: SweObj | null = null;
let centred = false;

export const selected = () => current;

function otypeOf(obj: SweObj): string | undefined {
  try {
    return obj.jsonData?.types?.[0];
  } catch {
    return undefined;
  }
}
function modelOf(obj: SweObj): string | undefined {
  try {
    return obj.jsonData?.model;
  } catch {
    return undefined;
  }
}

export function iconKind(obj: SweObj): IconKind {
  const name = displayName(obj);
  if (name === "Moon") return "moon";
  if (name === "Sun") return "sun";
  const first = obj.designations()[0] ?? "";
  if (first.startsWith("CON ")) return "constellation";
  return kindFromOtype(otypeOf(obj), modelOf(obj));
}

export function typeLabel(obj: SweObj): string {
  const k = iconKind(obj);
  if (k === "moon") return "Moon";
  if (k === "sun") return "Star";
  if (k === "constellation") return "Constellation";
  if (k === "satellite") return "Artificial satellite";
  if (k === "comet") return "Comet";
  const ot = otypeOf(obj);
  if (ot) {
    try {
      const s = app.stel.otypeToStr(ot);
      if (s) return s;
    } catch {
      /* fall through */
    }
  }
  return k === "planet" ? "Planet" : "Object";
}

/** Moon lit fraction now and whether it's growing. */
function moonPhase(obj: SweObj): { lit: number; waxing: boolean } {
  const lit = obj.getInfo("phase") as number;
  const later = withObserverCopy(app.stel, (o) => {
    o.utc = app.obs.utc + 0.25;
    return obj.getInfo("phase", o) as number;
  });
  return { lit, waxing: later > lit };
}

export function iconFor(obj: SweObj): string {
  const k = iconKind(obj);
  const name = displayName(obj);
  if (k === "moon") return objectIcon("moon", moonPhase(obj));
  return objectIcon(k, { name });
}

function setCentred(on: boolean) {
  centred = on;
  $("center-btn").hidden = on;
  $("zoom-in").hidden = !on;
  $("zoom-out").hidden = !on;
  $("act-caption").textContent = on ? "Zoom" : app.pointing ? "Find" : "Center";
}

export function showCard(obj: SweObj | null) {
  const card = $("card");
  if (!obj || !obj.v) {
    current = null;
    card.hidden = true;
    card.classList.remove("expanded");
    return;
  }
  const same = current && current.v === obj.v;
  current = obj;
  $("card-name").textContent = displayName(obj);
  $("card-type").textContent = typeLabel(obj);
  $("card-icon").innerHTML = iconFor(obj);
  if (!same) {
    card.classList.remove("expanded");
    $("card-wiki").innerHTML = "";
    setCentred(false);
    haptic("selection");
  }
  card.hidden = false;
  updateFacts();
}

const AU_KM = 149597870.7;
const LY_AU = 63241.077;
function distanceText(au: number): string {
  if (au < 0.01) return `${Math.round(au * AU_KM).toLocaleString()} km`;
  if (au < 1000) return `${au.toFixed(au < 10 ? 2 : 1)} AU`;
  const ly = au / LY_AU;
  if (ly < 1e4) return `${Math.round(ly).toLocaleString()} light-years`;
  if (ly < 1e6) return `${Math.round(ly / 1000).toLocaleString()} thousand light-years`;
  return `${(ly / 1e6).toFixed(1)} million light-years`;
}

/** Facts shown when the card is expanded. Cheap enough to refresh 4×/s. */
export function updateFacts() {
  const obj = current;
  if (!obj || !$("card").classList.contains("expanded")) return;
  const rows: [string, string][] = [];
  try {
    const { az, alt } = azAlt(app.stel, obj);
    rows.push(["Now", whereText(az, alt)]);
  } catch {
    /* no position (e.g. constellation) */
  }
  const vmag = obj.getInfo("vmag");
  if (typeof vmag === "number" && Number.isFinite(vmag)) rows.push(["Magnitude", vmag.toFixed(2)]);
  const dist = obj.getInfo("distance");
  if (typeof dist === "number" && dist > 0) rows.push(["Distance", distanceText(dist)]);
  if (iconKind(obj) === "moon") rows.push(["Illuminated", `${Math.round((obj.getInfo("phase") as number) * 100)}%`]);
  if (iconKind(obj) !== "constellation") {
    const ttMinusUtc = app.obs.tt - app.obs.utc;
    const vis = obj.computeVisibility({ startTime: app.obs.tt, endTime: app.obs.tt + 1 });
    if (!vis.length) rows.push(["Rise / set", "Doesn't rise today"]);
    else if (vis[0].rise == null && vis[0].set == null) rows.push(["Rise / set", "Up all day"]);
    else {
      if (vis[0].rise != null) rows.push(["Rises", fmtTime(vis[0].rise - ttMinusUtc)]);
      if (vis[0].set != null) rows.push(["Sets", fmtTime(vis[0].set - ttMinusUtc)]);
    }
  }
  const aka = obj
    .designations()
    .slice(0, 6)
    .map((d) => d.replace(/^NAME /, "").replace(/^\* /, ""))
    .filter((d, i, a) => d !== displayName(obj) && a.indexOf(d) === i)
    .slice(0, 4);
  if (aka.length) rows.push(["Also known as", aka.join(", ")]);
  $("card-facts").innerHTML = rows.map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`).join("");
}

// ---------------------------------------------------------------- Wikipedia
const wikiCache = new Map<string, string>();
function wikiTitles(obj: SweObj): string[] {
  const name = displayName(obj);
  const k = iconKind(obj);
  if (k === "planet" && !["Sun", "Moon"].includes(name)) return [`${name} (planet)`, name];
  if (k === "constellation") return [`${name} (constellation)`, name];
  if (k === "star") return [`${name} (star)`, name];
  return [name];
}

async function loadWiki(obj: SweObj) {
  const box = $("card-wiki");
  const key = displayName(obj);
  if (wikiCache.has(key)) {
    box.innerHTML = wikiCache.get(key)!;
    return;
  }
  box.innerHTML = "";
  for (const title of wikiTitles(obj)) {
    try {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
      if (!r.ok) continue;
      const j = await r.json();
      if (j.type === "disambiguation" || !j.extract) continue;
      const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
      const img = j.thumbnail?.source ? `<img src="${j.thumbnail.source}" alt="">` : "";
      const html = `${img}${esc(j.extract).replace(esc(j.title.replace(/ \(.*\)$/, "")), (m: string) => `<b>${m}</b>`)}<span class="src">From Wikipedia</span>`;
      wikiCache.set(key, html);
      if (current === obj) box.innerHTML = html;
      return;
    } catch {
      return; // offline: facts are enough
    }
  }
}

function setExpanded(on: boolean) {
  const card = $("card");
  card.classList.toggle("expanded", on);
  if (on && current) {
    updateFacts();
    loadWiki(current);
  }
}

// ---------------------------------------------------------------- actions
/** Field of view (degrees) that frames an object nicely when centred. */
function zoomFor(kind: IconKind, obj?: SweObj): number {
  if (kind === "planet" && obj) {
    // Fill ~40% of the short side with the disc (rings included for Saturn).
    const r = obj.getInfo("radius") as number; // angular radius, radians
    if (typeof r === "number" && r > 0) return Math.max(0.002, ((r * 2) / 0.4) * (displayName(obj) === "Saturn" ? 2.3 : 1) / D2R);
  }
  switch (kind) {
    case "constellation": return 50;
    case "galaxy": case "nebula": case "cluster": return 8;
    case "moon": case "sun": return 0.9;
    case "satellite": return 10;
    default: return 20;
  }
}

function center() {
  if (!current) return;
  haptic("light");
  if (app.pointing) {
    startGuide(current);
    return;
  }
  app.stel.pointAndLock(current, 1.0);
  const fov = (app.core.fov as number) / D2R;
  const target = zoomFor(iconKind(current), current);
  if (fov > target * 1.5) app.stel.zoomTo(target * D2R, 2.2);
  setCentred(true);
}

export function initCard() {
  $("center-btn").innerHTML = icon(MDI.mdiCrosshairsGps);
  $("zoom-in").innerHTML = icon(MDI.mdiPlusCircleOutline);
  $("zoom-out").innerHTML = icon(MDI.mdiMinusCircleOutline);
  $("center-btn").addEventListener("click", center);
  $("zoom-in").addEventListener("click", () => {
    app.stel.zoomTo((app.core.fov as number) * 0.3, 0.4);
    haptic("light");
  });
  $("zoom-out").addEventListener("click", () => {
    app.stel.zoomTo(Math.min((app.core.fov as number) * 3, 180 * D2R), 0.6);
    haptic("light");
  });

  // Swipe up to expand, down to collapse/dismiss; tap the title row toggles.
  const card = $("card");
  let startY: number | null = null;
  let moved = false;
  card.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if ((e.target as HTMLElement).closest(".card-more") && card.classList.contains("expanded")) return;
    startY = e.clientY;
    moved = false;
  });
  card.addEventListener("pointermove", (e) => {
    if (startY != null && Math.abs(e.clientY - startY) > 8) moved = true;
  });
  card.addEventListener("pointerup", (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    startY = null;
    const expanded = card.classList.contains("expanded");
    if (!moved) return setExpanded(!expanded);
    if (dy < -24) setExpanded(true);
    else if (dy > 24) {
      if (expanded) setExpanded(false);
      else app.core.selection = 0;
    }
  });
}

/** Called when the user pans away after centring, so the button comes back. */
export function onUnlock() {
  if (centred && !app.core.lock) setCentred(false);
}
