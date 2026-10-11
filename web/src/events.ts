/**
 * Observing calendar and tonight's planner, computed with the engine on a
 * scratch observer (Stellarium Mobile Plus's Observe › Tonight / Calendar):
 *
 *  - Moon phases, equinoxes and solstices, Earth's perihelion and aphelion
 *  - Conjunctions (Moon–planet, planet–planet), oppositions, greatest
 *    elongations of Mercury and Venus
 *  - Solar and lunar eclipses, and whether they're visible from here
 *  - Meteor shower peaks (IAU list) with the Moon's light that night
 *  - Visible satellite passes tonight (sunlit satellite, dark sky)
 *
 * Event times use geocentric positions (that's how phases, oppositions and
 * conjunctions are defined; topocentric parallax would shift Moon events by
 * up to two hours). Local circumstances (is it up, is it daylight, how much
 * of the Sun is covered) use the observer's real place.
 */
import { abs, altitudeFor, withObserverCopy, type SweObj } from "./engine";
import { app, planet } from "./state";
import { getJson } from "./catalog";

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const HOUR = 1 / 24;
const MIN = 1 / 1440;

export type EventKind = "moon" | "season" | "conjunction" | "opposition" | "elongation" | "eclipse" | "meteors" | "earth";

export interface SkyEvent {
  mjd: number;
  kind: EventKind;
  title: string;
  detail: string;
  /** Object to show when the event is tapped (engine designation). */
  target?: string;
  /** A whole night rather than a moment (meteor peaks): no clock time. */
  allNight?: boolean;
}

const PLANETS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];
const BRIGHT = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

// ---------------------------------------------------------------- vector maths
type V = number[];
const norm = (v: V): V => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const sep = (a: V, b: V) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const wrap360 = (d: number) => ((d % 360) + 360) % 360;
const wrap180 = (d: number) => wrap360(d + 180) - 180;

/** Position helper bound to one scratch observer. */
function sampler(o: any) {
  const dir = (obj: SweObj, mjd: number): V => {
    o.utc = mjd;
    return norm(obj.getInfo("radec", o) as V);
  };
  /** Ecliptic longitude (degrees) of a direction. */
  const eclLon = (v: V): number => {
    const e = app.stel.convertFrame(o, "ICRF", 8 as any, v);
    return wrap360(Math.atan2(e[1], e[0]) * R2D);
  };
  return { dir, eclLon };
}

/** Find t in [a, b] where f changes sign (f(a), f(b) of opposite sign). */
function bisect(f: (t: number) => number, a: number, b: number, tol = MIN): number {
  let fa = f(a);
  for (let i = 0; i < 40 && b - a > tol; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (Math.sign(fm) === Math.sign(fa)) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return (a + b) / 2;
}

/** Local minimum of f in [a, b] (golden section). */
function minimize(f: (t: number) => number, a: number, b: number, tol = MIN): number {
  const g = 0.381966;
  let x1 = a + g * (b - a), x2 = b - g * (b - a);
  let f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < 60 && b - a > tol; i++) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = a + g * (b - a);
      f1 = f(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = b - g * (b - a);
      f2 = f(x2);
    }
  }
  return (a + b) / 2;
}

/**
 * Times in [start, end) where angle(t) (degrees, wrapping) crosses `target`,
 * sampled every `step` days then refined.
 */
function crossings(angle: (t: number) => number, target: number, start: number, end: number, step: number): number[] {
  const out: number[] = [];
  const f = (t: number) => wrap180(angle(t) - target);
  let t0 = start, f0 = f(t0);
  for (let t1 = start + step; t1 <= end; t1 += step) {
    const f1 = f(t1);
    // A real crossing passes through 0 (either way), not through ±180.
    if (Math.sign(f0) !== Math.sign(f1) && Math.abs(f1 - f0) < 90) out.push(bisect(f, t0, t1));
    t0 = t1;
    f0 = f1;
  }
  return out;
}

