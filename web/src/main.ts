/**
 * Star Map sky page: boots Stellarium Web Engine and adds the things that make
 * it a phone stargazing app — point-at-the-sky, tap to identify, search with a
 * guide arrow, a time scrubber, a "Tonight" strip and red night mode.
 */
import "./style.css";
import { abs, azAlt, bootEngine, D2R, displayName, knownNames, R2D, type Stel, type SweObj } from "./engine";
import { createSensors, type View, type Vec3 } from "./sensors";
import { buildCatalog, isResolved, resolve, search, type Entry, type Kind } from "./catalog";
import { dateToMjd, fmtTime, moonPhaseName, whereText, compass, mjdToDate } from "./astro";
import { inApp, listen, post } from "./bridge";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("stel-canvas");
let stel: Stel;
/** Cached wrappers: every `stel.core` read builds a new object, so read once. */
let core: any;
let obs: any;
// Push each reading straight into the engine (before its next frame).
const sensors = createSensors((v) => {
  obs.yaw = v.yaw;
  obs.pitch = v.pitch;
  obs.roll = v.roll;
});
let catalog: Entry[] = [];
/** Search result the user asked us to guide them to (sensor mode). */
let guideTarget: { obj: SweObj; name: string } | null = null;
let guideLockedAt = 0;
let kindByObj = new Map<string, Kind>();

// ---------------------------------------------------------------- location
const FALLBACK = { lat: 41.0082, lon: 28.9784, alt: 40 }; // Istanbul

function setLocation(lat: number, lon: number, alt = 0) {
  obs.latitude = lat * D2R;
  obs.longitude = lon * D2R;
  obs.elevation = alt;
  try {
    localStorage.setItem("loc", JSON.stringify({ lat, lon, alt }));
  } catch {
    /* private mode */
  }
  refreshTonight();
}

function initLocation() {
  let saved = FALLBACK;
  try {
    saved = JSON.parse(localStorage.getItem("loc") ?? "null") ?? FALLBACK;
  } catch {
    /* ignore */
  }
  setLocation(saved.lat, saved.lon, saved.alt);
  if (!inApp() && "geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (p) => setLocation(p.coords.latitude, p.coords.longitude, p.coords.altitude ?? 0),
      () => {},
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 3600_000 },
    );
  }
}

