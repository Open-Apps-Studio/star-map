/**
 * Notifications (Sky Guide's ISS alerts, Sky Tonight's event reminders):
 *  - automatic: every visible ISS pass in the next 4 days (5 minutes before
 *    it rises) and the big sky events of the next 6 weeks, rescheduled each
 *    time the app opens or the location changes;
 *  - by hand: the bell on a satellite pass or calendar event.
 * The page works out what and when; the app shell schedules local
 * notifications (expo-notifications) and reports taps back as notify-open.
 */
import { inApp, post } from "./bridge";
import { app, toast } from "./state";
import { settings, saveSettings } from "./settings";
import { compass, fmtTime, mjdToDate } from "./astro";
import { computeEvents, loadMeteorShowers, nextPasses, type SkyEvent } from "./events";
import { withObserverCopy, type SweObj } from "./engine";

const mjdToMs = (mjd: number) => (mjd - 40587) * 86400e3;
const MIN = 1 / 1440;

/** Notifications only exist in the app; in a browser say so once. */
export const alertsAvailable = () => inApp();

function schedule(id: string, atMjd: number, title: string, body: string, data: { mjd?: number; target?: string }) {
  const at = mjdToMs(atMjd);
  if (at < Date.now() + 30e3) return false;
  post({ type: "notify-schedule", id, at, title, body, data });
  return true;
}

// ---------------------------------------------------------------- by hand
export const isReminded = (key: string) => !!settings.reminders[key];

/** Toggle a reminder; returns whether it's on now. */
export function toggleReminder(key: string, atMjd: number, title: string, body: string, data: { mjd?: number; target?: string }): boolean {
  if (!alertsAvailable()) {
    toast("Reminders work in the Star Map app");
    return false;
  }
  if (settings.reminders[key]) {
    delete settings.reminders[key];
    post({ type: "notify-cancel", id: "r-" + key });
    saveSettings();
    toast("Reminder removed");
    return false;
  }
  if (!schedule("r-" + key, atMjd, title, body, data)) {
    toast("That's already started");
    return false;
  }
  settings.reminders[key] = { at: mjdToMs(atMjd), title };
  saveSettings();
  toast(`Reminder set for ${mjdToDate(atMjd).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`);
  return true;
}

/** Drop reminders that have already fired. */
function pruneReminders() {
  let changed = false;
  for (const [k, r] of Object.entries(settings.reminders)) {
    if (r.at < Date.now()) {
      delete settings.reminders[k];
      changed = true;
    }
  }
  if (changed) saveSettings();
}

/** Reminder time for an event: an hour before a moment; 9 pm on a meteor night. */
export function eventReminderTime(ev: SkyEvent): number {
  if (!ev.allNight) return ev.mjd - 60 * MIN;
  const d = mjdToDate(ev.mjd);
  d.setHours(21, 0, 0, 0);
  return d.getTime() / 86400e3 + 40587;
}

export const eventKey = (ev: SkyEvent) => `ev-${ev.kind}-${Math.round(ev.mjd * 24)}-${ev.title}`;

// ---------------------------------------------------------------- automatic
/** Events worth a notification on their own (not every Moon–planet meeting). */
function bigEvent(ev: SkyEvent): boolean {
  if (ev.kind === "eclipse" || ev.kind === "meteors" || ev.kind === "opposition") return true;
  if (ev.kind === "moon") return ev.title === "Full Moon" || ev.title === "New Moon";
  // Close conjunctions only ("2.0° apart" or arcminutes).
  if (ev.kind === "conjunction") return /′ apart|^[01]\.\d° apart/.test(ev.detail);
  return false;
}

let timer = 0;

/** Reschedule the automatic alerts (cheap to call often; debounced). */
export function refreshAutoAlerts(delayMs = 4000) {
  if (!alertsAvailable()) return;
  clearTimeout(timer);
  timer = window.setTimeout(runAuto, delayMs);
}

function runAuto() {
  pruneReminders();
  const now = Date.now() / 86400e3 + 40587;
  post({ type: "notify-cancel", prefix: "auto-" });
  if (settings.alerts.iss) {
    const iss = app.stel.getObj("NORAD 25544");
    if (iss) {
      for (const p of nextPasses(iss, now, 4, 30).filter((p) => p.visible)) {
        const where = passDirections(iss, p.rise, p.set);
        schedule(`auto-iss-${Math.round(p.rise * 1440)}`, p.rise - 5 * MIN, "The ISS flies over in 5 minutes",
          `Look to the ${where.from} at ${fmtTime(p.rise)}. It climbs to ${Math.round(p.maxAlt)}° and leaves to the ${where.to}.`,
          { mjd: p.rise + (p.set - p.rise) / 2, target: "NORAD 25544" });
      }
    }
  }
  if (settings.alerts.events) {
    // The six-week search runs off the startup path, after the shower list loads.
    loadMeteorShowers().catch(() => {}).then(() => {
      for (const ev of computeEvents(Math.floor(now), 42).filter(bigEvent)) {
        const at = eventReminderTime(ev);
        schedule(`auto-${eventKey(ev)}`, at, ev.title, ev.detail, { mjd: ev.mjd, target: ev.target });
      }
    });
  }
}

function passDirections(sat: SweObj, rise: number, set: number) {
  const dirAt = (t: number) =>
    withObserverCopy(app.stel, (o) => {
      o.utc = t;
      const v = app.stel.convertFrame(o, "ICRF", "OBSERVED", sat.getInfo("radec", o));
      return compass(app.stel.anp(app.stel.c2s(v)[0]), true);
    });
  return { from: dirAt(rise), to: dirAt(set) };
}
