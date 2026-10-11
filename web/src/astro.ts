/** Small astronomy helpers the engine doesn't expose (rise/set, wording). */

const D2R = Math.PI / 180;

/** Greenwich mean sidereal time (radians) for an MJD (UTC). */
export function gmst(mjd: number): number {
  const d = mjd - 51544.5; // days since J2000.0
  const deg = 280.46061837 + 360.98564736629 * d;
  return (((deg % 360) + 360) % 360) * D2R;
}

export interface RiseSet {
  /** MJD of next rise / transit / set, or null. */
  rise: number | null;
  transit: number;
  set: number | null;
  /** Never sets (circumpolar) or never rises at this latitude. */
  always: "up" | "down" | null;
}

/**
 * Next rise, transit and set for a fixed RA/Dec (good enough for stars and
 * planets over a day; the Moon drifts ~13°/day so its times are ±30 min).
 * h0 is the standard altitude: -0.5667° for stars, -0.833° Sun, +0.125° Moon.
 */
export function riseSet(ra: number, dec: number, lat: number, lon: number, mjdNow: number, h0Deg = -0.5667): RiseSet {
  const h0 = h0Deg * D2R;
  const cosH = (Math.sin(h0) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
  // Hour angle now; transit is when HA = 0.
  const ha = gmst(mjdNow) + lon - ra;
  const siderealDay = 0.99726958; // solar days
  const wrap = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const untilTransit = (wrap(-ha) / (2 * Math.PI)) * siderealDay;
  const transit = mjdNow + untilTransit;
  if (cosH < -1) return { rise: null, set: null, transit, always: "up" };
  if (cosH > 1) return { rise: null, set: null, transit, always: "down" };
  const H = Math.acos(cosH);
  const next = (target: number) => mjdNow + (wrap(target - ha) / (2 * Math.PI)) * siderealDay;
  return { rise: next(-H), set: next(H), transit, always: null };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const COMPASS_LONG = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

export const compass = (azRad: number, long = false) => {
  const i = Math.round((((azRad / D2R) % 360) + 360) % 360 / 45) % 8;
  return (long ? COMPASS_LONG : COMPASS)[i];
};

/** "23° up in the southeast" / "below the horizon". */
export function whereText(az: number, alt: number): string {
  const a = Math.round(alt / D2R);
  if (a < -1) return `${-a}° below the horizon, ${compass(az, true)}`;
  if (a > 80) return "almost straight up";
  return `${Math.max(a, 0)}° up in the ${compass(az, true)}`;
}

export function moonPhaseName(illum: number, waxing: boolean): string {
  if (illum < 0.03) return "New Moon";
  if (illum > 0.97) return "Full Moon";
  if (Math.abs(illum - 0.5) < 0.06) return waxing ? "First Quarter" : "Last Quarter";
  if (illum < 0.5) return waxing ? "Waxing Crescent" : "Waning Crescent";
  return waxing ? "Waxing Gibbous" : "Waning Gibbous";
}

export const mjdToDate = (mjd: number) => new Date((mjd - 40587) * 86400000);
export const dateToMjd = (d: Date) => d.getTime() / 86400000 + 40587;

export const fmtTime = (mjd: number) =>
  mjdToDate(mjd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Right ascension (radians) as "05h 34m 31.9s". */
export function fmtRA(rad: number): string {
  let s = ((((rad / D2R) / 15) % 24) + 24) % 24 * 3600;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return `${pad2(h)}h ${pad2(m)}m ${s.toFixed(1).padStart(4, "0")}s`;
}

/** Declination / altitude (radians) as "+22° 00′ 52″". */
export function fmtDec(rad: number): string {
  const sign = rad < 0 ? "−" : "+";
  let s = Math.abs(rad / D2R) * 3600;
  const d = Math.floor(s / 3600);
  s -= d * 3600;
  const m = Math.floor(s / 60);
  s = Math.round(s - m * 60);
  return `${sign}${d}° ${pad2(m)}′ ${pad2(s)}″`;
}

/** Azimuth (radians) as "123° 45′". */
export function fmtAz(rad: number): string {
  const deg = ((rad / D2R) % 360 + 360) % 360;
  const d = Math.floor(deg);
  return `${d}° ${pad2(Math.round((deg - d) * 60) % 60)}′`;
}
