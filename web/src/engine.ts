/**
 * Thin typed wrapper around Stellarium Web Engine (loaded as a global script,
 * `engine/stellarium-web-engine.js`, which defines `StelWebEngine`).
 *
 * Angles in the engine are radians. Time is MJD (UTC).
 */
import { satelliteSource } from "./satellites";

/** A sky object handle returned by the engine (star, planet, DSO, constellation…). */
export interface SweObj {
  designations(): string[];
  culturalDesignations?(): { name_english?: string; name_native?: string }[];
  getInfo(attr: string, observer?: unknown): any;
  computeVisibility(args?: { obs?: unknown; startTime?: number; endTime?: number }): { rise: number | null; set: number | null }[];
  jsonData?: any;
  type?: string;
  model?: string;
  v: number;
}

export interface Stel {
  core: any;
  observer: any;
  getObj(id: string): SweObj | null;
  pointAndLock(obj: SweObj, duration?: number): void;
  lookAt(pos: number[], duration?: number): void;
  zoomTo(fov: number, duration?: number): void;
  convertFrame(obs: unknown, from: string, to: string, v: number[]): number[];
  c2s(v: number[]): [number, number];
  s2c(theta: number, phi: number): number[];
  anp(a: number): number;
  anpm(a: number): number;
  otypeToStr(otype: string): string;
  change(cb: (obj: unknown, attr: string) => void): void;
  setFont(name: string, url: string, scale: number): void;
  date2MJD(ms: number): number;
  MJD2date(mjd: number): number;
  on(event: string, cb: (e: any) => unknown): void;
}

declare global {
  // eslint-disable-next-line no-var
  var StelWebEngine: (opts: {
    wasmFile: string;
    canvas: HTMLCanvasElement;
    translateFn: (domain: string, str: string) => string;
    onReady: (stel: Stel) => void;
  }) => void;
}

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

/** Absolute URL for a path next to the page (the engine can't resolve relative URLs). */
export const abs = (path: string) => new URL(path, document.baseURI).href;

/** Boot the engine on `canvas` and attach the bundled offline sky data. */
export function bootEngine(canvas: HTMLCanvasElement): Promise<Stel> {
  return new Promise((resolve, reject) => {
    if (typeof StelWebEngine !== "function") {
      reject(new Error("Engine script missing"));
      return;
    }
    StelWebEngine({
      // Ignored: the wasm is embedded in the engine script (SINGLE_FILE build).
      wasmFile: abs("engine/stellarium-web-engine.wasm"),
      canvas,
      translateFn: (_domain, str) => str,
      onReady: (stel) => {
        const core = stel.core;
        const sky = (p: string) => abs("skydata/" + p);
        // Offline packs (Stellarium Mobile's own): stars to mag 8, bright DSOs.
        core.stars.addDataSource({ url: sky("stars/minimal"), key: "minimal" });
        core.stars.addDataSource({ url: sky("stars/base"), key: "base" });
        core.dsos.addDataSource({ url: sky("dsos/base"), key: "base" });
        core.milkyway.addDataSource({ url: sky("surveys/milkyway") });
        core.minor_planets.addDataSource({ url: sky("mpcorb.dat"), key: "mpc_asteroids" });
        core.planets.addDataSource({ url: sky("surveys/sso/moon"), key: "moon" });
        core.planets.addDataSource({ url: sky("surveys/sso/sun"), key: "sun" });
        core.comets.addDataSource({ url: sky("CometEls.txt"), key: "mpc_comets" });
        // Planet surfaces (our own HiPS from CC BY 4.0 maps; Saturn's rings
        // texture ships with the engine).
        for (const p of ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"]) {
          core.planets.addDataSource({ url: sky("planets/" + p), key: p });
        }
        // Satellites: today's orbits from CelesTrak when online (see satellites.ts).
        satelliteSource(sky("tle_satellite.jsonl.gz")).then((s) => {
          core.satellites.addDataSource({ url: s.url, key: "jsonl/sat" });
          console.info(`satellites: ${s.fresh ? "fresh" : "stale"} (${s.ageHours == null ? "bundled" : s.ageHours.toFixed(1) + " h old"})`);
        });
        // The engine's built-in Noto Sans fonts are used. (An external TTF via
        // setFont used to crash: emscripten 6 defaults to a 64 KB stack; the
        // build now sets STACK_SIZE=5MB.)

        // Look of the first frame: real sky with atmosphere and ground,
        // constellation lines and names on, artwork faint.
        core.constellations.lines_visible = true;
        core.constellations.labels_visible = true;
        core.constellations.images_visible = true;
        // Every constellation, not just the one in the middle of the screen
        // (the engine's default), like Stellarium Mobile and Sky Guide; the
        // artwork a bit fainter so it doesn't bury the stars.
        core.constellations.show_only_pointed = false;
        core.constellations.illustrations_bscale = 0.55;
        core.atmosphere.visible = true;
        core.landscapes.visible = true;
        core.dsos.visible = true;
        core.milkyway.visible = true;
        core.fov = 100 * D2R;
        core.observer.pitch = 25 * D2R;
        core.time_speed = 1;
        resolve(stel);
      },
    });
  });
}