// ---------------------------------------------------------------- view maths
const enu = (az: number, alt: number): Vec3 => [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Current camera basis, from sensors or from the engine's own yaw/pitch. */
function currentView(): Pick<View, "forward" | "right" | "up"> {
  const y = obs.yaw as number;
  const p = obs.pitch as number;
  const r = (obs.roll as number) || 0;
  const forward = enu(y, p);
  const refUp: Vec3 = [-Math.sin(p) * Math.sin(y), -Math.sin(p) * Math.cos(y), Math.cos(p)];
  const refRight: Vec3 = [Math.cos(y), -Math.sin(y), 0];
  const up: Vec3 = [0, 1, 2].map((i) => Math.cos(r) * refUp[i] + Math.sin(r) * refRight[i]) as Vec3;
  const right: Vec3 = [0, 1, 2].map((i) => Math.cos(r) * refRight[i] - Math.sin(r) * refUp[i]) as Vec3;
  return { forward, right, up };
}

// ---------------------------------------------------------------- sensor mode
const pointBtn = $("point-btn");

async function setSensorMode(on: boolean) {
  if (on) {
    const ok = await sensors.start(inApp());
    if (!ok) {
      toast("Motion access was denied. Enable it in Settings › Safari › Motion & Orientation.");
      return;
    }
    core.lock = 0;
    // ~40° across the short side feels like looking through a window.
    stel.zoomTo(40 * D2R, 0.6);
    core.selection = 0;
    document.body.classList.add("sensor");
    toast("Hold your phone up to the sky");
  } else {
    sensors.stop();
    obs.roll = 0;
    guideTarget = null;
    document.body.classList.remove("sensor");
  }
  pointBtn.setAttribute("aria-pressed", String(on));
  post({ type: "sensor-mode", on });
}
pointBtn.addEventListener("click", () => setSensorMode(!sensors.active));

// While the phone drives the view, finger drags would fight it. Swallow moves
// (capture phase, before the engine's listeners) but let taps through.
for (const ev of ["touchmove", "mousemove", "wheel"]) {
  canvas.addEventListener(
    ev,
    (e) => {
      if (sensors.active) e.stopImmediatePropagation();
    },
    { capture: true },
  );
}

// ---------------------------------------------------------------- view offset
/**
 * When the info card is open (and the phone isn't driving the view), shift
 * the rendered view so the selected object sits midway between the top of the
 * screen and the card instead of hiding behind it. Stored as a fraction of
 * screen height and converted with the (vertical) field of view every frame.
 */
let offsetFrac = 0;
let lastFov = 0;
function targetOffsetFrac(): number {
  if (!cardObj || sensors.active) return 0;
  const h = window.innerHeight;
  const cardTop = card.getBoundingClientRect().top;
  // Pixels to shift, as a fraction of the screen's short side (the engine's
  // fov spans the short side: width in portrait, height in landscape).
  return Math.max(0, (h / 2 - cardTop / 2) / Math.min(h, window.innerWidth));
}

// ---------------------------------------------------------------- frame loop
let lastUi = 0;
function frame(t: number) {
  const target = targetOffsetFrac();
  const fovNow = core.fov as number;
  if (Math.abs(target - offsetFrac) > 1e-4 || fovNow !== lastFov) {
    offsetFrac = Math.abs(target - offsetFrac) > 1e-4 ? offsetFrac + (target - offsetFrac) * 0.12 : target;
    obs.view_offset_alt = offsetFrac * fovNow;
    lastFov = fovNow;
  }
  updateGuide();
  if (t - lastUi > 250) {
    lastUi = t;
    updateCardLive();
    updateTimeLabel();
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- guide arrow
const guide = $("guide");
const guideArrow = $("guide-arrow");
const guideLabel = $("guide-label");

function updateGuide() {
  if (!guideTarget || !sensors.active) {
    guide.hidden = true;
    return;
  }
  const { az, alt } = azAlt(stel, guideTarget.obj);
  const t = enu(az, alt);
  const v = currentView();
  const x = dot(t, v.right);
  const y = dot(t, v.up);
  const z = dot(t, v.forward);
  const off = Math.acos(Math.max(-1, Math.min(1, z))) * R2D;
  guide.hidden = false;
  // Lock under 3°, release over 5°, so the haptic doesn't stutter at the edge.
  const centred = guideLockedAt ? off < 5 : off < 3;
  guide.classList.toggle("centred", centred);
  if (centred) {
    guideLabel.textContent = guideTarget.name;
    if (!guideLockedAt) {
      guideLockedAt = Date.now();
      post({ type: "haptic", style: "success" });
      core.selection = guideTarget.obj;
    }
  } else {
    guideLockedAt = 0;
    const angle = Math.atan2(-y, x) * R2D; // CSS: y grows downwards
    guideArrow.style.transform = `rotate(${angle}deg)`;
    guideLabel.textContent = `${guideTarget.name} · ${Math.round(off)}°`;
  }
}

// ---------------------------------------------------------------- object card
const card = $("card");
let cardObj: SweObj | null = null;

function kindOf(obj: SweObj): string {
  const names = obj.designations();
  const known = kindByObj.get(names[0]);
  if (known === "planet") return names[0].includes("Moon") ? "Moon" : names[0].includes("Sun") ? "Star" : "Planet";
  if (known === "satellite") return "Satellite";
  if (names[0]?.startsWith("CON ")) return "Constellation";
  try {
    const t = obj.jsonData?.types?.[0];
    if (t) return stel.otypeToStr(t);
  } catch {
    /* fall through */
  }
  return "Object";
}

function blurbFor(obj: SweObj): string | undefined {
  const names = obj.designations();
  const entry = catalog.find((e) => e.ids.some((id) => names.includes(id) || names.includes(id.replace(/^NAME /, "NAME "))));
  return entry?.blurb;
}

function showCard(obj: SweObj | null) {
  cardObj = obj;
  if (!obj) {
    card.classList.remove("open");
    return;
  }
  $("card-name").textContent = displayName(obj);
  $("card-kind").textContent = kindOf(obj);
  const blurb = blurbFor(obj);
  $("card-blurb").textContent = blurb ?? "";
  $("card-blurb").hidden = !blurb;
  updateCardLive();
  card.classList.add("open");
  post({ type: "haptic", style: "selection" });
}

function updateCardLive() {
  if (!cardObj) return;
  const obj = cardObj;
  const facts: string[] = [];
  try {
    const { az, alt } = azAlt(stel, obj);
    $("card-where").textContent = whereText(az, alt);
    const vmag = obj.getInfo("vmag");
    if (typeof vmag === "number" && Number.isFinite(vmag)) facts.push(`Brightness ${vmag.toFixed(1)} mag`);
    const dist = obj.getInfo("distance");
    if (typeof dist === "number" && dist > 0) facts.push(distanceText(dist));
    facts.push(...riseSetFacts(obj));
    if (displayName(obj) === "Moon") {
      const ph = obj.getInfo("phase");
      if (typeof ph === "number") facts.push(`${Math.round(ph * 100)}% lit`);
    }
  } catch {
    $("card-where").textContent = "";
  }
  $("card-facts").innerHTML = facts.map((f) => `<span>${f}</span>`).join("");
}

/** Next rise and set in the coming 24 h, from the engine's own event solver (TT → UTC). */
function riseSetFacts(obj: SweObj): string[] {
  const kind = kindByObj.get(obj.designations()[0]);
  if (obj.designations()[0]?.startsWith("CON ")) return [];
  const ttMinusUtc = (obs.tt as number) - (obs.utc as number);
  const vis = obj.computeVisibility({ startTime: obs.tt, endTime: obs.tt + 1 });
  if (!vis.length) return ["Doesn't rise today"];
  const { rise, set } = vis[0];
  if (rise == null && set == null) return [kind === "satellite" ? "" : "Up all day"].filter(Boolean);
  const out: string[] = [];
  if (rise != null) out.push(`Rises ${fmtTime(rise - ttMinusUtc)}`);
  if (set != null) out.push(`Sets ${fmtTime(set - ttMinusUtc)}`);
  return [out.join(" · ")];
}

/** Engine distances are in AU. */
function distanceText(au: number): string {
  const LY = 63241.077;
  if (au < 0.01) return `${Math.round(au * 149597870.7).toLocaleString()} km away`;
  if (au < 1000) return `${au.toFixed(au < 10 ? 2 : 1)} AU away`;
  const ly = au / LY;
  if (ly < 1e4) return `${Math.round(ly).toLocaleString()} light-years away`;
  if (ly < 1e6) return `${Math.round(ly / 1000).toLocaleString()} thousand light-years away`;
  return `${(ly / 1e6).toFixed(1)} million light-years away`;
}

$("card-close").addEventListener("click", () => {
  core.selection = 0;
  guideTarget = null;
});
$("card-find").addEventListener("click", () => {
  if (cardObj) findObject(cardObj, displayName(cardObj));
});

// ---------------------------------------------------------------- finding things
function findObject(obj: SweObj, name: string, kind?: Kind) {
  const first = obj.designations()[0];
  if (first) knownNames.set(first, name);
  if (sensors.active) {
    // Phone mode: guide first, show the card once it's centred.
    core.selection = 0;
    guideTarget = { obj, name };
    guideLockedAt = 0;
    toast(`Follow the arrow to ${name}`);
    return;
  }
  core.selection = obj;
  stel.pointAndLock(obj, 1.2);
  const fov = kind === "constellation" ? 60 : kind === "deep-sky" ? 12 : kind === "planet" ? 25 : 35;
  stel.zoomTo(fov * D2R, 1.6);
}

// ---------------------------------------------------------------- search
const searchPanel = $("search-panel");
const searchInput = $<HTMLInputElement>("search-input");
const results = $("search-results");

const KIND_LABEL: Record<Kind, string> = {
  planet: "Solar system",
  star: "Star",
  constellation: "Constellation",
  "deep-sky": "Deep sky",
  satellite: "Satellite",
};

function openSearch() {
  searchPanel.hidden = false;
  searchInput.value = "";
  renderResults(defaultSuggestions());
  setTimeout(() => searchInput.focus(), 50);
}
function closeSearch() {
  searchPanel.hidden = true;
  searchInput.blur();
}

function defaultSuggestions(): Entry[] {
  const names = ["Moon", "Jupiter", "Saturn", "Mars", "Venus", "Polaris", "Orion", "Andromeda Galaxy", "Pleiades", "Sirius", "International Space Station"];
  return names.map((n) => catalog.find((e) => e.name === n)).filter(Boolean) as Entry[];
}

function renderResults(list: Entry[]) {
  results.innerHTML = "";
  for (const e of list) {
    const obj = resolve(stel, e);
    const li = document.createElement("li");
    let where = "";
    if (obj) {
      try {
        const { az, alt } = azAlt(stel, obj);
        where = alt > 0 ? `${Math.round(alt * R2D)}° up · ${compass(az)}` : "below horizon";
      } catch {
        /* constellations etc. may not have a position */
      }
    }
    li.innerHTML = `<button><span class="r-name"></span><span class="r-meta"></span></button>`;
    li.querySelector(".r-name")!.textContent = e.name;
    li.querySelector(".r-meta")!.textContent = [KIND_LABEL[e.kind], where].filter(Boolean).join(" · ");
    li.querySelector("button")!.addEventListener("click", () => {
      // Stars only resolve once their sky tiles have loaded, so resolve again
      // on tap and retry briefly instead of disabling the row.
      closeSearch();
      let tries = 0;
      const attempt = () => {
        const o = obj ?? resolve(stel, e);
        if (o) findObject(o, e.name, e.kind);
        else if (++tries < 10) setTimeout(attempt, 300);
        else toast(`Couldn't find ${e.name} yet`);
      };
      attempt();
    });
    results.appendChild(li);
  }
  if (!list.length) results.innerHTML = `<li class="empty">Nothing found. Try “Mars”, “Orion” or “M31”.</li>`;
}

$("search-btn").addEventListener("click", openSearch);
$("search-cancel").addEventListener("click", closeSearch);
searchInput.addEventListener("input", () => {
  const q = searchInput.value;
  renderResults(q.trim() ? search(catalog, q) : defaultSuggestions());
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") (results.querySelector("button:not([disabled])") as HTMLButtonElement | null)?.click();
  if (e.key === "Escape") closeSearch();
});

// ---------------------------------------------------------------- time
const timeLabel = $("time-label");
const timeDelta = $("time-delta");
const scrub = $("scrub");
let scrubbing: { x: number; utc: number } | null = null;

function updateTimeLabel() {
  const utc = obs.utc as number;
  const d = mjdToDate(utc);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  timeLabel.textContent = (sameDay ? "Today " : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " ") + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const diffMin = Math.round((utc - dateToMjd(now)) * 1440);
  const live = Math.abs(diffMin) < 2;
  document.body.classList.toggle("live", live);
  if (live) timeDelta.textContent = "Live";
  else {
    const sign = diffMin > 0 ? "+" : "−";
    const m = Math.abs(diffMin);
    timeDelta.textContent = m < 60 ? `${sign}${m} min` : m < 2880 ? `${sign}${Math.floor(m / 60)}h ${m % 60}m` : `${sign}${Math.round(m / 1440)} days`;
  }
}

scrub.addEventListener("pointerdown", (e) => {
  scrubbing = { x: e.clientX, utc: obs.utc };
  scrub.setPointerCapture(e.pointerId);
  document.body.classList.add("scrubbing");
});
scrub.addEventListener("pointermove", (e) => {
  if (!scrubbing) return;
  const dx = e.clientX - scrubbing.x;
  // Gently accelerating: 100 px ≈ 2.5 h, 180 px ≈ 5 h, 360 px ≈ 14 h.
  const ax = Math.abs(dx);
  const minutes = Math.sign(dx) * (ax * 1.2 + (ax / 100) ** 2 * 30);
  obs.utc = scrubbing.utc + minutes / 1440;
  scrub.style.setProperty("--offset", `${dx}px`);
  updateTimeLabel();
});
const endScrub = () => {
  if (!scrubbing) return;
  scrubbing = null;
  scrub.style.setProperty("--offset", "0px");
  document.body.classList.remove("scrubbing");
  refreshTonight();
};
scrub.addEventListener("pointerup", endScrub);
scrub.addEventListener("pointercancel", endScrub);
$("now-btn").addEventListener("click", () => {
  obs.utc = dateToMjd(new Date());
  core.time_speed = 1;
  refreshTonight();
  post({ type: "haptic", style: "light" });
});

/** Solar-system objects, looked up once (each getObj returns a retained ref). */
const planets = new Map<string, SweObj | null>();
function planet(name: string): SweObj | null {
  if (!planets.has(name) || !planets.get(name)) planets.set(name, stel.getObj(`NAME ${name}`));
  return planets.get(name) ?? null;
}

// ---------------------------------------------------------------- first view
/**
 * Open facing something worth seeing: the brightest planet or the Moon that's
 * up, else due south. Tilt so the horizon sits near the bottom of the screen.
 */
function faceBestTarget() {
  let best: { az: number; mag: number } | null = null;
  for (const n of ["Moon", "Venus", "Jupiter", "Mars", "Saturn", "Mercury"]) {
    const o = planet(n);
    if (!o) continue;
    const { az, alt } = azAlt(stel, o);
    if (alt < 10 * D2R) continue;
    const mag = o.getInfo("vmag") as number;
    if (!best || mag < best.mag) best = { az, mag };
  }
  // fov spans the short side; keep portrait phones from looking fisheye.
  const portrait = window.innerHeight > window.innerWidth;
  core.fov = (portrait ? 75 : 100) * D2R;
  obs.yaw = best ? best.az : Math.PI;
  obs.pitch = (portrait ? 48 : 42) * D2R;
}

// ---------------------------------------------------------------- tonight strip
const tonight = $("tonight");
const PLANET_NAMES = ["Moon", "Venus", "Jupiter", "Saturn", "Mars", "Mercury"];

function refreshTonight() {
  if (!stel || !catalog.length) return;
  const chips: string[] = [];
  const items: { name: string; obj: SweObj }[] = [];
  for (const n of PLANET_NAMES) {
    const obj = planet(n);
    if (!obj) continue;
    const { az, alt } = azAlt(stel, obj);
    if (alt < 2 * D2R) continue;
    let label = `${n} <em>${compass(az)} ${Math.round(alt * R2D)}°</em>`;
    if (n === "Moon") {
      const ph = obj.getInfo("phase") as number;
      const later = (() => {
        const obs = core.observer;
        const u = obs.utc;
        obs.utc = u + 0.25;
        const p2 = obj.getInfo("phase") as number;
        obs.utc = u;
        return p2;
      })();
      label = `${moonPhaseName(ph, later > ph)} <em>${compass(az)} ${Math.round(alt * R2D)}°</em>`;
    }
    items.push({ name: n, obj });
    chips.push(`<button class="chip" data-name="${n}">${label}</button>`);
  }
  const sun = planet("Sun");
  const sunAlt = sun ? azAlt(stel, sun).alt * R2D : -90;
  const head = sunAlt > -6 ? (sunAlt > 0 ? "Daytime sky" : "Twilight") : "Up now";
  tonight.innerHTML = `<span class="tonight-head">${head}</span>` + (chips.length ? chips.join("") : `<span class="chip muted">No bright planets up</span>`);
  tonight.querySelectorAll<HTMLButtonElement>(".chip[data-name]").forEach((b) => {
    b.addEventListener("click", () => {
      const it = items.find((i) => i.name === b.dataset.name);
      if (it) findObject(it.obj, it.name, "planet");
    });
  });
}

/**
 * Resolve every catalog star in the background (tiles load on demand) so that
 * tapping one shows its proper name ("Acrux", not "α¹ Cru").
 */
function prefetchStarNames(round = 0) {
  let missing = 0;
  for (const e of catalog) {
    if (e.kind !== "star" || isResolved(e)) continue;
    const o = resolve(stel, e);
    if (!o) {
      missing++;
      continue;
    }
    const first = o.designations()[0];
    if (first && !knownNames.has(first)) knownNames.set(first, e.name);
  }
  if (missing && round < 20) setTimeout(() => prefetchStarNames(round + 1), 500);
}

// ---------------------------------------------------------------- night mode & misc
$("night-btn").addEventListener("click", () => {
  const on = document.body.classList.toggle("night");
  $("night-btn").setAttribute("aria-pressed", String(on));
  post({ type: "haptic", style: "light" });
});
$("layers-btn").addEventListener("click", () => {
  const c = core.constellations;
  // Cycle: lines+art → lines only → nothing → lines+art
  if (c.images_visible) c.images_visible = false;
  else if (c.lines_visible) {
    c.lines_visible = false;
    c.labels_visible = false;
  } else {
    c.lines_visible = true;
    c.labels_visible = true;
    c.images_visible = true;
  }
  post({ type: "haptic", style: "light" });
});

let toastTimer = 0;
function toast(text: string) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------------------------------------------------------------- boot
async function main() {
  try {
    stel = await bootEngine(canvas);
    core = stel.core;
    obs = stel.observer ?? core.observer;
  } catch (e) {
    $("loading").textContent = "Your browser can't run the sky engine (WebGL + WebAssembly needed).";
    throw e;
  }
  (window as any).stel = stel; // handy in the console
  obs.utc = dateToMjd(new Date());
  initLocation();

  catalog = await buildCatalog(abs("skydata/"));
  for (const e of catalog) for (const id of e.ids) kindByObj.set(id, e.kind);
  prefetchStarNames();

  stel.change((_obj, attr) => {
    if (attr === "selection") {
      const sel = core.selection as SweObj | null;
      showCard(sel && sel.v ? sel : null);
      if (!sel && !sensors.active) guideTarget = null;
    }
  });

  listen((msg) => {
    if (msg.type === "motion") sensors.pushNativeMatrix(msg.m);
    if (msg.type === "location") setLocation(msg.lat, msg.lon, msg.alt ?? 0);
    if (msg.type === "calibrate") toast("Compass needs calibrating: wave your phone in a figure-8");
    if (msg.type === "north" && msg.magnetic) toast("Allow location in Settings for accurate north");
  });

  faceBestTarget();
  refreshTonight();
  setInterval(refreshTonight, 30_000);
  requestAnimationFrame(frame);
  document.body.classList.add("ready");
  post({ type: "ready" });
}

main();
