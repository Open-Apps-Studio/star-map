/**
 * Icons: Material Design paths for UI controls, plus generated object icons
 * (planet discs, Moon phase, star rings, deep-sky glyphs) like the ones on
 * Stellarium Mobile's object card.
 */
import {
  mdiArrowLeft, mdiChartBellCurve, mdiCompassOutline, mdiCrosshairsGps, mdiEarth, mdiGrid, mdiHistory, mdiImageFilterHdr,
  mdiLayersOutline, mdiMagnify, mdiMapMarkerOutline, mdiMenu, mdiMenuDown, mdiMenuUp, mdiMinusCircleOutline, mdiPause,
  mdiPlay, mdiPlusCircleOutline, mdiRestore, mdiSatelliteVariant, mdiSkipNext, mdiSkipPrevious, mdiWeatherNight,
  mdiInformationOutline, mdiStarFourPoints,
  mdiBinoculars, mdiCalendarStar, mdiCamera, mdiCircleHalfFull, mdiCogOutline, mdiCubeOutline, mdiMeteor, mdiMoonWaningCrescent, mdiOrbit, mdiRotate3d, mdiStar, mdiStarOutline, mdiTelescope, mdiWeatherSunset, mdiWhiteBalanceSunny, mdiClose, mdiTarget, mdiPlus, mdiDeleteOutline, mdiCheck, mdiBellOutline, mdiBellRing,
} from "@mdi/js";
import { PLANET_THUMBS } from "./planet-thumbs";

export const MDI: Record<string, string> = {
  mdiArrowLeft, mdiChartBellCurve, mdiCompassOutline, mdiCrosshairsGps, mdiEarth, mdiGrid, mdiHistory, mdiImageFilterHdr,
  mdiLayersOutline, mdiMagnify, mdiMapMarkerOutline, mdiMenu, mdiMenuDown, mdiMenuUp, mdiMinusCircleOutline, mdiPause,
  mdiPlay, mdiPlusCircleOutline, mdiRestore, mdiSatelliteVariant, mdiSkipNext, mdiSkipPrevious, mdiWeatherNight,
  mdiInformationOutline, mdiStarFourPoints,
  mdiBinoculars, mdiCalendarStar, mdiCamera, mdiCircleHalfFull, mdiCogOutline, mdiCubeOutline, mdiMeteor, mdiMoonWaningCrescent, mdiOrbit, mdiRotate3d, mdiStar, mdiStarOutline, mdiTelescope, mdiWeatherSunset, mdiWhiteBalanceSunny, mdiClose, mdiTarget, mdiPlus, mdiDeleteOutline, mdiCheck, mdiBellOutline, mdiBellRing,
};

export const icon = (path: string) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;

/** Fill every element that has data-icon="mdiName". */
export function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
    const p = MDI[el.dataset.icon!];
    if (p) el.innerHTML = icon(p);
  });
}

const PLANET_COLORS: Record<string, string> = {
  Sun: "#ffd65a", Mercury: "#a9a39b", Venus: "#efe2b8", Mars: "#d9774f", Jupiter: "#d9b48c",
  Saturn: "#e6cf98", Uranus: "#a6dbe3", Neptune: "#5f86e6", Pluto: "#c9b29a",
  // Moons (no maps bundled): their real tints.
  Io: "#e8d36a", Europa: "#d8c9ad", Ganymede: "#a99e8f", Callisto: "#7d7266", Titan: "#d9a24e", Enceladus: "#f2f4f6",
  Rhea: "#bdb8b0", Iapetus: "#9b8f80", Dione: "#c9c6c0", Tethys: "#d7d4ce", Mimas: "#b8b4ad", Phobos: "#8a7d70", Deimos: "#a09080",
  Triton: "#d9c7c0", Titania: "#b3aaa3", Oberon: "#a39a92", Miranda: "#b9b4ae", Charon: "#9d958e",
};

/** Astronomical symbols. U+FE0E forces text presentation so iOS doesn't draw ♀/♂ as emoji. */
export const PLANET_GLYPHS: Record<string, string> = {
  Sun: "☉", Moon: "☽", Mercury: "☿", Venus: "♀", Mars: "♂", Jupiter: "♃", Saturn: "♄", Uranus: "⛢", Neptune: "♆", Pluto: "⯓",
};
export const planetGlyph = (name: string) => (PLANET_GLYPHS[name] ? PLANET_GLYPHS[name] + "\uFE0E" : "");

/** A small textured globe (real surface maps), or "" when we have none for this body. */
export const planetThumb = (name: string, px = 22) =>
  PLANET_THUMBS[name] ? `<img class="planet-thumb" src="${PLANET_THUMBS[name]}" width="${px}" height="${px}" alt="" draggable="false">` : "";

export const planetColor = (name: string) => PLANET_COLORS[name] ?? "#cfcfcf";

