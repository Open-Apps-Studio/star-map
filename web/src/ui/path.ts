/**
 * Sky path (Sky Tonight's "trajectories"): where an object travels across
 * your sky tonight, drawn as an arc with a dot and label every hour. The arc
 * is fixed to the horizon (computed in the OBSERVED frame), so it stays put
 * while the stars wheel along it. The Sun gets its daytime arc instead.
 */
import { $, app, planet } from "../state";
import { displayName, withObserverCopy, type SweObj } from "../engine";
import { mjdToDate } from "../astro";
import { nightOf } from "../events";

interface Pt {
  v: number[];
  t: number;
  hour: boolean;
  up: boolean;
}

let path: { obj: SweObj; pts: Pt[] } | null = null;
const NS = "http://www.w3.org/2000/svg";

export const pathShown = (obj: SweObj | null) => !!path && !!obj && path.obj === obj;

export function togglePath(obj: SweObj) {
  if (pathShown(obj)) return hidePath();
  const sun = planet("Sun");
  const isSun = !!sun && displayName(obj) === "Sun";
  const night = nightOf(app.obs.utc);
  // Night: an hour either side of the dark. Sun: sunrise to sunset.
  const [from, to] = isSun ? [night.sunset - 1 + 1 / 24, night.sunrise - 1 / 24] : [night.sunset - 1 / 24, night.sunrise + 1 / 24];
  const pts: Pt[] = [];
  withObserverCopy(app.stel, (o) => {
    // Every 15 min from the hour before `from`, so samples land on the hour.
    const start = Math.floor(from * 24) / 24;
    for (let i = 0; start + i / 96 <= to + 1e-9; i++) {
      const t = start + i / 96;
      o.utc = t;
      const v = app.stel.convertFrame(o, "ICRF", "OBSERVED", obj.getInfo("radec", o));
      const hourMark = i % 4 === 0;
      const alt = Math.asin(Math.max(-1, Math.min(1, v[2] / Math.hypot(v[0], v[1], v[2]))));
      pts.push({ v, t, hour: hourMark, up: alt > 0 });
    }
  });
  path = { obj, pts };
  // SVG elements have no .hidden property, so use the attribute.
  $("path-layer").removeAttribute("hidden");
  drawPath();
}

export function hidePath() {
  path = null;
  const svg = $("path-layer");
  svg.setAttribute("hidden", "");
  svg.innerHTML = "";
}

/** OBSERVED direction → screen (CSS px), engine's stereographic projection. */
function toScreen(observed: number[]) {
  const v = app.stel.convertFrame(app.obs, "OBSERVED", "VIEW", observed);
  const l = Math.hypot(v[0], v[1], v[2]);
  const x = v[0] / l, y = v[1] / l, z = v[2] / l;
  const theta = Math.acos(Math.max(-1, Math.min(1, -z)));
  if (theta > Math.PI * 0.9) return null;
  const short = Math.min(window.innerWidth, window.innerHeight);
  const r = ((short / 2) * Math.tan(theta / 2)) / Math.tan((app.core.fov as number) / 4);
  const n = Math.hypot(x, y) || 1;
  return { x: window.innerWidth / 2 + (r * x) / n, y: window.innerHeight / 2 - (r * y) / n };
}

const hourLabel = (t: number) => mjdToDate(t + 1 / 2880).toLocaleTimeString([], { hour: "numeric" });

/** Per frame while shown: re-project (cheap: ~60 points). */
export function drawPath() {
  if (!path) return;
  const svg = $("path-layer");
  const parts: string[] = [];
  let seg: string[] = [];
  let segUp = true;
  const flush = () => {
    if (seg.length > 1) parts.push(`<polyline points="${seg.join(" ")}" class="${segUp ? "up" : "down"}"/>`);
    seg = [];
  };
  const marks: string[] = [];
  let prev: { x: number; y: number } | null = null;
  for (const p of path.pts) {
    const s = toScreen(p.v);
    // Break the line off screen-wrap jumps and where it crosses the horizon.
    if (!s || (prev && Math.hypot(s.x - prev.x, s.y - prev.y) > window.innerWidth)) {
      flush();
      prev = s;
      continue;
    }
    if (p.up !== segUp) {
      seg.push(`${s.x.toFixed(1)},${s.y.toFixed(1)}`);
      flush();
      segUp = p.up;
    }
    seg.push(`${s.x.toFixed(1)},${s.y.toFixed(1)}`);
    if (p.hour && p.up) marks.push(`<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="3"/><text x="${(s.x + 7).toFixed(1)}" y="${(s.y + 4).toFixed(1)}">${hourLabel(p.t)}</text>`);
    prev = s;
  }
  flush();
  svg.innerHTML = parts.join("") + marks.join("");
}

/** Where the object would be now, for clearing the path when it's deselected. */
export const pathObject = () => path?.obj ?? null;