// ---------------------------------------------------------------- Moon latitude (Meeus ch. 47, main terms)
/** Geocentric ecliptic latitude of the Moon (degrees), good to ~0.01°. */
function moonLatitude(mjd: number): number {
  const T = (mjd - 51544.5) / 36525;
  const D = (297.8501921 + 445267.1114034 * T) * D2R;
  const M = (357.5291092 + 35999.0502909 * T) * D2R;
  const Mp = (134.9633964 + 477198.8675055 * T) * D2R;
  const F = (93.272095 + 483202.0175233 * T) * D2R;
  return (
    5.128122 * Math.sin(F) + 0.280602 * Math.sin(Mp + F) + 0.277693 * Math.sin(Mp - F) + 0.173237 * Math.sin(2 * D - F) +
    0.055413 * Math.sin(2 * D - Mp + F) + 0.046271 * Math.sin(2 * D - Mp - F) + 0.032573 * Math.sin(2 * D + F) +
    0.017198 * Math.sin(2 * Mp + F) + 0.009266 * Math.sin(2 * D + Mp - F) + 0.008822 * Math.sin(2 * Mp - F) +
    0.008216 * Math.sin(2 * D - M - F) + 0.004324 * Math.sin(2 * D - 2 * Mp - F)
  );
}

// ---------------------------------------------------------------- calendar
let meteorShowers: any[] | null = null;
export async function loadMeteorShowers() {
  if (!meteorShowers) {
    try {
      meteorShowers = (await getJson(abs("skydata/meteor-showers.json"))).showers ?? [];
    } catch {
      meteorShowers = [];
    }
  }
  return meteorShowers!;
}

