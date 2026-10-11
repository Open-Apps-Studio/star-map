/**
 * Telescope control (Stellarium Mobile Plus): the app shell opens a TCP
 * connection to a telescope server on the local network and speaks either
 *  - the Stellarium Telescope Protocol (Stellarium's own telescope servers,
 *    INDI/ASCOM bridges, SynScan Pro's "Stellarium" mode), port 10001, or
 *  - Meade LX200 over TCP (SkyFi, StarSense/SynScan WiFi adapters, OnStep).
 * The page sends goto targets and draws the telescope's reported position.
 */
import { $, app, toast } from "./state";
import { post } from "./bridge";
import { project } from "./project";
import { settings } from "./settings";

export type ScopeStatus = "off" | "connecting" | "connected" | "error";

export const scope = {
  status: "off" as ScopeStatus,
  /** Last reported position, J2000 radians. */
  ra: null as number | null,
  dec: null as number | null,
  message: "",
};

const listeners = new Set<() => void>();
export const onScopeChange = (f: () => void) => (listeners.add(f), () => listeners.delete(f));
const changed = () => listeners.forEach((f) => f());

export function connectScope() {
  const t = settings.telescope;
  if (!t) return;
  scope.status = "connecting";
  scope.message = "";
  changed();
  post({ type: "telescope-connect", protocol: t.protocol, host: t.host, port: t.port });
}

export function disconnectScope() {
  post({ type: "telescope-disconnect" });
  scope.status = "off";
  scope.ra = scope.dec = null;
  changed();
}

/** J2000 ⇄ of-date (LX200 mounts work in coordinates of date). */
function convert(ra: number, dec: number, from: "ICRF" | "JNOW", to: "ICRF" | "JNOW") {
  const v = app.stel.convertFrame(app.obs, from, to, app.stel.s2c(ra, dec));
  const [r, d] = app.stel.c2s(v);
  return { ra: app.stel.anp(r), dec: app.stel.anpm(d) };
}

/** Slew to a J2000 position (radians). */
export function gotoScope(ra: number, dec: number, name: string) {
  if (scope.status !== "connected") return toast("Connect a telescope in Instruments first");
  const p = settings.telescope?.protocol === "lx200" ? convert(ra, dec, "ICRF", "JNOW") : { ra, dec };
  post({ type: "telescope-goto", ra: p.ra, dec: p.dec });
  toast(`Slewing to ${name}`);
}

/** Messages from the shell. */
export function onScopeMessage(m: { status: ScopeStatus; message?: string; warning?: string; ra?: number; dec?: number }) {
  if (m.warning) toast(m.warning);
  const was = scope.status;
  scope.status = m.status;
  scope.message = m.message ?? "";
  if (typeof m.ra === "number" && typeof m.dec === "number") {
    const p = settings.telescope?.protocol === "lx200" ? convert(m.ra, m.dec, "JNOW", "ICRF") : { ra: m.ra, dec: m.dec };
    scope.ra = p.ra;
    scope.dec = p.dec;
  }
  if (m.status === "connected" && was !== "connected") toast("Telescope connected");
  if (m.status === "error") toast(`Telescope: ${m.message ?? "connection failed"}`);
  changed();
}

/** Per frame: the telescope's reticle on the sky. */
export function updateScopeMarker() {
  const el = $("scope-marker");
  if (scope.status !== "connected" || scope.ra == null || scope.dec == null) {
    el.hidden = true;
    return;
  }
  const p = project(app.stel.s2c(scope.ra, scope.dec));
  if (!p || !p.onScreen) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.style.transform = `translate(${p.x}px, ${p.y}px)`;
}