// ---------------------------------------------------------------- sky data
/** Stellarium's public data CDN (what stellarium-web.org streams from). */
const CDN = "https://stellarium.sfo2.cdn.digitaloceanspaces.com";
const LIBSWE = CDN + "/stellarium-web/libswe-1.17.0";

/**
 * Can we read the CDN? navigator.onLine is often wrong, and inside the app
 * this also proves the WebView may read cross-origin data. Resolves to the
 * HTTP status (0 = unreachable).
 */
export function probeCdn(): Promise<number> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("GET", CDN + "/surveys/gaia/v3/properties");
    x.timeout = 8000;
    x.onload = () => resolve(x.status);
    x.onerror = x.ontimeout = () => resolve(0);
    x.send();
  });
}

let onlineAdded = false;
/**
 * Deep catalogues, streamed and HTTP-cached once online: stars to mag 12
 * (Stellarium Mobile's extended pack) then Gaia DR3 to mag ~20, the extended
 * DSO catalogue, DSS colour photos of the whole sky, and sharper Moon and
 * planet surfaces. The app's WebView loads the page from file:// with
 * universal access, which is what lets it read the CDN.
 */
export function addOnlineSources(stel: Stel) {
  if (onlineAdded) return;
  onlineAdded = true;
  const core = stel.core;
  core.stars.addDataSource({ url: LIBSWE + "/asset_pack_extended/stars", key: "extended" });
  core.stars.addDataSource({ url: CDN + "/surveys/gaia/v3", key: "gaia" });
  core.dsos.addDataSource({ url: LIBSWE + "/asset_pack_extended/dso", key: "extended" });
  core.dss.addDataSource({ url: CDN + "/surveys/dss/v1" });
  core.planets.addDataSource({ url: CDN + "/surveys/sso/moon/v1", key: "moon" });
}

const requested = { skycultures: new Set<string>(), landscapes: new Set<string>() };

/**
 * Switch to a bundled module child (sky culture / landscape), adding its data
 * source the first time and waiting for it to load before selecting it.
 */
function loadChild(module: "skycultures" | "landscapes", id: string, url: string) {
  const mod = (globalThis as any).stel?.core?.[module];
  if (!mod || mod.current_id === id) return;
  if (!requested[module].has(id)) {
    requested[module].add(id);
    mod.addDataSource({ url, key: id });
  }
  // The engine ignores current_id until the data has loaded, so keep
  // asking until it sticks (or give up after ~10 s, e.g. a missing folder).
  let tries = 0;
  const pick = () => {
    mod.current_id = id;
    if (mod.current_id !== id && ++tries < 100) setTimeout(pick, 100);
  };
  pick();
}

export function loadSkyCulture(id: string) {
  loadChild("skycultures", id, abs("skydata/skycultures/" + id));
}

export function loadLandscape(id: string) {
  loadChild("landscapes", id, abs("skydata/landscapes/" + id));
}

