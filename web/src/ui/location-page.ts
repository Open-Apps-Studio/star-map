/**
 * Location (Stellarium Mobile's Menu › Location): use the phone's GPS, or pick
 * any place on Earth by searching for it (OpenStreetMap, when online) or by
 * typing coordinates.
 */
import { app, toast } from "../state";
import { D2R } from "../engine";
import { getJson } from "../catalog";
import { applyLocation, lastFix } from "../location";
import { saveSettings, settings } from "../settings";
import { buttonRow, el, inputRow, pushPage, refreshPage, section, switchRow } from "./page";

const fmt = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}`;

function useManual(lat: number, lon: number, alt: number, name: string) {
  settings.autoLocation = false;
  settings.manualLocation = { lat, lon, alt, name };
  saveSettings();
  applyLocation();
  toast(`Sky set for ${name}`);
}

interface Place { name: string; detail: string; lat: number; lon: number }

/**
 * OpenStreetMap place search: Photon (komoot) first, Nominatim as fallback.
 * XHR via getJson, since fetch() is unreliable from the app's file:// page.
 */
async function searchPlaces(q: string): Promise<Place[]> {
  try {
    const r = await getJson(`https://photon.komoot.io/api/?limit=8&q=${encodeURIComponent(q)}`);
    // Cities before towns before villages before everything else.
    const rank = (f: any) => ({ city: 0, town: 1, village: 2 } as Record<string, number>)[f.properties?.osm_value] ?? 3;
    const feats = (r.features as any[]).map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
    return feats.map((f) => {
      const p = f.properties ?? {};
      return {
        name: p.name ?? p.city ?? q,
        detail: [p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(", "),
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      };
    });
  } catch {
    const r = await getJson(`https://nominatim.openstreetmap.org/search?format=json&limit=8&q=${encodeURIComponent(q)}`);
    return (r as any[]).map((p) => {
      const parts = String(p.display_name).split(", ");
      return { name: parts[0], detail: parts.slice(1).join(", "), lat: Number(p.lat), lon: Number(p.lon) };
    });
  }
}

export function openLocation() {
  pushPage("Location", (body) => {
    const lat = app.obs.latitude / D2R, lon = app.obs.longitude / D2R;
    let box = section(body, "Current");
    const cur = el("div", "row");
    cur.innerHTML = `<span class="row-text"><span class="row-label"></span><span class="row-sub"></span></span>`;
    cur.querySelector(".row-label")!.textContent = settings.autoLocation ? "My location" : settings.manualLocation?.name ?? "Chosen place";
    cur.querySelector(".row-sub")!.textContent = `${fmt(lat, lon)} · ${Math.round(app.obs.elevation)} m`;
    box.appendChild(cur);

    box = section(body, "Automatic", "Uses your phone's location. Turn it off to see the sky from anywhere else.");
    switchRow(box, "Use my location", () => settings.autoLocation, (v) => {
      settings.autoLocation = v;
      if (!v && !settings.manualLocation) {
        const f = lastFix ?? { lat, lon, alt: app.obs.elevation };
        settings.manualLocation = { ...f, name: "Chosen place" };
      }
      saveSettings();
      applyLocation();
      refreshPage();
    });

    // ---- search
    box = section(body, "Find a place");
    const input = inputRow(box, "Search", { value: "", placeholder: "City, town, observatory…", onChange: () => {} });
    input.setAttribute("enterkeyhint", "search");
    const results = el("div", "group");
    results.hidden = true;
    body.appendChild(results);
    let seq = 0;
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) return;
      const mine = ++seq;
      results.hidden = false;
      results.innerHTML = `<div class="row"><span class="row-sub">Searching…</span></div>`;
      try {
        const places = await searchPlaces(q);
        if (mine !== seq) return;
        results.innerHTML = "";
        if (!places.length) results.innerHTML = `<div class="row"><span class="row-sub">No places found</span></div>`;
        for (const p of places) {
          buttonRow(results, "", () => {
            useManual(p.lat, p.lon, 0, p.name);
            input.blur();
            refreshPage();
          });
          const b = results.lastElementChild as HTMLElement;
          b.className = "row nav-row";
          b.innerHTML = `<span class="row-text"><span class="row-label"></span><span class="row-sub"></span></span>`;
          b.querySelector(".row-label")!.textContent = p.name;
          b.querySelector(".row-sub")!.textContent = p.detail;
        }
      } catch {
        if (mine === seq) results.innerHTML = `<div class="row"><span class="row-sub">Place search needs an internet connection. You can still type coordinates below.</span></div>`;
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run();
    });
    input.addEventListener("change", run);

    // ---- coordinates
    box = section(body, "Coordinates", "Decimal degrees: north and east positive.");
    const m = settings.manualLocation ?? { lat, lon, alt: Math.round(app.obs.elevation), name: "Chosen place" };
    const latIn = inputRow(box, "Latitude", { value: m.lat.toFixed(4), inputmode: "decimal", onChange: () => {} });
    const lonIn = inputRow(box, "Longitude", { value: m.lon.toFixed(4), inputmode: "decimal", onChange: () => {} });
    const altIn = inputRow(box, "Elevation (m)", { value: String(Math.round(m.alt)), inputmode: "numeric", onChange: () => {} });
    buttonRow(box, "Use these coordinates", () => {
      const la = Number(latIn.value.replace(",", ".")), lo = Number(lonIn.value.replace(",", ".")), al = Number(altIn.value) || 0;
      if (!(Math.abs(la) <= 90) || !(Math.abs(lo) <= 180)) return toast("Latitude must be −90…90 and longitude −180…180");
      useManual(la, lo, al, fmt(la, lo));
      refreshPage();
    });
  });
}
