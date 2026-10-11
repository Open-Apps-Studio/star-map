/**
 * Visibility graph for the selected object (Stellarium Mobile Plus's
 * interactive elevation graph): its altitude from noon to noon around the
 * current night, over day / twilight / night bands, with rise, transit and
 * set, the best time to look, and a "now" marker. Drag across it to move
 * the sky's time.
 */
import { app } from "../state";
import { altitudeFor, withObserverCopy, type SweObj } from "../engine";
import { fmtTime, mjdToDate, dateToMjd } from "../astro";
import { updateClock } from "./time";

const R2D = 180 / Math.PI;
const N = 144; // 10-minute samples over 24 h

interface Curve {
  v: number;
  start: number;
  alt: number[];
  sun: number[];
  best: { t: number; alt: number } | null;
  transit: { t: number; alt: number };
}

let cache: Curve | null = null;

/** Noon before the night that contains (or follows) mjd, local time. */
function noonBefore(mjd: number): number {
  const d = mjdToDate(mjd);
  if (d.getHours() < 12) d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return dateToMjd(d);
}

function compute(obj: SweObj, start: number): Curve {
  const sunObj = app.stel.getObj("NAME Sun");
  const alt: number[] = [], sun: number[] = [];
  withObserverCopy(app.stel, (o) => {
    for (let i = 0; i <= N; i++) {
      o.utc = start + i / N;
      alt.push(altitudeFor(app.stel, obj, o) * R2D);
      sun.push(sunObj ? altitudeFor(app.stel, sunObj, o) * R2D : -30);
    }
  });
  let best: Curve["best"] = null;
  let transit = { t: start, alt: -90 };
  for (let i = 0; i <= N; i++) {
    const t = start + i / N;
    if (alt[i] > transit.alt) transit = { t, alt: alt[i] };
    // Best: highest while the sky is properly dark (Sun below −12°).
    if (sun[i] < -12 && alt[i] > 0 && (!best || alt[i] > best.alt)) best = { t, alt: alt[i] };
  }
  return { v: obj.v, start, alt, sun, best, transit };
}

/** Text facts derived from the curve, for the card. */
export function graphFacts(): [string, string][] {
  if (!cache) return [];
  const rows: [string, string][] = [];
  rows.push(["Highest", `${fmtTime(cache.transit.t)}, ${Math.round(cache.transit.alt)}° up`]);
  rows.push(["Best tonight", cache.best ? `${fmtTime(cache.best.t)}, ${Math.round(cache.best.alt)}° up` : "Not up in a dark sky"]);
  return rows;
}

const bandColor = (sunAlt: number) =>
  sunAlt > 0 ? "rgba(70,140,170,.55)" : sunAlt > -6 ? "rgba(50,90,130,.5)" : sunAlt > -12 ? "rgba(35,55,95,.5)" : sunAlt > -18 ? "rgba(25,32,60,.5)" : "rgba(0,0,0,0)";

/** (Re)draw into `box` if the object or night changed; always move "now". */
export function renderAltGraph(box: HTMLElement, obj: SweObj) {
  const start = noonBefore(app.obs.utc);
  const W = 320, H = 120, top = 8, bottom = 18;
  const y = (alt: number) => top + ((90 - Math.max(-30, Math.min(90, alt))) / 120) * (H - top - bottom);
  const x = (t: number) => ((t - start) / 1) * W;
  if (!cache || cache.v !== obj.v || Math.abs(cache.start - start) > 1e-6 || !box.firstChild) {
    cache = compute(obj, start);
    const c = cache;
    let bands = "";
    for (let i = 0; i < N; i++) {
      const col = bandColor((c.sun[i] + c.sun[i + 1]) / 2);
      if (col.endsWith(",0)")) continue;
      bands += `<rect x="${(i / N) * W}" y="${top}" width="${W / N + 0.5}" height="${H - top - bottom}" fill="${col}"/>`;
    }
    const pts = c.alt.map((a, i) => `${((i / N) * W).toFixed(1)},${y(a).toFixed(1)}`).join(" ");
    const ticks = [0, 6, 12, 18, 24]
      .map((h) => `<text x="${(h / 24) * W}" y="${H - 4}" text-anchor="${h === 0 ? "start" : h === 24 ? "end" : "middle"}">${fmtTime(start + h / 24)}</text>`)
      .join("");
    const grid = [0, 30, 60].map((a) => `<line x1="0" x2="${W}" y1="${y(a)}" y2="${y(a)}" class="${a === 0 ? "hz" : "g"}"/><text x="${W - 2}" y="${y(a) - 2}" text-anchor="end" class="gl">${a}°</text>`).join("");
    const best = c.best ? `<circle cx="${x(c.best.t)}" cy="${y(c.best.alt)}" r="3.5" class="best"/>` : "";
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${bands}${grid}<polyline points="${pts}" class="curve"/>${best}<line class="now" y1="${top}" y2="${H - bottom}"/>${ticks}</svg>`;
    // Drag to scrub the time of day.
    const svg = box.querySelector("svg")!;
    const scrub = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      app.obs.utc = start + f;
      updateClock();
      moveNow(box, start);
    };
    svg.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      svg.setPointerCapture(e.pointerId);
      scrub(e);
    });
    svg.addEventListener("pointermove", (e) => {
      if (svg.hasPointerCapture(e.pointerId)) scrub(e);
    });
    svg.addEventListener("pointerup", (e) => e.stopPropagation());
  }
  moveNow(box, start);
}

function moveNow(box: HTMLElement, start: number) {
  const line = box.querySelector<SVGLineElement>(".now");
  if (!line) return;
  const xx = ((app.obs.utc - start) / 1) * 320;
  line.setAttribute("x1", String(xx));
  line.setAttribute("x2", String(xx));
}

export const resetAltGraph = () => {
  cache = null;
};
