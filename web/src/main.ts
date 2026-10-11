/**
 * Star Map sky page: boots Stellarium Web Engine full screen and adds a
 * Stellarium Mobile style UI around it (layers, time, search, object card,
 * pointing mode, menu). Each piece lives in ./ui.
 */
import "./style.css";
import { abs, azAlt, bootEngine, D2R, knownNames, type SweObj } from "./engine";
import { buildCatalog, isResolved, resolve } from "./catalog";
import { dateToMjd } from "./astro";
import { inApp, listen, post } from "./bridge";
import { $, app, openPanel, planet, toast } from "./state";
import { initLayers } from "./ui/layers";
import { initTime, updateClock } from "./ui/time";
import { initCard, onUnlock, showCard, updateFacts } from "./ui/card";
import { initPointer, sensors, updatePointer } from "./ui/pointer";
import { initSearch } from "./ui/search";
import { initMenu } from "./ui/menu";

// ---------------------------------------------------------------- location
const FALLBACK = { lat: 41.0082, lon: 28.9784, alt: 40 }; // Istanbul

function setLocation(lat: number, lon: number, alt = 0) {
  app.obs.latitude = lat * D2R;
  app.obs.longitude = lon * D2R;
  app.obs.elevation = alt;
  try {
    localStorage.setItem("loc", JSON.stringify({ lat, lon, alt }));
  } catch {
    /* private mode */
  }
}

function initLocation() {
  let saved = FALLBACK;
  try {
    saved = JSON.parse(localStorage.getItem("loc") ?? "null") ?? FALLBACK;
  } catch {
    /* ignore */
  }
  setLocation(saved.lat, saved.lon, saved.alt);
  if (!inApp() && "geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (p) => setLocation(p.coords.latitude, p.coords.longitude, p.coords.altitude ?? 0),
      () => {},
      { timeout: 10000, maximumAge: 3600_000 },
    );
  }
}

// ---------------------------------------------------------------- first view
/** Open facing the brightest planet that's up (else south), horizon low. */
function faceBestTarget() {
  let best: { az: number; mag: number } | null = null;
  for (const n of ["Moon", "Venus", "Jupiter", "Mars", "Saturn", "Mercury"]) {
    const o = planet(n);
    if (!o) continue;
    const { az, alt } = azAlt(app.stel, o);
    if (alt < 10 * D2R) continue;
    const mag = o.getInfo("vmag") as number;
    if (!best || mag < best.mag) best = { az, mag };
  }
  const portrait = window.innerHeight > window.innerWidth;
  app.core.fov = (portrait ? 75 : 100) * D2R;
  app.obs.yaw = best ? best.az : Math.PI;
  app.obs.pitch = (portrait ? 42 : 30) * D2R;
}

/** Resolve catalog stars in the background so taps show proper names. */
function prefetchStarNames(round = 0) {
  let missing = 0;
  for (const e of app.catalog) {
    if (e.kind !== "star" || isResolved(e)) continue;
    const o = resolve(app.stel, e);
    if (!o) {
      missing++;
      continue;
    }
    const first = o.designations()[0];
    if (first && !knownNames.has(first)) knownNames.set(first, e.name);
  }
  if (missing && round < 20) setTimeout(() => prefetchStarNames(round + 1), 500);
}

// ---------------------------------------------------------------- recovery
/**
 * Report page errors to the native shell (it writes them to the device log),
 * so a sky that dies on someone's phone leaves a trace.
 */
function reportErrors() {
  const send = (text: string) => post({ type: "log", text: text.slice(0, 2000) });
  window.addEventListener("error", (e) => send(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => send(`unhandled: ${String(e.reason?.stack ?? e.reason)}`));
}

const RESUME_KEY = "resume";

/**
 * iOS drops the WebGL context under memory pressure or after a long time in
 * the background, and the engine can't rebuild its GPU state. Save the view
 * and reload, so the user comes back to the same sky instead of a black one.
 */
function reloadKeepingView() {
  try {
    sessionStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        yaw: app.obs.yaw, pitch: app.obs.pitch, fov: app.core.fov,
        utc: app.obs.utc, speed: app.core.time_speed, savedAt: Date.now(),
      }),
    );
  } catch {
    /* storage unavailable: a fresh start is still better than a black sky */
  }
  location.reload();
}

/** Restore the view saved by reloadKeepingView. Returns false if there's none. */
function resumeView(): boolean {
  let s: { yaw: number; pitch: number; fov: number; utc: number; speed: number; savedAt: number } | null = null;
  try {
    s = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null");
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    return false;
  }
  if (!s || Date.now() - s.savedAt > 10 * 60_000) return false;
  app.obs.yaw = s.yaw;
  app.obs.pitch = s.pitch;
  app.core.fov = s.fov;
  // Live time stays live; a time the user travelled to is kept.
  const live = Math.abs(s.utc + (Date.now() - s.savedAt) / 86400000 - dateToMjd(new Date())) < 2 / 1440 && s.speed === 1;
  if (!live) {
    app.obs.utc = s.utc;
    app.core.time_speed = s.speed;
  }
  return true;
}

// ---------------------------------------------------------------- frame loop
let lastSlow = 0;
function frame(t: number) {
  updatePointer();
  if (t - lastSlow > 250) {
    lastSlow = t;
    updateClock();
    updateFacts();
    onUnlock();
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
async function main() {
  reportErrors();
  const canvas = $<HTMLCanvasElement>("stel-canvas");
  try {
    app.stel = await bootEngine(canvas);
  } catch (e) {
    $("loading").innerHTML = `<div class="caption">This device can't run the sky engine.</div>`;
    throw e;
  }
  app.core = app.stel.core;
  app.obs = app.stel.observer ?? app.core.observer;
  (window as any).stel = app.stel; // handy in the inspector
  const M = app.stel as any;
  M.onContextLost = reloadKeepingView;
  M.onFrameError = (e: unknown) => {
    if (M.frameErrors === 1) post({ type: "log", text: `frame error: ${String((e as Error)?.stack ?? e)}` });
  };
  app.obs.utc = dateToMjd(new Date());
  initLocation();

  initLayers();
  initTime();
  initCard();
  initPointer();
  initSearch();
  initMenu();

  // Tapping the sky closes any open panel (the engine handles selection).
  canvas.addEventListener("pointerdown", () => openPanel(null), { capture: true });

  // Listen to core.selection only: a catch-all listener makes the engine
  // build a JS wrapper on every attribute change (each pinch/clock frame).
  app.core.change("selection", () => {
    const sel = app.core.selection as SweObj | null;
    showCard(sel && sel.v ? sel : null);
  });

  listen((msg) => {
    if (msg.type === "motion") sensors.pushNativeMatrix(msg.m);
    if (msg.type === "location") setLocation(msg.lat, msg.lon, msg.alt ?? 0);
    if (msg.type === "calibrate") toast("Compass needs calibrating: wave your phone in a figure-8");
    if (msg.type === "north" && msg.magnetic) toast("Allow location for accurate north");
    if (msg.type === "caps") app.motion = msg.motion;
  });

  if (!resumeView()) faceBestTarget();
  requestAnimationFrame(frame);
  document.body.classList.add("ready");
  post({ type: "ready" });

  app.catalog = await buildCatalog(abs("skydata/"));
  prefetchStarNames();
}

main();
