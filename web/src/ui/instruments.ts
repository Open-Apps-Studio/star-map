/**
 * Instruments (Stellarium Mobile Plus): your eyepieces, cameras, binoculars
 * and Telrad, shown as field-of-view overlays on the sky, plus telescope
 * control over the local network.
 */
import { toast } from "../state";
import { saveSettings, settings, type Ocular } from "../settings";
import { activeOcular, ocularView, setOcular } from "../ocular";
import { fmtDec, fmtRA } from "../astro";
import { connectScope, disconnectScope, onScopeChange, scope } from "../telescope";
import { inApp } from "../bridge";
import { buttonRow, closePages, el, inputRow, popPage, pushPage, refreshPage, section, segmented } from "./page";

const KINDS: { value: Ocular["kind"]; label: string }[] = [
  { value: "eyepiece", label: "Eyepiece" },
  { value: "camera", label: "Camera" },
  { value: "binoculars", label: "Binoculars" },
  { value: "telrad", label: "Telrad" },
];

function blank(kind: Ocular["kind"] = "eyepiece"): Ocular {
  return {
    id: `oc-${Date.now()}`, name: "", kind,
    scopeFocal: 1000, scopeAperture: 200, epFocal: 25, epAfov: 52, sensorW: 23.5, sensorH: 15.6, binoFov: 6.5, binoMag: 10,
  };
}

function summary(o: Ocular): string {
  const v = ocularView(o);
  return o.kind === "telrad" ? "Finder rings 0.5°, 2° and 4°" : v.facts.slice(0, 3).join(" · ");
}

function editOcular(o: Ocular, isNew: boolean) {
  const draft: Ocular = { ...o };
  pushPage(isNew ? "New instrument" : "Edit instrument", (body) => {
    segmented(body, KINDS, () => draft.kind, (v) => {
      draft.kind = v;
      refreshPage();
    });
    let box = section(body, "Name");
    inputRow(box, "Name", { value: draft.name, placeholder: KINDS.find((k) => k.value === draft.kind)!.label, onChange: (v) => (draft.name = v) });
    const num = (label: string, key: keyof Ocular, unit: string) =>
      inputRow(box, `${label} (${unit})`, {
        value: String(draft[key]),
        inputmode: "decimal",
        onChange: (v) => {
          const n = Number(v.replace(",", "."));
          if (n > 0) (draft as any)[key] = n;
          preview.textContent = summary(draft);
        },
      });
    if (draft.kind === "eyepiece" || draft.kind === "camera") {
      box = section(body, "Telescope");
      num("Focal length", "scopeFocal", "mm");
      num("Aperture", "scopeAperture", "mm");
    }
    if (draft.kind === "eyepiece") {
      box = section(body, "Eyepiece");
      num("Focal length", "epFocal", "mm");
      num("Apparent field", "epAfov", "°");
    }
    if (draft.kind === "camera") {
      box = section(body, "Sensor", "Full frame is 36 × 24 mm, APS-C about 23.5 × 15.6 mm.");
      num("Width", "sensorW", "mm");
      num("Height", "sensorH", "mm");
    }
    if (draft.kind === "binoculars") {
      box = section(body, "Binoculars", "Printed on them, e.g. 10×50 with a 6.5° field.");
      num("Magnification", "binoMag", "×");
      num("Aperture", "scopeAperture", "mm");
      num("Field of view", "binoFov", "°");
    }
    const preview = el("p", "caption group-note", summary(draft));
    body.appendChild(preview);
    box = section(body, "");
    buttonRow(box, "Save", () => {
      if (!draft.name.trim()) draft.name = KINDS.find((k) => k.value === draft.kind)!.label;
      const i = settings.oculars.findIndex((x) => x.id === draft.id);
      if (i >= 0) settings.oculars[i] = draft;
      else settings.oculars.push(draft);
      saveSettings();
      if (activeOcular()?.id === draft.id) setOcular(draft);
      popPage();
    });
    if (!isNew) {
      buttonRow(box, "Delete", () => {
        settings.oculars = settings.oculars.filter((x) => x.id !== draft.id);
        saveSettings();
        if (activeOcular()?.id === draft.id) setOcular(null);
        popPage();
      }, "danger");
    }
  });
}