/** Azimuth/altitude (radians) of an object for the current observer. Az: N=0, E=+π/2. */
export function azAlt(stel: Stel, obj: SweObj): { az: number; alt: number } {
  const obs = stel.observer;
  const observed = stel.convertFrame(obs, "ICRF", "OBSERVED", obj.getInfo("radec"));
  const [az, alt] = stel.c2s(observed);
  return { az: stel.anp(az), alt: stel.anpm(alt) };
}

/**
 * Run `fn` with a scratch copy of the observer (same place, settable time),
 * so time-sampling maths never touches the live view. Released afterwards.
 */
export function withObserverCopy<T>(stel: Stel, fn: (obs: any) => T): T {
  const copy = (stel.observer as any).clone();
  try {
    return fn(copy);
  } finally {
    copy.destroy?.();
  }
}

/** Altitude (radians) of `obj` for an observer at its own time. */
/** Recompute an observer after changing its time (getInfo does this itself; convertFrame doesn't). */
export function updateObserver(stel: Stel, obs: any) {
  (stel as any)._observer_update(obs.v, true);
}

export function altitudeFor(stel: Stel, obj: SweObj, obs: any): number {
  const p = stel.convertFrame(obs, "ICRF", "OBSERVED", obj.getInfo("radec", obs));
  return stel.anpm(stel.c2s(p)[1]);
}

/** Right ascension / declination (radians, of date) for rise/set maths. */
export function raDec(stel: Stel, obj: SweObj): { ra: number; dec: number } {
  const obs = stel.observer;
  const cirs = stel.convertFrame(obs, "ICRF", "CIRS", obj.getInfo("radec"));
  const [ra, dec] = stel.c2s(cirs);
  return { ra: stel.anp(ra), dec: stel.anpm(dec) };
}

/**
 * Look up a star by Hipparcos number. Unlike getObj, this loads the star's sky
 * tile on demand, so it works for stars that aren't on screen yet. Returns
 * null while the tile is still loading (call again shortly).
 */
export function starByHip(stel: Stel, hip: number): SweObj | null {
  const M = stel as any;
  if (typeof M._obj_get_by_hip !== "function") return null;
  const codePtr = M._malloc(4);
  try {
    const ptr = M._obj_get_by_hip(hip, codePtr);
    return ptr ? (new M.SweObj(ptr) as SweObj) : null;
  } finally {
    M._free(codePtr);
  }
}

const GREEK: Record<string, string> = {
  alf: "α", bet: "β", gam: "γ", del: "δ", eps: "ε", zet: "ζ", eta: "η", tet: "θ", iot: "ι", kap: "κ", lam: "λ", mu: "μ",
  nu: "ν", xi: "ξ", omi: "ο", pi: "π", rho: "ρ", sig: "σ", tau: "τ", ups: "υ", phi: "φ", chi: "χ", psi: "ψ", ome: "ω",
};
/** "* alf01 Cru" → "α¹ Cru", "* 61 Cyg" → "61 Cyg". */
export function prettyDesignation(d: string): string {
  return d.replace(/^\* /, "").replace(/^([a-z]{2,3})(\d{0,2})(?= )/, (_m, g: string, n: string) => {
    const sup = n ? String(Number(n)).replace(/\d/g, (c) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(c)]) : "";
    return (GREEK[g] ?? g) + sup;
  });
}

/** Names we already know from search (designation → friendly name). */
export const knownNames = new Map<string, string>();

/** Clean display name: "NAME Saturn" → "Saturn", "CON western Ori" → "Orion". */
export function displayName(obj: SweObj): string {
  const first = obj.designations()[0];
  const known = first && knownNames.get(first);
  if (known) return known;
  try {
    const cultural = obj.culturalDesignations?.();
    if (cultural && cultural.length) {
      const c = cultural[0];
      if (c.name_english) return c.name_english;
      if (c.name_native) return c.name_native;
    }
  } catch {
    /* not every object type supports cultural names */
  }
  const names = obj.designations();
  const named = names.find((n) => n.startsWith("NAME "));
  const raw = named ?? names[0] ?? "Unknown";
  return prettyDesignation(raw.replace(/^NAME /, "").replace(/^CON western /, ""));
}
