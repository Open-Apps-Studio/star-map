/**
 * Observe (Stellarium Mobile Plus's Observe menu):
 *  - Tonight: twilight times, the Moon, when each planet is up, visible
 *    satellite passes and the best deep-sky targets for the night.
 *  - Calendar: the year's sky events (Moon phases, conjunctions,
 *    oppositions, elongations, eclipses, meteor showers, seasons).
 * Tapping anything jumps the sky to that time and object.
 */
import { $, app, haptic, planet, toast } from "../state";
import { altitudeFor, withObserverCopy, type SweObj } from "../engine";
import { dateToMjd, fmtTime, mjdToDate, moonPhaseName, compass } from "../astro";
import { computeEvents, loadMeteorShowers, nightOf, satellitePasses, type Night, type SkyEvent } from "../events";
import { loadIndex } from "../search-index";
import { resolve } from "../catalog";
import { icon, MDI, objectIcon, planetColor } from "../icons";
import { closePages, el, pushPage, refreshPage, section, segmented } from "./page";
import { updateClock } from "./time";

const R2D = 180 / Math.PI;
const MIN = 1 / 1440;

let tab: "tonight" | "calendar" = "tonight";
/** Which night Tonight shows: offset in days from the current view time. */
let nightOffset = 0;

/** Go to a time and object, close the page. */
function jump(mjd: number, target?: string | SweObj | null) {
  app.obs.utc = mjd;
  app.core.time_speed = 1;
  updateClock();
  closePages();
  haptic("selection");
  const obj = typeof target === "string" ? app.stel.getObj(target) : target;
  if (obj) {
    app.core.selection = obj;
    ($("center-btn") as HTMLButtonElement).click();
  }
}

const dayLabel = (mjd: number) => mjdToDate(mjd).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

// ---------------------------------------------------------------- tonight
function timeCell(label: string, mjd: number | null) {
  return `<div><div class="caption">${label}</div><div class="big">${mjd == null ? "—" : fmtTime(mjd)}</div></div>`;
}