/** All events between start and start + days, sorted by time. */
export function computeEvents(start: number, days: number): SkyEvent[] {
  const end = start + days;
  const sun = planet("Sun"), moon = planet("Moon");
  if (!sun || !moon) return [];
  const events: SkyEvent[] = [];
  withObserverCopy(app.stel, (local) => withObserverCopy(app.stel, (o) => {
    // Earth's centre: on the equator, one equatorial radius down.
    o.latitude = 0;
    o.elevation = -6378137;
    const { dir, eclLon } = sampler(o);
    const topo = sampler(local);
    const lon = (obj: SweObj) => (t: number) => eclLon(dir(obj, t));
    const sunLon = lon(sun), moonLon = lon(moon);
    const elong = (obj: SweObj) => (t: number) => wrap360(lon(obj)(t) - sunLon(t));

    // Moon phases
    const phaseNames: [number, string][] = [[0, "New Moon"], [90, "First Quarter"], [180, "Full Moon"], [270, "Last Quarter"]];
    const moonPhase = (t: number) => wrap360(moonLon(t) - sunLon(t));
    for (const [deg, name] of phaseNames) {
      for (const t of crossings(moonPhase, deg, start, end, 0.5)) {
        events.push({ mjd: t, kind: "moon", title: name, detail: deg === 0 ? "Dark skies: the best nights for galaxies and nebulae." : deg === 180 ? "The Moon is up all night." : "Half of the Moon is lit.", target: "NAME Moon" });
        // Eclipses happen at new/full Moon close to a node.
        if (deg === 0 || deg === 180) {
          const beta = Math.abs(moonLatitude(t));
          if (deg === 180 && beta < 1.54) {
            const kind = beta < 0.49 ? "Total lunar eclipse" : beta < 1.01 ? "Partial lunar eclipse" : "Penumbral lunar eclipse";
            local.utc = t;
            const up = altitudeFor(app.stel, moon, local) > 0;
            events.push({ mjd: t, kind: "eclipse", title: kind, detail: up ? "The Moon is up here at mid-eclipse." : "The Moon is below your horizon at mid-eclipse.", target: "NAME Moon" });
          }
          if (deg === 0 && beta < 1.55) {
            // Topocentric: is the Sun covered as seen from here?
            const s = (x: number) => sep(topo.dir(sun, x), topo.dir(moon, x));
            const tm = minimize(s, t - 0.25, t + 0.25);
            const d = s(tm) * R2D;
            local.utc = tm;
            const sunUp = altitudeFor(app.stel, sun, local) > 0;
            const rs = (sun.getInfo("radius", local) as number) * R2D, rm = (moon.getInfo("radius", local) as number) * R2D;
            let detail = "Visible from other parts of the Earth, not from here.";
            if (sunUp && d < rs + rm) {
              detail = d < Math.abs(rm - rs) ? (rm > rs ? "Total from here!" : "Annular from here.") : `Partial from here: ${Math.round(((rs + rm - d) / (2 * rs)) * 100)}% of the Sun's width covered. Use eclipse glasses.`;
            }
            events.push({ mjd: sunUp && d < rs + rm ? tm : t, kind: "eclipse", title: "Solar eclipse", detail, target: "NAME Sun" });
          }
        }
      }
    }

    // Equinoxes and solstices
    const seasons: [number, string][] = [[0, "March equinox"], [90, "June solstice"], [180, "September equinox"], [270, "December solstice"]];
    for (const [deg, name] of seasons) {
      for (const t of crossings(sunLon, deg, start, end, 2)) events.push({ mjd: t, kind: "season", title: name, detail: deg % 180 === 0 ? "Day and night are about the same length." : deg === 90 ? "Longest day in the north, shortest in the south." : "Shortest day in the north, longest in the south." });
    }

    // Earth at perihelion / aphelion (Sun distance extremes)
    const sunDist = (t: number) => {
      o.utc = t;
      return sun.getInfo("distance", o) as number;
    };
    for (let t = start; t < end; t += 3) {
      const a = sunDist(t - 3), b = sunDist(t), c = sunDist(t + 3);
      if (b < a && b <= c) events.push({ mjd: minimize(sunDist, t - 3, t + 3, HOUR), kind: "earth", title: "Earth at perihelion", detail: "Closest to the Sun this year." });
      if (b > a && b >= c) events.push({ mjd: minimize((x) => -sunDist(x), t - 3, t + 3, HOUR), kind: "earth", title: "Earth at aphelion", detail: "Farthest from the Sun this year." });
    }

    // Oppositions and elongations
    for (const name of PLANETS) {
      const p = planet(name);
      if (!p) continue;
      if (name === "Mercury" || name === "Venus") {
        const e = (t: number) => sep(dir(p, t), dir(sun, t));
        for (let t = start; t < end; t += 2) {
          const a = e(t - 2), b = e(t), c = e(t + 2);
          if (b > a && b >= c && b * R2D > 15) {
            const tm = minimize((x) => -e(x), t - 2, t + 2, HOUR);
            const east = wrap180(lon(p)(tm) - sunLon(tm)) > 0;
            events.push({ mjd: tm, kind: "elongation", title: `${name} at greatest elongation`, detail: `${Math.round(e(tm) * R2D)}° from the Sun, best seen ${east ? "after sunset in the west" : "before sunrise in the east"}.`, target: `NAME ${name}` });
          }
        }
      } else {
        for (const t of crossings(elong(p), 180, start, end, 2)) {
          o.utc = t;
          const mag = p.getInfo("vmag", o) as number;
          events.push({ mjd: t, kind: "opposition", title: `${name} at opposition`, detail: `Up all night and at its brightest (mag ${mag.toFixed(1)}).`, target: `NAME ${name}` });
        }
      }
    }

    // Conjunctions: the Moon with bright planets (< 5°), planet pairs (< 2°).
    const conj = (a: SweObj, b: SweObj, an: string, bn: string, step: number, maxDeg: number) => {
      const s = (t: number) => sep(dir(a, t), dir(b, t));
      let prev2 = s(start - step), prev = s(start);
      for (let t = start + step; t <= end + step; t += step) {
        const cur = s(t);
        if (prev < prev2 && prev <= cur && prev * R2D < maxDeg + 1) {
          const tm = minimize(s, t - 2 * step, t, 10 * MIN);
          const d = s(tm) * R2D;
          if (d < maxDeg && tm >= start && tm < end) {
            local.utc = tm;
            const sunAlt = altitudeFor(app.stel, sun, local) * R2D;
            const close = d < 1 ? `${Math.round(d * 60)}′ apart` : `${d.toFixed(1)}° apart`;
            events.push({ mjd: tm, kind: "conjunction", title: `${an} and ${bn}`, detail: `${close}${sunAlt > -6 ? " (in daylight here; look the evening before or after)" : ""}.`, target: `NAME ${bn}` });
          }
        }
        prev2 = prev;
        prev = cur;
      }
    };
    for (const name of BRIGHT) {
      const p = planet(name);
      if (p) conj(moon, p, "Moon", name, 0.25, 5);
    }
    for (let i = 0; i < BRIGHT.length; i++) {
      for (let j = i + 1; j < BRIGHT.length; j++) {
        const a = planet(BRIGHT[i]), b = planet(BRIGHT[j]);
        if (a && b) conj(a, b, BRIGHT[i], BRIGHT[j], 1, 2);
      }
    }

    // Meteor showers (peaks are fixed calendar dates)
    for (const sh of meteorShowers ?? []) {
      const md = sh.model_data ?? {};
      if (!md.peak) continue;
      const [mm, dd] = String(md.peak).split("-").map(Number);
      for (const y of [new Date().getUTCFullYear() - 1, new Date().getUTCFullYear(), new Date().getUTCFullYear() + 1]) {
        // Best seen in the small hours of the peak date (radiants rise late).
        const t = new Date(y, mm - 1, dd, 2, 0).getTime() / 86400000 + 40587;
        if (t < start || t >= end) continue;
        o.utc = t;
        const lit = moon.getInfo("phase", o) as number;
        const moonNote = lit < 0.3 ? "Dark Moon: a good year for it." : lit > 0.7 ? "A bright Moon will wash out the fainter meteors." : "Some moonlight.";
        events.push({ mjd: t, kind: "meteors", title: `${sh.designation} peak`, detail: `Up to ${md.zhr} meteors an hour under a dark sky. ${moonNote}`, allNight: true });
      }
    }
  }));
  return events.sort((a, b) => a.mjd - b.mjd);
}

