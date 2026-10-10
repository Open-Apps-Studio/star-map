/**
 * Thin typed wrapper around Stellarium Web Engine (loaded as a global script,
 * `engine/stellarium-web-engine.js`, which defines `StelWebEngine`).
 *
 * Angles in the engine are radians. Time is MJD (UTC).
 */

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
        core.stars.addDataSource({ url: sky("stars") });
        core.skycultures.addDataSource({ url: sky("skycultures/western"), key: "western" });
        core.dsos.addDataSource({ url: sky("dso") });
        core.landscapes.addDataSource({ url: sky("landscapes/guereins"), key: "guereins" });
        core.milkyway.addDataSource({ url: sky("surveys/milkyway") });
        core.minor_planets.addDataSource({ url: sky("mpcorb.dat"), key: "mpc_asteroids" });
        core.planets.addDataSource({ url: sky("surveys/sso/moon"), key: "moon" });
        core.planets.addDataSource({ url: sky("surveys/sso/sun"), key: "sun" });
        core.planets.addDataSource({ url: sky("surveys/sso/moon"), key: "default" });
        core.comets.addDataSource({ url: sky("CometEls.txt"), key: "mpc_comets" });
        core.satellites.addDataSource({ url: sky("tle_satellite.jsonl.gz"), key: "jsonl/sat" });
        // The engine's built-in Noto Sans fonts are used. (An external TTF via
        // setFont used to crash: emscripten 6 defaults to a 64 KB stack; the
        // build now sets STACK_SIZE=5MB.)

        // Look of the first frame: real sky with atmosphere and ground,
        // constellation lines and names on, artwork faint.
        core.constellations.lines_visible = true;
        core.constellations.labels_visible = true;
        core.constellations.images_visible = true;
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

/** Azimuth/altitude (radians) of an object for the current observer. Az: N=0, E=+π/2. */
export function azAlt(stel: Stel, obj: SweObj): { az: number; alt: number } {
  const obs = stel.observer;
  const observed = stel.convertFrame(obs, "ICRF", "OBSERVED", obj.getInfo("radec"));
  const [az, alt] = stel.c2s(observed);
  return { az: stel.anp(az), alt: stel.anpm(alt) };
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
function prettyDesignation(d: string): string {
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
