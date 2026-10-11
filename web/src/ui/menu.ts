/**
 * ☰ drawer: Tonight and Calendar (Observe), Instruments (oculars, telescope),
 * Location, Settings, About. Each opens a full-screen page (ui/page.ts).
 */
import { $, app, haptic } from "../state";
import { hydrateIcons, icon, MDI } from "../icons";
import { D2R } from "../engine";
import { settings } from "../settings";
import { closePages, initPages, openPage } from "./page";
import { openObserve } from "./observe";
import { openSettings } from "./settings-page";
import { openLocation } from "./location-page";
import { openInstruments } from "./instruments";

function openDrawer(on: boolean) {
  $("drawer").classList.toggle("open", on);
  $("scrim").hidden = !on;
  if (on) {
    const lat = app.obs.latitude / D2R, lon = app.obs.longitude / D2R;
    const where = !settings.autoLocation && settings.manualLocation ? `${settings.manualLocation.name} · ` : "";
    $("drawer-loc").textContent = `${where}${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  }
}

function about(body: HTMLElement) {
  body.innerHTML = `<p>Star Map is a free star map, with no ads, accounts or paywalls.</p>
    <h3>Built on</h3>
    <p><a href="https://github.com/Stellarium/stellarium-web-engine">Stellarium Web Engine</a> (AGPL-3.0) by Stellarium Labs, compiled to run fully on your phone.</p>
    <h3>Data</h3>
    <p>Stars: Hipparcos, Tycho and Gaia DR3 (ESA) via Stellarium. Deep-sky objects and sky photos (Digitized Sky Survey, STScI/CDS): Stellarium. Sky cultures and landscapes: the Stellarium project and their authors. Satellite orbits: CelesTrak. Comets and asteroids: Minor Planet Center. Planet maps: Solar System Scope (CC BY 4.0). Place search: OpenStreetMap (Photon). Object descriptions: Wikipedia.</p>
    <h3>Open source</h3>
    <p>Made by Open Apps Studio.</p>`;
}

export function initMenu() {
  $("menu-btn").innerHTML = icon(MDI.mdiMenu);
  $("page-back").innerHTML = icon(MDI.mdiArrowLeft);
  hydrateIcons($("drawer"));
  initPages();
  $("menu-btn").addEventListener("click", () => openDrawer(true));
  $("scrim").addEventListener("click", () => openDrawer(false));
  document.querySelectorAll<HTMLElement>(".drawer-item").forEach((b) =>
    b.addEventListener("click", () => {
      haptic("light");
      openDrawer(false);
      const which = b.dataset.open;
      closePages();
      if (which === "tonight") openObserve("tonight");
      if (which === "calendar") openObserve("calendar");
      if (which === "instruments") openInstruments();
      if (which === "location") openLocation();
      if (which === "settings") openSettings();
      if (which === "about") openPage("About", about);
    }),
  );
}
