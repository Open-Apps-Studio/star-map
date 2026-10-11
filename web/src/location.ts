/**
 * Observer location: GPS from the app shell (or the browser), a manual place
 * chosen in the Location page, or the last known one.
 */
import { D2R } from "./engine";
import { inApp } from "./bridge";
import { app } from "./state";
import { settings } from "./settings";

const FALLBACK = { lat: 41.0082, lon: 28.9784, alt: 40 }; // Istanbul

/** Last GPS fix (kept even while a manual place is active). */
export let lastFix: { lat: number; lon: number; alt: number } | null = null;

export function setLocation(lat: number, lon: number, alt = 0) {
  app.obs.latitude = lat * D2R;
  app.obs.longitude = lon * D2R;
  app.obs.elevation = alt;
}

/** A GPS fix arrived: remember it, and use it unless a manual place is set. */
export function onFix(lat: number, lon: number, alt = 0) {
  lastFix = { lat, lon, alt };
  try {
    localStorage.setItem("loc", JSON.stringify(lastFix));
  } catch {
    /* private mode */
  }
  if (settings.autoLocation) setLocation(lat, lon, alt);
}

/** Apply the current choice (auto or manual) to the observer. */
export function applyLocation() {
  if (!settings.autoLocation && settings.manualLocation) {
    const m = settings.manualLocation;
    setLocation(m.lat, m.lon, m.alt);
    return;
  }
  const f = lastFix ?? FALLBACK;
  setLocation(f.lat, f.lon, f.alt);
}

export function initLocation() {
  try {
    lastFix = JSON.parse(localStorage.getItem("loc") ?? "null");
  } catch {
    /* ignore */
  }
  applyLocation();
  if (!inApp() && "geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (p) => onFix(p.coords.latitude, p.coords.longitude, p.coords.altitude ?? 0),
      () => {},
      { timeout: 10000, maximumAge: 3600_000 },
    );
  }
}
