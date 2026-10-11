/**
 * Settings (Stellarium Mobile Plus's settings and sky options): sky culture,
 * landscape, light pollution, stars (limit, brightness), label density,
 * extras (fog, cardinal points, meteors), data, startup time.
 */
import { abs } from "../engine";
import { getJson } from "../catalog";
import { DEFAULTS, setSetting, settings, saveSettings, applySettings } from "../settings";
import { buttonRow, choiceList, navRow, pushPage, refreshPage, section, segmented, sliderRow, switchRow } from "./page";
import { toast } from "../state";
import { alertsAvailable, refreshAutoAlerts } from "../alerts";

interface Meta {
  skycultures: { id: string; name: string; region: string; art: boolean }[];
  landscapes: { id: string; name: string; blurb: string }[];
}
let meta: Meta | null = null;
const loadMeta = async () => (meta ??= (await getJson(abs("skydata/meta.json"))) as Meta);

const BORTLE = [
  "", "Excellent dark sky", "Typical truly dark site", "Rural sky", "Rural/suburban transition",
  "Suburban sky", "Bright suburban sky", "Suburban/urban transition", "City sky", "Inner-city sky",
];

const labelText = (v: number) => (v === 0 ? "Normal" : v < 0 ? (v <= -2 ? "Very few" : "Fewer") : v >= 2 ? "Many more" : "More");

function skyCulturePage() {
  pushPage("Sky culture", (body) => {
    const m = meta!;
    const byRegion = new Map<string, Meta["skycultures"]>();
    for (const c of m.skycultures) {
      const r = c.region || "Other";
      if (!byRegion.has(r)) byRegion.set(r, []);
      byRegion.get(r)!.push(c);
    }
    for (const [region, list] of byRegion) {
      const box = section(body, region);
      choiceList(
        box,
        list.map((c) => ({ value: c.id, label: c.name, sub: c.art ? "With illustrations" : undefined })),
        () => settings.skyCulture,
        (v) => setSetting("skyCulture", v),
      );
    }
  });
}

function landscapePage() {
  pushPage("Landscape", (body) => {
    const box = section(body, "Ground");
    choiceList(
      box,
      meta!.landscapes.map((l) => ({ value: l.id, label: l.name, sub: l.blurb || undefined })),
      () => settings.landscape,
      (v) => setSetting("landscape", v),
    );
  });
}

export async function openSettings() {
  await loadMeta();
  pushPage("Settings", (body) => {
    const m = meta!;
    // ---- sky
    let box = section(body, "Sky");
    navRow(box, "Sky culture", m.skycultures.find((c) => c.id === settings.skyCulture)?.name ?? settings.skyCulture, skyCulturePage);
    navRow(box, "Landscape", m.landscapes.find((l) => l.id === settings.landscape)?.name ?? settings.landscape, landscapePage);
    sliderRow(box, "Light pollution", {
      min: 1, max: 9, step: 1,
      get: () => settings.bortle,
      set: (v) => setSetting("bortle", v),
      format: (v) => `Bortle ${v} · ${BORTLE[v]}`,
    });
    switchRow(box, "Ground fog", () => settings.fog, (v) => setSetting("fog", v));
    switchRow(box, "Cardinal points", () => settings.cardinals, (v) => setSetting("cardinals", v));
    switchRow(box, "Meteor showers", () => settings.meteors, (v) => setSetting("meteors", v), "Shooting stars at their real rate");

    // ---- stars
    box = section(body, "Alerts", alertsAvailable() ? "Notifications, worked out for your location. They update each time you open the app." : "Notifications work in the Star Map app.");
    const setAlert = (k: "iss" | "events") => (v: boolean) => {
      settings.alerts = { ...settings.alerts, [k]: v };
      saveSettings();
      refreshAutoAlerts(300);
    };
    switchRow(box, "ISS flyovers", () => settings.alerts.iss, setAlert("iss"), "5 minutes before every visible pass");
    switchRow(box, "Sky events", () => settings.alerts.events, setAlert("events"), "Eclipses, meteor showers, full and new Moons, close conjunctions");

    box = section(body, "Stars");
    sliderRow(box, "Magnitude limit", {
      min: 4, max: 21, step: 0.5,
      get: () => (settings.starLimit >= 99 ? 21 : settings.starLimit),
      set: (v) => setSetting("starLimit", v >= 21 ? 99 : v),
      format: (v) => (v >= 21 ? "No limit" : `Magnitude ${v.toFixed(1)}`),
    });
    sliderRow(box, "Star brightness", {
      min: 0.5, max: 2, step: 0.05,
      get: () => settings.starBrightness,
      set: (v) => setSetting("starBrightness", v),
      format: (v) => (Math.abs(v - 1) < 0.01 ? "Normal" : `${Math.round(v * 100)}%`),
    });

    // ---- labels
    box = section(body, "Labels", "How many names are shown on the sky.");
    for (const [key, label] of [["stars", "Stars"], ["planets", "Solar system"], ["dsos", "Deep sky"], ["satellites", "Satellites"]] as const) {
      sliderRow(box, label, {
        min: -3, max: 3, step: 1,
        get: () => settings.labels[key],
        set: (v) => {
          settings.labels[key] = v;
          saveSettings();
          applySettings();
        },
        format: labelText,
      });
    }

    // ---- data & startup
    box = section(body, "Data", "Online: faint stars from the Gaia DR3 catalogue, the full galaxy and nebula catalogue, and real photos of the whole sky (DSS). Offline you still get stars to magnitude 8, the bright deep-sky catalogue and everything else.");
    switchRow(box, "Online sky data", () => settings.onlineData, (v) => {
      setSetting("onlineData", v);
      toast(v ? "Deep sky data streams in when you're online" : "Restart the app to drop the online data");
    });
    box = section(body, "Startup");
    segmented(box, [{ value: "now", label: "Start at now" }, { value: "last", label: "Where I left off" }], () => settings.startTime, (v) => setSetting("startTime", v));

    box = section(body, "Reset");
    buttonRow(box, "Restore default settings", () => {
      const keep = { favourites: settings.favourites, oculars: settings.oculars, telescope: settings.telescope, manualLocation: settings.manualLocation, autoLocation: settings.autoLocation };
      Object.assign(settings, structuredClone(DEFAULTS), keep);
      saveSettings();
      applySettings();
      refreshPage();
      toast("Settings restored");
    }, "danger");
  });
}
