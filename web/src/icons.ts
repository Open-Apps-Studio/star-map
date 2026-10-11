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
  mdiBinoculars, mdiCalendarStar, mdiCamera, mdiCircleHalfFull, mdiCogOutline, mdiCubeOutline, mdiMeteor, mdiMoonWaningCrescent, mdiOrbit, mdiRotate3d, mdiStar, mdiStarOutline, mdiTelescope, mdiWeatherSunset, mdiWhiteBalanceSunny, mdiClose, mdiTarget, mdiPlus, mdiDeleteOutline, mdiCheck,
} from "@mdi/js";

export const MDI: Record<string, string> = {
  mdiArrowLeft, mdiChartBellCurve, mdiCompassOutline, mdiCrosshairsGps, mdiEarth, mdiGrid, mdiHistory, mdiImageFilterHdr,
  mdiLayersOutline, mdiMagnify, mdiMapMarkerOutline, mdiMenu, mdiMenuDown, mdiMenuUp, mdiMinusCircleOutline, mdiPause,
  mdiPlay, mdiPlusCircleOutline, mdiRestore, mdiSatelliteVariant, mdiSkipNext, mdiSkipPrevious, mdiWeatherNight,
  mdiInformationOutline, mdiStarFourPoints,
  mdiBinoculars, mdiCalendarStar, mdiCamera, mdiCircleHalfFull, mdiCogOutline, mdiCubeOutline, mdiMeteor, mdiMoonWaningCrescent, mdiOrbit, mdiRotate3d, mdiStar, mdiStarOutline, mdiTelescope, mdiWeatherSunset, mdiWhiteBalanceSunny, mdiClose, mdiTarget, mdiPlus, mdiDeleteOutline, mdiCheck,
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
};

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
  return `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="${r}" fill="#3a3b3f"/><path d="${d}" fill="#e9e6dc"/></svg>`;
}

export type IconKind = "planet" | "moon" | "sun" | "star" | "galaxy" | "nebula" | "cluster" | "constellation" | "satellite" | "comet" | "asteroid" | "other";

export function objectIcon(kind: IconKind, opts: { name?: string; lit?: number; waxing?: boolean } = {}): string {
  switch (kind) {
    case "moon":
      return moonSvg(opts.lit ?? 0.5, opts.waxing ?? true);
    case "sun":
    case "planet": {
      const c = planetColor(opts.name ?? "");
      const ring = opts.name === "Saturn" ? `<ellipse cx="24" cy="24" rx="22" ry="6.5" fill="none" stroke="${c}" stroke-width="2" opacity=".75" transform="rotate(-18 24 24)"/>` : "";
      return `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="${opts.name === "Saturn" ? 14 : 19}" fill="${c}"/>${ring}</svg>`;
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