function planetBars(body: HTMLElement, night: Night) {
  const start = night.sunset - 1 / 24, end = night.sunrise + 1 / 24, span = end - start;
  const wrap = el("div", "tn-rows");
  withObserverCopy(app.stel, (o) => {
    const N = 96;
    for (const name of ["Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"]) {
      const obj = planet(name);
      if (!obj) continue;
      const color = name === "Moon" ? "#e9e6dc" : planetColor(name);
      const segs: string[] = [];
      let runStart: number | null = null;
      for (let i = 0; i <= N; i++) {
        o.utc = start + (i / N) * span;
        const up = altitudeFor(app.stel, obj, o) > 0;
        if (up && runStart == null) runStart = i;
        if ((!up || i === N) && runStart != null) {
          const a = (runStart / N) * 100, b = (i / N) * 100;
          segs.push(`<div class="tn-bar" style="left:${a}%;width:${Math.max(1, b - a)}%;background:${color}"></div>`);
          runStart = null;
        }
      }
      const row = el("button", "tn-row");
      row.innerHTML = `<div class="tn-name"><span class="tn-dot" style="background:${color}"></span>${name}</div><div class="tn-track">${segs.join("")}</div>`;
      row.addEventListener("click", () => jump(app.obs.utc, obj));
      wrap.appendChild(row);
    }
  });
  // Shade the dark part of the night on the tracks.
  if (night.dark != null && night.dawn != null) {
    const a = ((night.dark - start) / span) * 100, b = ((night.dawn - start) / span) * 100;
    wrap.style.setProperty("--dark-a", `${a}%`);
    wrap.style.setProperty("--dark-b", `${b}%`);
  }
  body.appendChild(wrap);
  const axis = el("div", "tn-axis");
  axis.innerHTML = `<div></div><div>${[0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${fmtTime(start + f * span)}</span>`).join("")}</div>`;
  body.appendChild(axis);
}

function moonBox(body: HTMLElement, night: Night) {
  const moon = planet("Moon");
  if (!moon) return;
  const mid = (night.sunset + night.sunrise) / 2;
  const info = withObserverCopy(app.stel, (o) => {
    o.utc = mid;
    const lit = moon.getInfo("phase", o) as number;
    o.utc = mid + 0.25;
    const later = moon.getInfo("phase", o) as number;
    o.utc = night.sunset - 0.25;
    const vis = moon.computeVisibility({ obs: o, startTime: o.tt, endTime: o.tt + 1.25 });
    return { lit, waxing: later > lit, vis, dt: o.tt - o.utc };
  });
  const box = section(body, "Moon");
  const row = el("button", "row");
  const rise = info.vis[0]?.rise, set = info.vis[0]?.set;
  row.innerHTML = `<span class="obj-icon">${objectIcon("moon", { lit: info.lit, waxing: info.waxing })}</span><span class="row-text"><span class="row-label"></span><span class="row-sub"></span></span>`;
  row.querySelector(".row-label")!.textContent = `${moonPhaseName(info.lit, info.waxing)} · ${Math.round(info.lit * 100)}% lit`;
  row.querySelector(".row-sub")!.textContent = [rise ? `Rises ${fmtTime(rise - info.dt)}` : "", set ? `Sets ${fmtTime(set - info.dt)}` : ""].filter(Boolean).join(" · ") || (info.vis.length ? "Up all night" : "Not up tonight");
  row.addEventListener("click", () => jump(app.obs.utc, moon));
  box.appendChild(row);
}

async function passesBox(body: HTMLElement, night: Night) {
  const box = section(body, "Satellite passes", "Visible when the satellite is sunlit and your sky is dark. Brightest first come from the station and visual satellite lists.");
  box.innerHTML = `<div class="row"><span class="row-sub">Working out passes…</span></div>`;
  const index = await loadIndex().catch(() => null);
  if (!index) {
    box.innerHTML = `<div class="row"><span class="row-sub">Satellite data unavailable.</span></div>`;
    return;
  }
  // Let the page paint before the (synchronous) propagation work.
  await new Promise((r) => setTimeout(r, 30));
  const sats = index.filter((h) => h.icon === "satellite");
  const stations = sats.filter((h) => /^(ISS|CSS \(TIANHE\)|HST)$/.test(h.name));
  const bright = sats.filter((h) => typeof h.mag === "number" && !stations.includes(h)).sort((a, b) => (a.mag as number) - (b.mag as number)).slice(0, 25);
  const list = [...stations, ...bright].map((h) => ({ id: h.ids[0], name: h.name === "ISS" ? "International Space Station" : h.name }));
  const passes = satellitePasses(night, list, 17);
  box.innerHTML = "";
  if (!passes.length) {
    box.innerHTML = `<div class="row"><span class="row-sub">No bright passes tonight.</span></div>`;
    return;
  }
  for (const p of passes) {
    const row = el("button", "row" + (p.set < dateToMjd(new Date()) ? " past" : ""));
    row.innerHTML = `<span class="pass-time"></span><span class="row-text"><span class="row-label"></span><span class="row-sub"></span></span>`;
    row.querySelector(".pass-time")!.textContent = fmtTime(p.rise);
    row.querySelector(".row-label")!.textContent = p.name;
    const dur = Math.max(1, Math.round((p.set - p.rise) / MIN));
    row.querySelector(".row-sub")!.textContent = `${compass(p.fromAz)} → ${compass(p.toAz)} · up to ${Math.round(p.maxAlt)}° · ${dur} min${p.mag < 10 ? ` · mag ${p.mag.toFixed(1)}` : ""}`;
    row.addEventListener("click", () => jump(p.peak, p.id));
    box.appendChild(row);
  }
}

function highlightsBox(body: HTMLElement, night: Night) {
  const box = section(body, "Best deep-sky targets", "Bright galaxies, nebulae and clusters well up while it's dark.");
  const from = night.dark ?? night.sunset + 1 / 24, to = night.dawn ?? night.sunrise - 1 / 24;
  const picks: { e: (typeof app.catalog)[number]; obj: SweObj; best: number; alt: number }[] = [];
  withObserverCopy(app.stel, (o) => {
    for (const e of app.catalog) {
      if (e.kind !== "deep-sky") continue;
      const obj = resolve(app.stel, e);
      if (!obj) continue;
      let best = from, alt = -90;
      for (let t = from; t <= to; t += 1 / 48) {
        o.utc = t;
        const a = altitudeFor(app.stel, obj, o) * R2D;
        if (a > alt) {
          alt = a;
          best = t;
        }
      }
      if (alt > 35) picks.push({ e, obj, best, alt });
    }
  });
  const vmag = (o: SweObj) => {
    const v = o.getInfo("vmag");
    return typeof v === "number" && Number.isFinite(v) ? v : 9;
  };
  picks.sort((a, b) => vmag(a.obj) - vmag(b.obj));
  if (!picks.length) {
    box.innerHTML = `<div class="row"><span class="row-sub">No dark hours tonight at this latitude.</span></div>`;
    return;
  }
  for (const p of picks.slice(0, 10)) {
    const row = el("button", "row");
    row.innerHTML = `<span class="pass-time"></span><span class="row-text"><span class="row-label"></span><span class="row-sub"></span></span>`;
    row.querySelector(".pass-time")!.textContent = fmtTime(p.best);
    row.querySelector(".row-label")!.textContent = p.e.name;
    row.querySelector(".row-sub")!.textContent = `${Math.round(p.alt)}° high at best${p.e.blurb ? ` · ${p.e.blurb}` : ""}`;
    row.addEventListener("click", () => jump(p.best, p.obj));
    box.appendChild(row);
  }
}

function tonight(body: HTMLElement) {
  const night = nightOf(app.obs.utc + nightOffset);
  const head = el("div", "tn-head");
  head.innerHTML = `<button class="tn-nav" aria-label="Previous night">‹</button><div class="caption"></div><button class="tn-nav" aria-label="Next night">›</button>`;
  head.querySelector(".caption")!.textContent = `Night of ${mjdToDate(night.sunset).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}`;
  const [prev, next] = head.querySelectorAll("button");
  prev.addEventListener("click", () => ((nightOffset -= 1), refreshPage()));
  next.addEventListener("click", () => ((nightOffset += 1), refreshPage()));
  body.appendChild(head);
  const sun = el("div", "tn-sun four");
  sun.innerHTML = timeCell("Sunset", night.sunset) + timeCell("Dark", night.dark) + timeCell("Dawn", night.dawn) + timeCell("Sunrise", night.sunrise);
  body.appendChild(sun);
  moonBox(body, night);
  body.appendChild(el("h3", "", "Planets"));
  planetBars(body, night);
  passesBox(body, night);
  highlightsBox(body, night);
}

// ---------------------------------------------------------------- calendar
const KIND_ICON: Record<SkyEvent["kind"], string> = {
  moon: MDI.mdiMoonWaningCrescent, season: MDI.mdiEarth, conjunction: MDI.mdiStarFourPoints, opposition: MDI.mdiOrbit,
  elongation: MDI.mdiWeatherSunset, eclipse: MDI.mdiCircleHalfFull, meteors: MDI.mdiMeteor, earth: MDI.mdiWhiteBalanceSunny,
};

let calendarCache: { start: number; lat: number; lon: number; events: SkyEvent[] } | null = null;

async function calendar(body: HTMLElement) {
  const list = el("div");
  body.appendChild(list);
  const start = Math.floor(dateToMjd(new Date()));
  const lat = app.obs.latitude, lon = app.obs.longitude;
  if (!calendarCache || calendarCache.start !== start || calendarCache.lat !== lat || calendarCache.lon !== lon) {
    list.innerHTML = `<p class="caption">Working out the next 12 months…</p>`;
    await loadMeteorShowers();
    await new Promise((r) => setTimeout(r, 30));
    // In monthly chunks so the page stays responsive.
    const events: SkyEvent[] = [];
    for (let m = 0; m < 12; m++) {
      events.push(...computeEvents(start + m * 30.5, 30.5));
      await new Promise((r) => setTimeout(r, 0));
      if (!list.isConnected) return;
    }
    calendarCache = { start, lat, lon, events: events.sort((a, b) => a.mjd - b.mjd) };
  }
  list.innerHTML = "";
  let month = "";
  let box: HTMLElement | null = null;
  for (const ev of calendarCache.events) {
    const d = mjdToDate(ev.mjd);
    const m = d.toLocaleDateString([], { month: "long", year: "numeric" });
    if (m !== month) {
      month = m;
      box = section(list, m);
    }
    const row = el("button", "row cal-row");
    row.innerHTML = `<span class="cal-date"><b></b><span></span></span><span class="cal-ic"></span><span class="row-text"><span class="row-label"></span><span class="row-sub"></span></span>`;
    row.querySelector(".cal-date b")!.textContent = String(d.getDate());
    row.querySelector(".cal-date span")!.textContent = ev.allNight ? "night" : fmtTime(ev.mjd);
    row.querySelector(".cal-ic")!.innerHTML = icon(KIND_ICON[ev.kind]);
    row.querySelector(".row-label")!.textContent = ev.title;
    row.querySelector(".row-sub")!.textContent = ev.detail;
    row.addEventListener("click", () => jump(ev.mjd, ev.target));
    box!.appendChild(row);
  }
  if (!calendarCache.events.length) list.innerHTML = `<p class="caption">No events found.</p>`;
}

export function openObserve(which: "tonight" | "calendar" = "tonight") {
  tab = which;
  nightOffset = 0;
  pushPage("Observe", (body) => {
    segmented(body, [{ value: "tonight", label: "Tonight" }, { value: "calendar", label: "Calendar" }], () => tab, (v) => {
      tab = v;
      refreshPage();
    });
    if (tab === "tonight") tonight(body);
    else calendar(body).catch(() => toast("Couldn't compute the calendar"));
  });
}

export { dayLabel };
