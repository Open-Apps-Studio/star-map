/**
 * Full offline search: every bundled star and deep-sky object by any common
 * designation (M 13, NGC 7000, HIP 11767, HD 8890, α UMi…), plus asteroids,
 * comets and satellites. Built at build time by scripts/build-search-index.py
 * and loaded the first time someone types in search.
 */
import { abs, D2R, prettyDesignation, starByHip, type Stel, type SweObj } from "./engine";
import { getJson } from "./catalog";
import type { IconKind } from "./icons";

export interface Hit {
  name: string;
  /** Other designations, shown under the name. */
  aka: string;
  icon: IconKind;
  /** Engine designations to resolve, best first. */
  ids: string[];
  /** J2000 position in radians, when known (stars, DSOs). */
  ra?: number;
  de?: number;
  mag?: number | null;
  /** SIMBAD-style object type (DSOs), for the type label. */
  otype?: string;
  kindLabel: string;
  /** Pre-folded search keys, NAME ones first. */
  keys: string[];
  nameKeys: number;
}

const GREEK: Record<string, string> = {
  alf: "alpha", bet: "beta", gam: "gamma", del: "delta", eps: "epsilon", zet: "zeta", eta: "eta", tet: "theta",
  iot: "iota", kap: "kappa", lam: "lambda", mu: "mu", nu: "nu", xi: "xi", omi: "omicron", pi: "pi", rho: "rho",
  sig: "sigma", tau: "tau", ups: "upsilon", phi: "phi", chi: "chi", psi: "psi", ome: "omega",
};

/** Lowercase, no accents, no spaces or punctuation: "NGC 7000" → "ngc7000". */
export const foldKey = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Search keys for one designation (adds "alphaumi" for "* alf UMi"). */
function keysFor(id: string): string[] {
  const bare = id.replace(/^(NAME|\*|V\*) /, "");
  const out = [foldKey(bare)];
  const m = /^([a-z]{2,3})(\d*) (\w+)$/.exec(bare);
  if (m && GREEK[m[1]]) out.push(foldKey(`${GREEK[m[1]]}${m[2]} ${m[3]}`));
  return out;
}

function displayOf(ids: string[]): string {
  const named = ids.find((i) => i.startsWith("NAME "));
  if (named) return named.slice(5);
  const messier = ids.find((i) => /^M \d/.test(i));
  if (messier) return messier;
  return prettyDesignation(ids[0]);
}

function akaOf(ids: string[], name: string): string {
  return ids
    .filter((i) => !i.startsWith("NAME "))
    .map(prettyDesignation)
    .filter((d) => d !== name)
    .slice(0, 3)
    .join(" · ");
}

let hits: Hit[] | null = null;
let loading: Promise<Hit[]> | null = null;

function makeHit(ids: string[], extra: Partial<Hit> & Pick<Hit, "icon" | "kindLabel">): Hit {
  const name = displayOf(ids);
  const keys: string[] = [];
  let nameKeys = 0;
  for (const id of ids) {
    const k = keysFor(id);
    if (id.startsWith("NAME ")) {
      keys.unshift(...k);
      nameKeys += k.length;
    } else keys.push(...k);
  }
  return { name, aka: akaOf(ids, name), ids, keys, nameKeys, ...extra };
}

/** Load (once) and prepare the index. */
export function loadIndex(): Promise<Hit[]> {
  if (hits) return Promise.resolve(hits);
  loading ??= getJson(abs("skydata/search-index.json")).then((data) => {
    const out: Hit[] = [];
    for (const [idStr, ra, de, mag] of data.stars as [string, number, number, number][]) {
      const ids = idStr.split("|");
      out.push(makeHit(ids, { icon: "star", kindLabel: "Star", ra: ra * D2R, de: de * D2R, mag }));
    }
    for (const [idStr, ra, de, mag, otype] of data.dsos as [string, number, number, number | null, string][]) {
      const ids = idStr.split("|");
      out.push(makeHit(ids, { icon: "galaxy", kindLabel: "Deep sky object", ra: ra * D2R, de: de * D2R, mag, otype }));
    }
    for (const [name, id, kind, mag] of data.minor as [string, string, "asteroid" | "comet" | "satellite", number?][]) {
      const h = makeHit([id], {
        icon: kind,
        mag: kind === "satellite" ? mag ?? null : null,
        kindLabel: kind === "asteroid" ? "Asteroid" : kind === "comet" ? "Comet" : "Artificial satellite",
      });
      h.name = name;
      h.keys = [foldKey(name), ...h.keys];
      h.nameKeys = 1;
      h.aka = id.startsWith("NORAD") ? id : "";
      out.push(h);
    }
    hits = out;
    return out;
  });
  return loading;
}

/**
 * Rank: exact key > key prefix (names first) > name substring; brighter
 * objects win ties.
 */
export function searchIndex(index: Hit[], query: string, limit = 30): Hit[] {
  const q = foldKey(query);
  if (!q) return [];
  const scored: [number, Hit][] = [];
  for (const h of index) {
    let best = 0;
    for (let i = 0; i < h.keys.length; i++) {
      const k = h.keys[i];
      const isName = i < h.nameKeys;
      let s = 0;
      if (k === q) s = isName ? 100 : 95;
      else if (k.startsWith(q)) s = isName ? 80 : 60;
      // Mid-word matches only for longer queries ("tsuchinshan" in
      // "C/2023 A3 (Tsuchinshan-ATLAS)"); short ones are mostly noise.
      else if (isName && q.length >= 5 && k.includes(q)) s = 40;
      if (s > best) best = s;
    }
    if (best) {
      const mag = typeof h.mag === "number" ? h.mag : 12;
      scored.push([best - Math.max(-2, Math.min(15, mag)) * 0.5, h]);
    }
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([, h]) => h);
}

/** Resolve a hit to an engine object if its data is loaded (null otherwise). */
export function resolveHit(stel: Stel, h: Hit): SweObj | null {
  for (const id of h.ids) {
    try {
      const hip = /^HIP (\d+)$/.exec(id);
      const o = hip ? starByHip(stel, Number(hip[1])) : stel.getObj(id);
      if (o) return o;
    } catch {
      /* next designation */
    }
  }
  return null;
}

/** Observed-frame direction of a hit with a catalogue position. */
export function hitDirection(stel: Stel, h: Hit): number[] | null {
  if (h.ra == null || h.de == null) return null;
  return stel.convertFrame(stel.observer, "ICRF", "OBSERVED", stel.s2c(h.ra, h.de));
}
