/**
 * AR mode (Sky Guide / Star Walk / Night Sky): the phone's camera behind the
 * sky while pointing mode drives the view. The app shell puts a native camera
 * preview under a see-through WebView; here we clear the engine's canvas to
 * transparent (engine patch: render_set_transparent) and hide whatever would
 * cover the camera: the painted atmosphere, the ground panorama, the Milky
 * Way glow and sky photos. Everything else (stars, lines, labels) adds light
 * over the camera picture, like a heads-up display.
 */
import { inApp, post } from "./bridge";
import { $, app, haptic, toast } from "./state";
import { icon, MDI } from "./icons";
import { setPointing } from "./ui/pointer";

let on = false;
let saved: { atmosphere: boolean; landscape: boolean; milkyway: boolean; dss: boolean; fog: boolean } | null = null;

export const arOn = () => on;

function setTransparent(v: boolean) {
  const M = app.stel as any;
  if (typeof M._render_set_transparent === "function") M._render_set_transparent(v ? 1 : 0);
}

/** Ask the shell for the camera (it answers with camera-state). */
export async function toggleAr() {
  if (!inApp()) return toast("AR mode works in the Star Map app");
  if (!on && !app.pointing) {
    await setPointing(true);
    if (!app.pointing) return;
  }
  haptic("light");
  post({ type: "camera", on: !on });
}

/** The camera is live (or stopped, or not allowed). */
export function onCameraState(live: boolean, denied = false) {
  if (denied) toast("Camera access is off. Allow it in Settings to see the sky over your camera.", 4500);
  if (live === on) return;
  on = live;
  const c = app.core;
  if (live) {
    saved = { atmosphere: c.atmosphere.visible, landscape: c.landscapes.visible, milkyway: c.milkyway.visible, dss: c.dss.visible, fog: c.landscapes.fog_visible };
    c.atmosphere.visible = false;
    c.landscapes.visible = false;
    c.milkyway.visible = false;
    c.dss.visible = false;
    c.landscapes.fog_visible = false;
  } else if (saved) {
    c.atmosphere.visible = saved.atmosphere;
    c.landscapes.visible = saved.landscape;
    c.milkyway.visible = saved.milkyway;
    c.dss.visible = saved.dss;
    c.landscapes.fog_visible = saved.fog;
    saved = null;
  }
  setTransparent(live);
  document.body.classList.toggle("ar", live);
  $("ar-btn").setAttribute("aria-pressed", String(live));
}

/** Leaving pointing mode ends AR too. */
export function onPointingChanged(pointing: boolean) {
  $("ar-btn").hidden = !pointing || !inApp();
  if (!pointing && on) post({ type: "camera", on: false });
}

export function initAr() {
  const b = $("ar-btn");
  b.innerHTML = icon(MDI.mdiCamera);
  b.hidden = true;
  b.addEventListener("click", toggleAr);
}
