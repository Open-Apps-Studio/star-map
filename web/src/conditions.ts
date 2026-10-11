/**
 * Observing conditions: hourly cloud cover, humidity, wind and temperature
 * from Open-Meteo (free, no key, CC BY 4.0), turned into a stargazing score
 * per night that also counts the Moon and how long it's properly dark.
 * Like Sky Tonight's "Stargazing Index" and Sky Guide's weather.
 */
import { app, planet } from "./state";
import { altitudeFor, withObserverCopy } from "./engine";
import { nightOf, type Night } from "./events";

export interface Hour {
  /** MJD (UTC). */
  t: number;
  cloud: number;
  low: number;
  mid: number;
  high: number;
  humidity: number;
  temp: number;
  dew: number;
  wind: number;
  rain: number;
}

export interface Forecast {
  hours: Hour[];
  fetched: number;
  lat: number;
  lon: number;
}

const CACHE_KEY = "forecast-v1";
const MAX_AGE_MS = 60 * 60e3;
const unixToMjd = (s: number) => s / 86400 + 40587;

let inflight: Promise<Forecast | null> | null = null;
let inflightKey = "";

const cacheKey = (lat: number, lon: number) => `${lat.toFixed(1)},${lon.toFixed(1)}`;

function readCache(lat: number, lon: number): Forecast | null {
  try {
    const f = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Forecast | null;
    if (f && cacheKey(f.lat, f.lon) === cacheKey(lat, lon)) return f;
  } catch {
    /* ignore */
  }
  return null;
}

/** Hourly forecast for the next 8 days at the observer; cached an hour. Null offline. */
export function getForecast(): Promise<Forecast | null> {
  const lat = app.obs.latitude * (180 / Math.PI), lon = app.obs.longitude * (180 / Math.PI);
  const cached = readCache(lat, lon);
  if (cached && Date.now() - cached.fetched < MAX_AGE_MS) return Promise.resolve(cached);
  const key = cacheKey(lat, lon);
  if (inflight && inflightKey === key) return inflight;
  inflightKey = key;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    "&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,temperature_2m,dew_point_2m,wind_speed_10m,precipitation_probability" +
    "&forecast_days=8&timeformat=unixtime&timezone=GMT";
  inflight = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j): Forecast => {
      const h = j.hourly;
      const hours: Hour[] = h.time.map((t: number, i: number) => ({
        t: unixToMjd(t),
        cloud: h.cloud_cover[i] ?? 0,
        low: h.cloud_cover_low[i] ?? 0,
        mid: h.cloud_cover_mid[i] ?? 0,
        high: h.cloud_cover_high[i] ?? 0,
        humidity: h.relative_humidity_2m[i] ?? 0,
        temp: h.temperature_2m[i] ?? 0,
        dew: h.dew_point_2m[i] ?? 0,
        wind: h.wind_speed_10m[i] ?? 0,
        rain: h.precipitation_probability[i] ?? 0,
      }));
      const f = { hours, fetched: Date.now(), lat, lon };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(f));
      } catch {
        /* ignore */
      }
      return f;
    })
    .catch(() => cached) // offline: an older forecast beats nothing
    .finally(() => (inflight = null));
  return inflight;
}

/** Hours between two MJDs (inclusive of the hour containing `from`). */
export const hoursBetween = (f: Forecast, from: number, to: number) => f.hours.filter((h) => h.t >= from - 1 / 48 && h.t <= to + 1 / 48);

export interface NightScore {
  night: Night;
  /** 0–100; null when the forecast doesn't cover this night. */
  score: number | null;
  label: string;
  /** Average cloud cover over the dark hours. */
  cloud: number | null;
  /** Fraction of the dark hours with the Moon up, and its illumination. */
  moonUp: number;
  moonLit: number;
  /** Hours of astronomical darkness. */
  darkHours: number;
  summary: string;
}

export function scoreLabel(score: number | null) {
  if (score == null) return "No forecast";
  return score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Fair" : score >= 20 ? "Poor" : "Bad";
}

/** Colour for a score (green → amber → red). */
export const scoreColor = (score: number | null) =>
  score == null ? "#6b7280" : score >= 80 ? "#3ecf8e" : score >= 60 ? "#8fd16a" : score >= 40 ? "#e8c35a" : score >= 20 ? "#e8905a" : "#e86a6a";

/**
 * Score one night: clouds dominate (a cloudy night is a lost night), then the
 * Moon (a bright Moon up all night washes out everything faint), then damp
 * air (dew and haze). Short summer nights lose a little too.
 */
export function scoreNight(f: Forecast | null, mjd: number): NightScore {
  const night = nightOf(mjd);
  const from = night.dark ?? night.sunset + 1 / 24, to = night.dawn ?? night.sunrise - 1 / 24;
  const darkHours = Math.max(0, (to - from) * 24);
  const moon = planet("Moon")!;
  let moonUp = 0, moonLit = 0, n = 0;
  withObserverCopy(app.stel, (o) => {
    for (let t = from; t <= to; t += 1 / 24) {
      o.utc = t;
      if (altitudeFor(app.stel, moon, o) > 0) moonUp++;
      n++;
    }
    o.utc = (from + to) / 2;
    moonLit = moon.getInfo("phase", o) as number;
  });
  moonUp = n ? moonUp / n : 0;
  const hours = f ? hoursBetween(f, from, to) : [];
  if (!hours.length) return { night, score: null, label: scoreLabel(null), cloud: null, moonUp, moonLit, darkHours, summary: "" };
  const avg = (k: keyof Hour) => hours.reduce((s, h) => s + (h[k] as number), 0) / hours.length;
  const cloud = avg("cloud"), humidity = avg("humidity"), rain = avg("rain");
  // Best 3-hour clear window counts for something even on a mixed night.
  let bestWindow = 100;
  for (let i = 0; i + 2 < hours.length; i++) bestWindow = Math.min(bestWindow, (hours[i].cloud + hours[i + 1].cloud + hours[i + 2].cloud) / 3);
  const clouds = Math.min(cloud, (cloud + bestWindow) / 2);
  let score = 100 - clouds * 0.9;
  score -= moonUp * moonLit * 25;
  score -= Math.max(0, humidity - 80) * 0.6;
  score -= rain * 0.15;
  if (darkHours < 4) score -= (4 - darkHours) * 4;
  score = Math.round(Math.max(0, Math.min(100, score)));
  const bits: string[] = [];
  bits.push(cloud < 15 ? "Clear skies" : cloud < 40 ? "Mostly clear" : cloud < 70 ? "Partly cloudy" : cloud < 90 ? "Mostly cloudy" : "Overcast");
  if (cloud >= 15 && bestWindow < 20 && hours.length >= 3) bits.push("with a clear window");
  if (cloud < 70) {
    if (moonUp * moonLit > 0.4) bits.push("bright Moon");
    else if (moonLit < 0.15 || moonUp < 0.1) bits.push("no Moon in the way");
  }
  if (humidity > 90) bits.push("dew likely");
  return { night, score, label: scoreLabel(score), cloud, moonUp, moonLit, darkHours, summary: bits.join(", ") };
}

/** The next `days` nights starting with the one containing `mjd`. */
export function scoreWeek(f: Forecast | null, mjd: number, days = 7): NightScore[] {
  const out: NightScore[] = [];
  for (let i = 0; i < days; i++) out.push(scoreNight(f, mjd + i));
  return out;
}
