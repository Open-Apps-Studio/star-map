/**
 * Ocular overlay (Stellarium Mobile Plus's "Display ocular"): shows what an
 * eyepiece, camera, binoculars or Telrad would frame, drawn over the sky at
 * the true angular size. Eyepieces and binoculars black out everything
 * outside their circle, like looking through them.
 */
import { $, app } from "./state";
import type { Ocular } from "./settings";

const D2R = Math.PI / 180;

export interface OcularView {
  /** Field of view, degrees (width, height; equal for circles). */
  fovW: number;
  fovH: number;
  circle: boolean;
  /** Text facts: magnification, exit pupil, faintest stars… */
  facts: string[];
  /** Telrad rings, degrees. */
  rings?: number[];
}

/** Optics maths for one instrument. */
export function ocularView(o: Ocular): OcularView {
  switch (o.kind) {
    case "eyepiece": {
      const mag = o.scopeFocal / o.epFocal;
      const tfov = o.epAfov / mag;
      const pupil = o.scopeAperture / mag;
      // Visual limiting magnitude through a telescope (rule of thumb).
      const lim = 2.7 + 5 * Math.log10(o.scopeAperture);
      return {
        fovW: tfov, fovH: tfov, circle: true,
        facts: [`${Math.round(mag)}×`, `${fmtAngle(tfov)} field`, `exit pupil ${pupil.toFixed(1)} mm`, `stars to mag ${lim.toFixed(1)}`],
      };
    }
    case "camera": {
      const w = 2 * Math.atan(o.sensorW / (2 * o.scopeFocal)) / D2R;
      const h = 2 * Math.atan(o.sensorH / (2 * o.scopeFocal)) / D2R;
      return { fovW: w, fovH: h, circle: false, facts: [`${fmtAngle(w)} × ${fmtAngle(h)}`, `f/${(o.scopeFocal / o.scopeAperture).toFixed(1)}`] };
    }
    case "binoculars":
      return { fovW: o.binoFov, fovH: o.binoFov, circle: true, facts: [`${o.binoMag}×${o.scopeAperture}`, `${fmtAngle(o.binoFov)} field`] };
    case "telrad":
    default:
      return { fovW: 4, fovH: 4, circle: false, rings: [0.5, 2, 4], facts: ["Telrad rings: 0.5°, 2°, 4°"] };
  }
}

export function fmtAngle(deg: number): string {
  if (deg >= 1) return `${deg.toFixed(deg >= 10 ? 0 : 1)}°`;
  const m = deg * 60;
  return m >= 1 ? `${m.toFixed(m >= 10 ? 0 : 1)}′` : `${Math.round(m * 60)}″`;
}

let active: { o: Ocular; v: OcularView } | null = null;
export const activeOcular = () => active?.o ?? null;

/**
 * Screen radius (CSS px) of an angle from the view centre. The engine's fov
 * spans the screen's short side, with a stereographic projection.
 */
function radiusPx(angleDeg: number): number {
  const short = Math.min(window.innerWidth, window.innerHeight);
  const fov = app.core.fov as number;
  return (short / 2) * (Math.tan((angleDeg * D2R) / 2) / Math.tan(fov / 4));
}

/** Show an instrument's view (or null to stop). Zooms so it fills the screen. */
export function setOcular(o: Ocular | null) {
  active = o ? { o, v: ocularView(o) } : null;
  $("ocular").hidden = !active;
  document.body.classList.toggle("ocular-on", !!active);
  if (!active) return;
  const v = active.v;
  $("ocular-name").textContent = o!.name;
  $("ocular-facts").textContent = v.facts.join(" · ");
  // Frame the field with a little margin around it.
  const span = Math.max(v.fovW, v.fovH) * (v.rings ? 1.6 : 1.25);
  app.stel.zoomTo(span * D2R, 0.8);
}

/** Per frame: size the mask, frame or rings for the current zoom. */
export function updateOcular() {
  if (!active) return;
  const v = active.v;
  const svg = $("ocular-svg") as unknown as SVGSVGElement;
  const w = window.innerWidth, h = window.innerHeight;
  const cx = w / 2, cy = h / 2;
  let html = "";
  if (v.rings) {
    for (const r of v.rings) html += `<circle cx="${cx}" cy="${cy}" r="${radiusPx(r / 2)}" class="oc-ring"/>`;
  } else if (v.circle) {
    const r = radiusPx(v.fovW / 2);
    // Everything outside the circle is the eyepiece's black field stop.
    html = `<path class="oc-mask" fill-rule="evenodd" d="M0 0H${w}V${h}H0Z M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z"/><circle cx="${cx}" cy="${cy}" r="${r}" class="oc-edge"/>`;
  } else {
    const rw = radiusPx(v.fovW / 2), rh = radiusPx(v.fovH / 2);
    html = `<rect x="${cx - rw}" y="${cy - rh}" width="${2 * rw}" height="${2 * rh}" class="oc-frame"/>`;
  }
  if (svg.dataset.last !== html) {
    svg.innerHTML = html;
    svg.dataset.last = html;
  }
}