export function openInstruments() {
  pushPage("Instruments", (body) => {
    // ---- oculars
    let box = section(body, "Field of view", "Tap an instrument to see its view on the sky. Tap the × on the sky to stop.");
    for (const o of settings.oculars) {
      const row = el("div", "row oc-row" + (activeOcular()?.id === o.id ? " on" : ""));
      row.innerHTML = `<button class="row-text oc-show"><span class="row-label"></span><span class="row-sub"></span></button><button class="oc-edit">Edit</button>`;
      row.querySelector(".row-label")!.textContent = o.name;
      row.querySelector(".row-sub")!.textContent = summary(o);
      row.querySelector(".oc-show")!.addEventListener("click", () => {
        setOcular(o);
        closePages();
      });
      row.querySelector(".oc-edit")!.addEventListener("click", () => editOcular(o, false));
      box.appendChild(row);
    }
    buttonRow(box, "Add instrument", () => editOcular(blank(), true));
    if (activeOcular()) buttonRow(box, "Hide field of view", () => (setOcular(null), refreshPage()));

    // ---- telescope
    box = section(
      body,
      "Telescope control",
      "Connect to a telescope on your Wi-Fi: Stellarium's telescope protocol (port 10001: SynScan Pro, INDI and ASCOM bridges, Stellarium telescope servers) or LX200 (SkyFi, SynScan/StarSense Wi-Fi, OnStep; often port 4030). Then use “Slew” on any object.",
    );
    const t = settings.telescope ?? { protocol: "stellarium" as const, host: "", port: 10001 };
    const proto = el("div", "row");
    box.appendChild(proto);
    segmented(proto, [{ value: "stellarium", label: "Stellarium" }, { value: "lx200", label: "LX200" }], () => t.protocol, (v) => {
      t.protocol = v;
      if (v === "lx200" && t.port === 10001) port.value = String((t.port = 4030));
      if (v === "stellarium" && t.port === 4030) port.value = String((t.port = 10001));
    });
    proto.firstElementChild!.classList.add("grow");
    const host = inputRow(box, "Address", { value: t.host, placeholder: "192.168.4.1", inputmode: "url", onChange: (v) => (t.host = v.trim()) });
    const port = inputRow(box, "Port", { value: String(t.port), inputmode: "numeric", onChange: (v) => (t.port = Number(v) || t.port) });
    const status = el("div", "row");
    status.innerHTML = `<span class="row-text"><span class="row-label">Status</span><span class="row-sub"></span></span>`;
    box.appendChild(status);
    const action = buttonRow(box, "", () => {
      if (scope.status === "connected" || scope.status === "connecting") return disconnectScope();
      t.host = host.value.trim();
      t.port = Number(port.value) || t.port;
      if (!t.host) return toast("Enter the telescope's address");
      if (!inApp()) return toast("Telescope control works in the iPhone app");
      settings.telescope = { ...t };
      saveSettings();
      connectScope();
    });
    const render = () => {
      const label = { off: "Not connected", connecting: "Connecting…", connected: "Connected", error: `Error: ${scope.message}` }[scope.status];
      const pos = scope.ra != null && scope.dec != null ? ` · RA ${fmtRA(scope.ra)} · Dec ${fmtDec(scope.dec)}` : "";
      status.querySelector(".row-sub")!.textContent = label + (scope.status === "connected" ? pos : "");
      action.textContent = scope.status === "connected" || scope.status === "connecting" ? "Disconnect" : "Connect";
    };
    render();
    return onScopeChange(render);
  });
}
