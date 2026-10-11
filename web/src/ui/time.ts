/**
 * Time: the big clock bottom-right and Stellarium Mobile's time sheet —
 * ▲▼ per date/time field (hold to repeat), a speed slider (centre = real
 * time), previous/next night, and a day/night bar coloured by the Sun's real
 * altitude across the day that you can scrub.
 */
import { $, app, haptic, openPanel, planet } from "../state";
import { icon, MDI, objectIcon } from "../icons";
import { dateToMjd, mjdToDate, moonPhaseName } from "../astro";
import { altitudeFor, withObserverCopy } from "../engine";

const D2R = Math.PI / 180;
const MIN = 1 / 1440;

const nowMjd = () => dateToMjd(new Date());
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function isLive(): boolean {
  return Math.abs(app.obs.utc - nowMjd()) < 2 * MIN && app.core.time_speed === 1;
}

export function setNow() {
  app.obs.utc = nowMjd();
  app.core.time_speed = 1;
  syncSpeedSlider();
  haptic("light");
}

/** Clock label (HH:MM in local time) and the "back to now" badge. */
export function updateClock() {
  const d = mjdToDate(app.obs.utc);
  $("time-label").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $("now-badge").hidden = isLive();
  if (!$("time-sheet").hidden) renderFields();
}

function renderFields() {
  const d = mjdToDate(app.obs.utc);
  const v: Record<string, string> = {
    year: String(d.getFullYear()), month: pad(d.getMonth() + 1), day: pad(d.getDate()),
    hour: pad(d.getHours()), minute: pad(d.getMinutes()), second: pad(d.getSeconds()),
  };
  document.querySelectorAll<HTMLElement>(".dt-field").forEach((f) => {
    f.querySelector("span")!.textContent = v[f.dataset.unit!];
  });
  placeThumb();
  renderMoon();
}

/** The Moon's phase on the chosen date (Sky Guide shows it in its date picker). */
let moonKey = "";
function renderMoon() {
  const moon = planet("Moon");
  if (!moon) return;
  const lit = moon.getInfo("phase") as number;
  const later = withObserverCopy(app.stel, (o) => {
    o.utc = app.obs.utc + 0.25;
    return moon.getInfo("phase", o) as number;
  });
  const waxing = later > lit;
  const key = `${Math.round(lit * 100)}${waxing}`;
  if (key === moonKey) return;
  moonKey = key;
  $("dt-moon").innerHTML = `<span class="obj-icon">${objectIcon("moon", { lit, waxing })}</span><span></span>`;
  $("dt-moon").lastElementChild!.textContent = `${moonPhaseName(lit, waxing)} · ${Math.round(lit * 100)}% lit`;
}

/** Step one calendar field, like Stellarium's ▲/▼. */
function step(unit: string, dir: 1 | -1) {
  const d = mjdToDate(app.obs.utc);
  switch (unit) {
    case "year": d.setFullYear(d.getFullYear() + dir); break;
    case "month": {
      // Clamp the day so 31 Jan + 1 month is 28/29 Feb, not 3 Mar.
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + dir);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      break;
    }
    case "day": d.setDate(d.getDate() + dir); break;
    case "hour": d.setHours(d.getHours() + dir); break;
    case "minute": d.setMinutes(d.getMinutes() + dir); break;
    case "second": d.setSeconds(d.getSeconds() + dir); break;
  }
  app.obs.utc = dateToMjd(d);
  renderFields();
  updateClock();
  buildDaybar();
}

/** Hold-to-repeat for ▲/▼ buttons. */
function repeatOnHold(el: HTMLElement, fn: () => void) {
  let timer = 0;
  let delay = 0;
  const stop = () => clearTimeout(timer);
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    fn();
    haptic("selection");
    delay = 380;
    const tick = () => {
      fn();
      delay = Math.max(45, delay * 0.82);
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, delay);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(ev, stop);
  document.addEventListener("visibilitychange", stop);
}

// ---------------------------------------------------------------- speed
/**
 * Slider value -100..100 → time speed. 0 = real time (1×), and it grows
 * exponentially to ±10,000× at the ends (about 3 hours per second).
 */
const sliderToSpeed = (v: number) => (v === 0 ? 1 : Math.sign(v) * Math.pow(10000, Math.abs(v) / 100));
const speedToSlider = (s: number) => (s === 1 ? 0 : Math.round((Math.sign(s) * Math.log(Math.max(1, Math.abs(s))) / Math.log(10000)) * 100));

function speedLabel(s: number): string {
  if (s === 0) return "Paused";
  if (s === 1) return "Real time speed";
  const a = Math.abs(s);
  const txt = a < 60 ? `${Math.round(a)}×` : a < 3600 ? `${Math.round(a / 60)} min/s` : `${(a / 3600).toFixed(1)} h/s`;
  return (s < 0 ? "Backwards " : "") + txt;
}

function syncSpeedSlider() {
  const s = app.core.time_speed as number;
  ($("speed") as HTMLInputElement).value = String(speedToSlider(s === 0 ? 1 : s));
  $("speed-label").textContent = speedLabel(s);
  $("pause-btn").innerHTML = icon(s === 0 ? MDI.mdiPlay : MDI.mdiPause);
}

// ---------------------------------------------------------------- night jumps
/** Local midnight-ish anchor: the night that contains (or follows) the time. */
function nightCentre(mjd: number): number {
  const d = mjdToDate(mjd);
  d.setHours(d.getHours() < 12 ? 0 : 24, 0, 0, 0);
  return dateToMjd(d);
}

