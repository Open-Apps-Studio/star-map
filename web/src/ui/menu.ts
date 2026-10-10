/**
 * ☰ drawer: Tonight (planet visibility across the night, like Stellarium
 * Mobile's observing view), Location, About.
 */
import { $, app, haptic, planet } from "../state";
import { hydrateIcons, icon, MDI, planetColor } from "../icons";
import { altitudeFor, withObserverCopy } from "../engine";
import { dateToMjd, fmtTime, mjdToDate } from "../astro";

const D2R = Math.PI / 180;
const MIN = 1 / 1440;

function openDrawer(on: boolean) {
  $("drawer").classList.toggle("open", on);
  $("scrim").hidden = !on;
  if (on) {
    const lat = app.obs.latitude / D2R, lon = app.obs.longitude / D2R;
    $("drawer-loc").textContent = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  }
}

function openPage(title: string, html: string) {
  openDrawer(false);
  $("page-title").textContent = title;
  $("page-body").innerHTML = html;
  $("page").hidden = false;
}

// ---------------------------------------------------------------- Tonight
/** Sunset → sunrise for the night that contains (or follows) the view time. */
function nightWindow(o: any): { set: number; rise: number } {
  const d = mjdToDate(app.obs.utc);
  d.setHours(d.getHours() < 12 ? 0 : 24, 0, 0, 0);
  const mid = dateToMjd(d);
  const sun = planet("Sun")!;
  const altAt = (t: number) => ((o.utc = t), altitudeFor(app.stel, sun, o) / D2R);
  let set = mid - 0.25, rise = mid + 0.25;
  for (let t = mid; t > mid - 0.75; t -= 5 * MIN) if (altAt(t) > -0.833) { set = t; break; }
  for (let t = mid; t < mid + 0.75; t += 5 * MIN) if (altAt(t) > -0.833) { rise = t; break; }
  return { set, rise };
}

function tonightHtml(): string {
  return withObserverCopy(app.stel, (o) => {
    const { set, rise } = nightWindow(o);
    // Show 1 h either side of the night.
    const start = set - 1 / 24, end = rise + 1 / 24, span = end - start;
    const N = 96;
    const rows = ["Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"].map((name) => {
      const obj = planet(name);
      if (!obj) return "";
      const segs: string[] = [];
      let runStart: number | null = null;
      for (let i = 0; i <= N; i++) {
        o.utc = start + (i / N) * span;
        const up = altitudeFor(app.stel, obj, o) > 0;
        if (up && runStart == null) runStart = i;
        if ((!up || i === N) && runStart != null) {
          const a = (runStart / N) * 100, b = (i / N) * 100;
          segs.push(`<div class="tn-bar" style="left:${a}%;width:${Math.max(1, b - a)}%;background:${name === "Moon" ? "#e9e6dc" : planetColor(name)}"></div>`);
          runStart = null;
        }
      }
      return `<div class="tn-row"><div class="tn-name"><span class="tn-dot" style="background:${name === "Moon" ? "#e9e6dc" : planetColor(name)}"></span>${name}</div><div class="tn-track">${segs.join("")}</div></div>`;
    });
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${fmtTime(start + f * span)}</span>`).join("");
    const day = mjdToDate(set).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    return `<div class="caption" style="margin:4px 0 10px">Night of ${day}</div>
      <div class="tn-sun"><div><div class="caption">Sunset</div><div class="big">${fmtTime(set)}</div></div><div><div class="caption">Sunrise</div><div class="big">${fmtTime(rise)}</div></div></div>
      <h3>Solar system</h3><div class="tn-rows">${rows.join("")}</div><div class="tn-axis"><div></div><div>${ticks}</div></div>
      <p class="caption" style="margin-top:14px">Bars show when each body is above the horizon. Tap the clock on the sky view to travel to any time.</p>`;
  });
}

// ---------------------------------------------------------------- Location
function locationHtml(): string {
  const lat = app.obs.latitude / D2R, lon = app.obs.longitude / D2R;
  return `<h3>Current</h3><div style="font-size:22px">${lat.toFixed(4)}°, ${lon.toFixed(4)}°</div>
    <p class="caption">Elevation ${Math.round(app.obs.elevation)} m. Star Map uses your phone's location automatically; the sky is computed for exactly this spot.</p>`;
}

function aboutHtml(): string {
  return `<p>Star Map is a free star map for friends, with no ads, accounts or paywalls.</p>
    <h3>Built on</h3>
    <p><a href="https://github.com/Stellarium/stellarium-web-engine">Stellarium Web Engine</a> (AGPL-3.0) by Stellarium Labs, compiled to run fully on your phone.</p>
    <h3>Data</h3>
    <p>Stars: Hipparcos / Gaia via Stellarium. Deep-sky objects: Stellarium DSO catalogue. Satellite orbits: CelesTrak. Comets: Minor Planet Center. Constellation art: Stellarium western sky culture. Object descriptions: Wikipedia (when online).</p>
    <h3>Open source</h3>
    <p>Made by Open Apps Studio.</p>`;
}

export function initMenu() {
  $("menu-btn").innerHTML = icon(MDI.mdiMenu);
  $("page-back").innerHTML = icon(MDI.mdiArrowLeft);
  hydrateIcons($("drawer"));
  $("menu-btn").addEventListener("click", () => openDrawer(true));
  $("scrim").addEventListener("click", () => openDrawer(false));
  $("page-back").addEventListener("click", () => ($("page").hidden = true));
  document.querySelectorAll<HTMLElement>(".drawer-item").forEach((b) =>
    b.addEventListener("click", () => {
      haptic("light");
      const which = b.dataset.open;
      if (which === "tonight") openPage("Tonight", tonightHtml());
      if (which === "location") openPage("Location", locationHtml());
      if (which === "about") openPage("About", aboutHtml());
    }),
  );
}
