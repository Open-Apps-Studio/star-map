/**
 * World → screen: where an ICRF direction lands on screen (CSS px), using the
 * engine's VIEW frame and its stereographic projection (fov spans the short
 * side). Verified against the engine's own rendering.
 */
import { app } from "./state";

export function project(icrf: number[]): { x: number; y: number; onScreen: boolean } | null {
  const v = app.stel.convertFrame(app.obs, "ICRF", "VIEW", icrf);
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!l) return null;
  const x = v[0] / l, y = v[1] / l, z = v[2] / l;
  const theta = Math.acos(Math.max(-1, Math.min(1, -z)));
  if (theta > Math.PI * 0.95) return null; // behind us
  const short = Math.min(window.innerWidth, window.innerHeight);
  const r = ((short / 2) * Math.tan(theta / 2)) / Math.tan((app.core.fov as number) / 4);
  const n = Math.hypot(x, y) || 1;
  const sx = window.innerWidth / 2 + (r * x) / n, sy = window.innerHeight / 2 - (r * y) / n;
  return { x: sx, y: sy, onScreen: sx > -40 && sy > -40 && sx < window.innerWidth + 40 && sy < window.innerHeight + 40 };
}