/** Jump to ~1 h after sunset of the previous/next night. */
function jumpNight(dir: 1 | -1) {
  const centre = nightCentre(app.obs.utc) + dir;
  app.obs.utc = sunsetBefore(centre) + 1 / 24;
  renderFields();
  updateClock();
  buildDaybar();
  haptic("light");
}

/** Sun altitude (degrees) at a given MJD, computed on an observer copy. */
function sunAltAt(mjd: number, copy?: any): number {
  const sun = planet("Sun");
  if (!sun) return 0;
  const run = (o: any) => {
    o.utc = mjd;
    return altitudeFor(app.stel, sun, o) / D2R;
  };
  return copy ? run(copy) : withObserverCopy(app.stel, run);
}

function sunsetBefore(centre: number): number {
  // Walk back from midnight in 10-minute steps until the Sun is up.
  return withObserverCopy(app.stel, (o) => {
    for (let t = centre; t > centre - 0.75; t -= 10 * MIN) if (sunAltAt(t, o) > -0.833) return t;
    return centre - 4 / 24;
  });
}

// ---------------------------------------------------------------- day/night bar
/** The bar spans noon → noon around the selected night. */
let barStart = 0;
const BAR_SPAN = 1;

function altColor(alt: number): string {
  // Day: teal. Twilight fades to black at -18°.
  if (alt >= 0) return "rgb(44,122,144)";
  const t = Math.max(0, 1 + alt / 18);
  return `rgb(${Math.round(44 * t)},${Math.round(122 * t)},${Math.round(144 * t)})`;
}

export function buildDaybar() {
  if ($("time-sheet").hidden) return;
  barStart = nightCentre(app.obs.utc) - 0.5;
  const stops: string[] = [];
  const N = 48;
  withObserverCopy(app.stel, (o) => {
    for (let i = 0; i <= N; i++) stops.push(`${altColor(sunAltAt(barStart + (i / N) * BAR_SPAN, o))} ${((i / N) * 100).toFixed(1)}%`);
  });
  $("daybar").style.background = `linear-gradient(90deg, ${stops.join(",")})`;
  placeThumb();
}

function placeThumb() {
  const f = Math.min(1, Math.max(0, (app.obs.utc - barStart) / BAR_SPAN));
  $("daybar-thumb").style.left = `${f * 100}%`;
  const [alt, later] = withObserverCopy(app.stel, (o) => [sunAltAt(app.obs.utc, o), sunAltAt(app.obs.utc + 10 * MIN, o)]);
  const rising = later > alt;
  $("daybar-caption").textContent =
    alt > 0 ? "Day" : alt > -6 ? (rising ? "Dawn" : "Dusk") : alt > -18 ? (rising ? "Morning twilight" : "Evening twilight") : "Night";
}

function initDaybar() {
  const bar = $("daybar");
  const set = (e: PointerEvent) => {
    const r = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    app.obs.utc = barStart + f * BAR_SPAN;
    renderFields();
    updateClock();
  };
  bar.addEventListener("pointerdown", (e) => {
    bar.setPointerCapture(e.pointerId);
    set(e);
  });
  bar.addEventListener("pointermove", (e) => {
    if (bar.hasPointerCapture(e.pointerId)) set(e);
  });
}

// ---------------------------------------------------------------- wiring
export function openTime() {
  openPanel("time-sheet");
  syncSpeedSlider();
  renderFields();
  buildDaybar();
}

export function initTime() {
  document.querySelectorAll<HTMLElement>(".dt-field").forEach((f) => {
    const up = f.querySelector<HTMLElement>(".up")!;
    const down = f.querySelector<HTMLElement>(".down")!;
    up.innerHTML = icon(MDI.mdiMenuUp);
    down.innerHTML = icon(MDI.mdiMenuDown);
    repeatOnHold(up, () => step(f.dataset.unit!, 1));
    repeatOnHold(down, () => step(f.dataset.unit!, -1));
  });
  $("now-badge").innerHTML = icon(MDI.mdiRestore);
  $("speed-reset").innerHTML = icon(MDI.mdiRestore);
  const [prev, now, next] = ["prev-night", "set-now", "next-night"].map((id) => $(id).querySelector(".ic") as HTMLElement);
  prev.innerHTML = icon(MDI.mdiSkipPrevious);
  now.innerHTML = icon(MDI.mdiHistory);
  next.innerHTML = icon(MDI.mdiSkipNext);

  $("time-btn").addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("#now-badge")) {
      setNow();
      buildDaybar();
      return;
    }
    $("time-sheet").hidden ? openTime() : openPanel(null);
  });
  $("set-now").addEventListener("click", () => {
    setNow();
    renderFields();
    buildDaybar();
  });
  $("prev-night").addEventListener("click", () => jumpNight(-1));
  $("next-night").addEventListener("click", () => jumpNight(1));
  $("pause-btn").addEventListener("click", () => {
    app.core.time_speed = app.core.time_speed === 0 ? 1 : 0;
    syncSpeedSlider();
    haptic("light");
  });
  $("speed-reset").addEventListener("click", () => {
    app.core.time_speed = 1;
    syncSpeedSlider();
    haptic("light");
  });
  const slider = $("speed") as HTMLInputElement;
  slider.addEventListener("input", () => {
    // Snap to real time near the centre.
    let v = Number(slider.value);
    if (Math.abs(v) < 6) v = 0;
    app.core.time_speed = sliderToSpeed(v);
    $("speed-label").textContent = speedLabel(app.core.time_speed);
  });
  slider.addEventListener("change", () => syncSpeedSlider());
  initDaybar();
}