/** Moon disc lit by fraction `lit` (0..1); `waxing` = lit on the right. */
function moonSvg(lit: number, waxing: boolean): string {
  const r = 20;
  // Terminator ellipse x-radius: cos of phase angle.
  const k = 1 - 2 * lit; // +1 new, -1 full
  const rx = Math.abs(k) * r;
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = k > 0 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
  const d = `M24 4 A${r} ${r} 0 0 ${sweepOuter} 24 44 A${rx} ${r} 0 0 ${sweepInner} 24 4Z`;
  // Real lunar surface, with the unlit side dimmed by a mask (unique id per icon).
  const id = `mm${moonIconCount++}`;
  return `<svg viewBox="0 0 48 48"><defs><mask id="${id}"><rect width="48" height="48" fill="#fff"/><path d="${d}" fill="#000"/></mask></defs><image href="${PLANET_THUMBS.Moon}" x="4" y="4" width="40" height="40"/><circle cx="24" cy="24" r="${r + 0.5}" fill="#06080d" fill-opacity=".86" mask="url(#${id})"/></svg>`;
}
let moonIconCount = 0;

export type IconKind = "planet" | "moon" | "sun" | "star" | "galaxy" | "nebula" | "cluster" | "constellation" | "satellite" | "comet" | "asteroid" | "other";

export function objectIcon(kind: IconKind, opts: { name?: string; lit?: number; waxing?: boolean } = {}): string {
  switch (kind) {
    case "moon":
      return moonSvg(opts.lit ?? 0.5, opts.waxing ?? true);
    case "sun":
    case "planet": {
      const name = opts.name ?? (kind === "sun" ? "Sun" : "");
      const thumb = PLANET_THUMBS[name];
      if (thumb) return `<svg viewBox="0 0 48 48"><image href="${thumb}" x="0" y="0" width="48" height="48"/></svg>`;
      // No map for this body (dwarf planets, moons): a shaded disc in its colour.
      const c = planetColor(name);
      return `<svg viewBox="0 0 48 48"><defs><radialGradient id="pg" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient></defs><circle cx="24" cy="24" r="19" fill="${c}"/><circle cx="24" cy="24" r="19" fill="url(#pg)"/></svg>`;
    }
    case "star":
      return `<svg viewBox="0 0 48 48" fill="none" stroke="#fff"><circle cx="24" cy="24" r="20" stroke-width="2"/><circle cx="24" cy="24" r="13" stroke-width="2"/><circle cx="24" cy="24" r="5" fill="#fff"/></svg>`;
    case "galaxy":
      return `<svg viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="2"><ellipse cx="24" cy="24" rx="21" ry="9" transform="rotate(-25 24 24)"/><ellipse cx="24" cy="24" rx="10" ry="4" transform="rotate(-25 24 24)" fill="#fff"/></svg>`;
    case "nebula":
      return `<svg viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="2"><rect x="7" y="7" width="34" height="34" rx="9"/><circle cx="24" cy="24" r="6" fill="#fff"/></svg>`;
    case "cluster":
      return `<svg viewBox="0 0 48 48" fill="#fff"><circle cx="24" cy="24" r="20" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 4"/><circle cx="18" cy="19" r="3"/><circle cx="28" cy="16" r="2.5"/><circle cx="30" cy="27" r="3"/><circle cx="19" cy="30" r="2.5"/><circle cx="24" cy="24" r="2"/></svg>`;
    case "constellation":
      return `<svg viewBox="0 0 48 48" fill="#fff" stroke="#fff" stroke-width="2"><path d="M6 32 L17 14 L30 22 L42 10" fill="none"/><circle cx="6" cy="32" r="3.5"/><circle cx="17" cy="14" r="3.5"/><circle cx="30" cy="22" r="3.5"/><circle cx="42" cy="10" r="3.5"/></svg>`;
    case "satellite":
      return `<svg viewBox="0 0 24 24" fill="#fff"><path d="${mdiSatelliteVariant}"/></svg>`;
    case "comet":
      return `<svg viewBox="0 0 48 48"><path d="M40 8 L14 30" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".35"/><circle cx="12" cy="34" r="8" fill="#fff"/></svg>`;
    case "asteroid":
      return `<svg viewBox="0 0 48 48"><path d="M14 12 L30 8 L41 20 L37 36 L20 41 L8 28Z" fill="#9a958d"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" fill="#fff"><path d="${mdiStarFourPoints}"/></svg>`;
  }
}

/** Map the engine's SIMBAD-style otype codes to an icon kind. */
export function kindFromOtype(otype: string | undefined, model?: string): IconKind {
  if (model === "tle_satellite") return "satellite";
  if (model === "mpc_comet") return "comet";
  if (model === "mpc_asteroid") return "asteroid";
  if (!otype) return "other";
  if (otype === "Pla" || otype === "Sat") return "planet";
  if (otype === "Moo") return "moon";
  if (/^G|^AGN|^QSO|^Sy|^LIN|^BLL/.test(otype)) return "galaxy";
  if (/^(OpC|GlC|Cl\*|As\*|C\?\*|MGr)/.test(otype)) return "cluster";
  if (/^(PN|HII|RNe|EmO|ISM|SNR|DNe|MoC|GNe|BNe|Cld|neb)/.test(otype)) return "nebula";
  if (otype === "Con") return "constellation";
  if (otype === "Asa" || otype === "ART") return "satellite";
  return "star";
}
