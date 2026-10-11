/**
 * Real photos of galaxies, nebulae and clusters (Sky Guide and Star Walk show
 * these): a small colour cut-out of the Digitized Sky Survey around the
 * object from CDS's hips2fits service, framed by the object's size. Online
 * only; the <img> swaps back to the drawn glyph if it can't load.
 */
import { app } from "./state";
import type { SweObj } from "./engine";

const R2D = 180 / Math.PI;

/** Photo URL around a J2000 position (radians), framed for `dimArcmin`. */
export function photoUrlAt(ra: number, dec: number, dimArcmin: number | null, px = 96): string {
  const fovDeg = dimArcmin ? Math.min(5, Math.max(0.12, (dimArcmin / 60) * 1.5)) : 0.5;
  const q = new URLSearchParams({
    hips: "CDS/P/DSS2/color", width: String(px * 2), height: String(px * 2), fov: fovDeg.toFixed(3),
    projection: "TAN", ra: (app.stel.anp(ra) * R2D).toFixed(4), dec: (app.stel.anpm(dec) * R2D).toFixed(4), format: "jpg",
  });
  return `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${q}`;
}

/** Catalogue size (arcmin) of a loaded deep-sky object, when known. */
export const dsoSize = (obj: SweObj | null) => Number((obj as any)?.jsonData?.model_data?.dimx) || null;

export function dsoPhotoUrl(obj: SweObj, px = 96): string | null {
  try {
    const v = obj.getInfo("radec") as number[];
    if (!v) return null;
    const [ra, dec] = app.stel.c2s(v);
    return photoUrlAt(ra, dec, dsoSize(obj), px);
  } catch {
    return null;
  }
}

/**
 * Swap `box`'s drawn glyph for the photo once it has loaded (the glyph stays
 * if we're offline or the service is down, so nothing ever looks broken).
 */
export function attachDsoPhoto(box: HTMLElement, obj: SweObj | string, px = 96) {
  if (!navigator.onLine) return;
  const url = typeof obj === "string" ? obj : dsoPhotoUrl(obj, px);
  if (!url) return;
  const img = new Image();
  img.className = "dso-photo";
  img.alt = "";
  img.decoding = "async";
  img.onload = () => {
    if (!box.isConnected && box.id !== "card-icon") return;
    box.replaceChildren(img);
  };
  img.src = url;
}
