/** Shared handles and tiny helpers used by every UI module. */
import type { Stel, SweObj } from "./engine";
import type { Entry } from "./catalog";
import { post } from "./bridge";

export const app = {
  stel: null as unknown as Stel,
  /** Cached wrappers: every `stel.core` read builds a new object, so read once. */
  core: null as any,
  obs: null as any,
  catalog: [] as Entry[],
  /** Whether the phone's orientation drives the view. */
  pointing: false,
};

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let toastTimer = 0;
export function toast(text: string, ms = 2600) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), ms);
}

export const haptic = (style: "light" | "medium" | "success" | "selection" = "light") => post({ type: "haptic", style });

/** Solar-system objects, looked up once (each getObj returns a retained ref). */
const planets = new Map<string, SweObj | null>();
export function planet(name: string): SweObj | null {
  if (!planets.get(name)) planets.set(name, app.stel.getObj(`NAME ${name}`));
  return planets.get(name) ?? null;
}

/** Open one bottom panel at a time (time / layers); null closes all. */
const PANELS = ["time-sheet", "layers-sheet"];
export function openPanel(id: string | null) {
  for (const p of PANELS) $(p).hidden = p !== id;
  document.body.classList.toggle("panel-open", !!id);
}