// ---------------------------------------------------------------- tonight
export interface Night {
  /** Sunset, end of astronomical twilight, start of morning twilight, sunrise. */
  sunset: number;
  dark: number | null;
  dawn: number | null;
  sunrise: number;
}

/** The night that contains (or follows) `mjd`, local time. */
export function nightOf(mjd: number): Night {
  const sun = planet("Sun")!;
  const d = new Date((mjd - 40587) * 86400000);
  d.setHours(d.getHours() < 12 ? 0 : 24, 0, 0, 0);
  const mid = d.getTime() / 86400000 + 40587;
  return withObserverCopy(app.stel, (o) => {
    const alt = (t: number) => {
      o.utc = t;
      return altitudeFor(app.stel, sun, o) * R2D;
    };
    // Walk out from local midnight, then refine each crossing.
    const find = (level: number, dir: -1 | 1): number | null => {
      if (alt(mid) > level) return null; // the Sun never gets that low
      for (let t = mid; Math.abs(t - mid) < 0.75; t += dir * 10 * MIN) {
        if (alt(t) > level) return bisect((x) => alt(x) - level, Math.min(t, t - dir * 10 * MIN), Math.max(t, t - dir * 10 * MIN));
      }
      return null;
    };
    const sunset = find(-0.833, -1) ?? mid - 0.25;
    const sunrise = find(-0.833, 1) ?? mid + 0.25;
    return { sunset, dark: find(-18, -1), dawn: find(-18, 1), sunrise };
  });
}

export interface Pass {
  name: string;
  id: string;
  rise: number;
  peak: number;
  set: number;
  maxAlt: number;
  /** Brightest magnitude while sunlit and above 10°. */
  mag: number;
  /** Compass direction at start / end of the visible part. */
  fromAz: number;
  toAz: number;
}

/**
 * Visible passes tonight: the satellite is above 10°, sunlit, and the sky is
 * dark enough (Sun below −6°). Samples every 20 s from sunset to sunrise.
 */
export function satellitePasses(night: Night, ids: { id: string; name: string }[], maxMag = 4.5): Pass[] {
  const sun = planet("Sun")!;
  const sats = ids.map((s) => ({ ...s, obj: app.stel.getObj(s.id) })).filter((s) => s.obj) as { id: string; name: string; obj: SweObj }[];
  const passes: Pass[] = [];
  withObserverCopy(app.stel, (o) => {
    const open = new Map<string, Pass>();
    const step = 20 / 86400;
    for (let t = night.sunset; t <= night.sunrise; t += step) {
      o.utc = t;
      const dark = altitudeFor(app.stel, sun, o) * R2D < -6;
      for (const s of sats) {
        const v = app.stel.convertFrame(o, "ICRF", "OBSERVED", s.obj.getInfo("radec", o));
        const [az, alt] = app.stel.c2s(v);
        const altD = app.stel.anpm(alt) * R2D;
        const mag = s.obj.getInfo("vmag", o) as number;
        const visible = dark && altD > 10 && mag < maxMag;
        let p = open.get(s.id);
        if (visible) {
          if (!p) {
            p = { name: s.name, id: s.id, rise: t, peak: t, set: t, maxAlt: altD, mag, fromAz: app.stel.anp(az), toAz: app.stel.anp(az) };
            open.set(s.id, p);
          }
          p.set = t;
          p.toAz = app.stel.anp(az);
          if (altD > p.maxAlt) {
            p.maxAlt = altD;
            p.peak = t;
          }
          p.mag = Math.min(p.mag, mag);
        } else if (p) {
          if (p.set - p.rise > 30 / 86400) passes.push(p);
          open.delete(s.id);
        }
      }
    }
    for (const p of open.values()) passes.push(p);
  });
  return passes.sort((a, b) => a.rise - b.rise);
}
