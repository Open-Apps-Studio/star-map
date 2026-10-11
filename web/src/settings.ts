/**
 * User settings (Stellarium Mobile Plus's settings screen): persisted in
 * localStorage and pushed into the engine by `applySettings`.
 */
import { app } from "./state";
import { loadLandscape, loadSkyCulture } from "./engine";
import type { IconKind } from "./icons";

/** A saved object: names to resolve it, and a fixed position for stars/DSOs. */
export interface Favourite {
  name: string;
  ids: string[];
  ra?: number;
  de?: number;
  type?: string;
  icon?: IconKind;
}

export interface Ocular {
  id: string;
  name: string;
  kind: "eyepiece" | "camera" | "telrad" | "binoculars";
  /** Telescope focal length and aperture, mm (eyepiece and camera). */
  scopeFocal: number;
  scopeAperture: number;
  /** Eyepiece focal length (mm) and apparent field (degrees). */
  epFocal: number;
  epAfov: number;
  /** Camera sensor size (mm). */
  sensorW: number;
  sensorH: number;
  /** Binoculars: true field of view (degrees) and magnification. */
  binoFov: number;
  binoMag: number;
}

export interface Settings {
  skyCulture: string;
  /** A bundled landscape id (skydata/landscapes/index.json). */
  landscape: string;
  /** Faintest star magnitude to draw; 99 = no limit. */
  starLimit: number;
  /** Star brightness and size, 0.5–2 (1 = Stellarium's default). */
  starBrightness: number;
  /** Label density per kind, -3 (fewer) … +3 (more). */
  labels: { stars: number; planets: number; dsos: number; satellites: number };
  /** Bortle class 1 (pristine) … 9 (city centre). */
  bortle: number;
  fog: boolean;
  cardinals: boolean;
  meteors: boolean;
  /** Stream the deep catalogues (Gaia stars, extended DSOs, DSS photos). */
  onlineData: boolean;
  /** Startup: "now" opens at the current time, "last" where you left off. */
  startTime: "now" | "last";
  autoLocation: boolean;
  manualLocation: { lat: number; lon: number; alt: number; name: string } | null;
  favourites: Favourite[];
  oculars: Ocular[];
  /** Telescope control: host:port of a Stellarium/LX200 TCP server. */
  telescope: { protocol: "stellarium" | "lx200"; host: string; port: number } | null;
}

export const DEFAULTS: Settings = {
  skyCulture: "western",
  landscape: "guereins",
  starLimit: 99,
  starBrightness: 1,
  labels: { stars: 0, planets: 0, dsos: 0, satellites: 0 },
  bortle: 3,
  fog: true,
  cardinals: true,
  meteors: true,
  onlineData: true,
  startTime: "now",
  autoLocation: true,
  manualLocation: null,
  favourites: [],
  oculars: [
    {
      id: "telrad", name: "Telrad", kind: "telrad",
      scopeFocal: 0, scopeAperture: 0, epFocal: 0, epAfov: 0, sensorW: 0, sensorH: 0, binoFov: 0, binoMag: 0,
    },
    {
      id: "dob8-25", name: '8" Dobsonian + 25 mm', kind: "eyepiece",
      scopeFocal: 1200, scopeAperture: 203, epFocal: 25, epAfov: 52, sensorW: 0, sensorH: 0, binoFov: 0, binoMag: 0,
    },
    {
      id: "bino10x50", name: "10×50 binoculars", kind: "binoculars",
      scopeFocal: 0, scopeAperture: 50, epFocal: 0, epAfov: 0, sensorW: 0, sensorH: 0, binoFov: 6.5, binoMag: 10,
    },
  ],
  telescope: null,
};

const KEY = "settings";

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw === "object") {
      const s = { ...structuredClone(DEFAULTS), ...raw, labels: { ...DEFAULTS.labels, ...(raw.labels ?? {}) } };
      // Older builds stored favourites as plain names.
      s.favourites = (s.favourites ?? []).filter((f: unknown) => f && typeof f === "object");
      return s;
    }
  } catch {
    /* corrupt or unavailable storage: defaults */
  }
  return structuredClone(DEFAULTS);
}

export const settings: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode: settings last for this session */
  }
}

/** Change one setting, persist it and push it into the engine. */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  settings[key] = value;
  saveSettings();
  applySettings();
}

/**
 * Push every setting into the engine. Cheap and idempotent, so callers just
 * call it after any change.
 */
export function applySettings() {
  const core = app.core;
  if (!core) return;
  const s = settings;
  core.display_limit_mag = s.starLimit;
  // Stellarium's own defaults are linear 0.8, relative 1.1; the slider
  // scales both so "brighter" also means "bigger".
  core.star_linear_scale = 0.8 * s.starBrightness;
  core.star_relative_scale = 1.1 * Math.sqrt(s.starBrightness);
  core.stars.hints_mag_offset = s.labels.stars;
  core.planets.hints_mag_offset = s.labels.planets;
  core.minor_planets.hints_mag_offset = s.labels.planets;
  core.comets.hints_mag_offset = s.labels.planets;
  core.dsos.hints_mag_offset = s.labels.dsos;
  core.satellites.hints_mag_offset = s.labels.satellites;
  core.bortle_index = s.bortle;
  core.landscapes.fog_visible = s.fog;
  core.cardinals.visible = s.cardinals;
  core.meteors.visible = s.meteors;
  loadSkyCulture(s.skyCulture);
  loadLandscape(s.landscape);
}

const favIndex = (ids: string[]) => settings.favourites.findIndex((f) => f.ids.some((id) => ids.includes(id)));

export const isFavourite = (ids: string[]) => favIndex(ids) >= 0;

/** Add or remove; returns whether it's a favourite now. */
export function toggleFavourite(f: Favourite): boolean {
  const i = favIndex(f.ids);
  if (i >= 0) settings.favourites.splice(i, 1);
  else settings.favourites.push(f);
  saveSettings();
  return i < 0;
}
