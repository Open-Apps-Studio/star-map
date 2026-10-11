/**
 * Pointing mode (Stellarium Mobile's gyroscope mode): the phone's orientation
 * drives the view. On screen: a large ring with the current altitude, and a
 * triangle outside it pointing at the object you asked to find. When it's
 * inside the ring the ring lights up, the phone taps and the card opens.
 */
import { onPointingChanged } from "../ar";
import { $, app, haptic, planet, toast } from "../state";
import { icon, MDI } from "../icons";
import { createSensors, type Vec3 } from "../sensors";
import { azAlt, displayName, type SweObj } from "../engine";
import { inApp, post } from "../bridge";

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Last view pushed from the sensors (avoids reading it back from the engine). */
let lastView: { yaw: number; pitch: number; roll: number } | null = null;

export const sensors = createSensors((v) => {
  app.obs.yaw = v.yaw;
  app.obs.pitch = v.pitch;
  app.obs.roll = v.roll;
  lastView = v;
});

let target: SweObj | null = null;
let lockedAt = 0;

const enu = (az: number, alt: number): Vec3 => [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Camera basis from the engine's yaw/pitch/roll. */
function basis() {
  const v = lastView ?? { yaw: app.obs.yaw as number, pitch: app.obs.pitch as number, roll: (app.obs.roll as number) || 0 };
  const y = v.yaw, p = v.pitch, r = v.roll;
  const forward = enu(y, p);
  const refUp: Vec3 = [-Math.sin(p) * Math.sin(y), -Math.sin(p) * Math.cos(y), Math.cos(p)];
  const refRight: Vec3 = [Math.cos(y), -Math.sin(y), 0];
  const up = [0, 1, 2].map((i) => Math.cos(r) * refUp[i] + Math.sin(r) * refRight[i]) as Vec3;
  const right = [0, 1, 2].map((i) => Math.cos(r) * refRight[i] - Math.sin(r) * refUp[i]) as Vec3;
  return { forward, up, right };
}

export function startGuide(obj: SweObj) {
  target = obj;
  lockedAt = 0;
  app.core.selection = 0;
  toast(`Move your phone to find ${displayName(obj)}`);
}

export async function setPointing(on: boolean) {
  if (on) {
    if (inApp() && app.motion === false) {
      toast("This device has no motion sensor, so pointing mode isn't available.");
      return;
    }
    const ok = await sensors.start(inApp());
    if (!ok) {
      toast("Motion access is off. Allow it in Settings to use pointing mode.");
      return;
    }
    app.core.lock = 0;
    app.obs.view_offset_alt = 0;
    lastView = null;
    // A comfortable "window" zoom if the user was zoomed far out.
    if ((app.core.fov as number) > 100 * D2R) app.stel.zoomTo(70 * D2R, 0.6);
  } else {
    sensors.stop();
    $("sun-warning").hidden = true;
    app.obs.roll = 0;
    target = null;
  }
  app.pointing = on;
  $("pointer").hidden = !on;
  $("sensor-btn").setAttribute("aria-pressed", String(on));
  post({ type: "sensor-mode", on });
  onPointingChanged(on);
  haptic("light");
}

/** Per-frame update while pointing. Pure transforms, no layout reads. */
export function updatePointer() {
  if (!app.pointing) return;
  if (!lastView) return;
  sunWarning();
  $("pointer-alt").textContent = `${Math.round(lastView.pitch * R2D)}°`;
  const pointer = $("pointer");
  const tri = $("pointer-tri") as unknown as SVGElement;
  if (!target) {
    pointer.classList.remove("locked");
    tri.style.display = "none";
    return;
  }
  const { az, alt } = azAlt(app.stel, target);
  const t = enu(az, alt);
  const b = basis();
  const x = dot(t, b.right), y = dot(t, b.up), z = dot(t, b.forward);
  const off = Math.acos(Math.max(-1, Math.min(1, z))) * R2D;
  // Lock under 3°, release over 6°.
  const locked = lockedAt ? off < 6 : off < 3;
  pointer.classList.toggle("locked", locked);
  if (locked && !lockedAt) {
    lockedAt = Date.now();
    haptic("success");
    app.core.selection = target;
  } else if (!locked) {
    lockedAt = 0;
  }
  // Inline display wins over the stylesheet's .locked rule, so set it here.
  tri.style.display = locked ? "none" : "block";
  if (locked) return;
  // Sit the triangle just outside the ring, pointing at the target.
  const ang = Math.atan2(-y, x);
  const rad = 0.26 * window.innerWidth + 0.1 * window.innerWidth;
  tri.style.transform = `translate(${Math.cos(ang) * rad}px, ${Math.sin(ang) * rad}px) rotate(${ang * R2D}deg)`;
}

/** Sun up and within 20° of where the phone points: warn (Night Sky does this too). */
let sunFrame = 0;
function sunWarning() {
  if (sunFrame++ % 10) return; // a few times a second is plenty
  const sun = planet("Sun");
  let near = false;
  if (sun) {
    const { az, alt } = azAlt(app.stel, sun);
    if (alt > -1 * D2R) near = Math.acos(Math.max(-1, Math.min(1, dot(enu(az, alt), basis().forward)))) < 20 * D2R;
  }
  const w = $("sun-warning");
  if (w.hidden === near) {
    w.hidden = !near;
    if (near) haptic("medium");
  }
}

export const guideTarget = () => target;
export const clearGuide = () => {
  target = null;
};

export function initPointer() {
  $("sensor-btn").innerHTML = icon(MDI.mdiCompassOutline);
  $("sensor-btn").addEventListener("click", () => setPointing(!app.pointing));
  // While the phone drives the view, finger drags would fight it: swallow
  // moves before the engine sees them, but let taps through.
  const canvas = $("stel-canvas");
  for (const ev of ["touchmove", "mousemove", "mousewheel"]) {
    canvas.addEventListener(ev, (e) => {
      if (app.pointing) e.stopImmediatePropagation();
    }, { capture: true });
  }
}
