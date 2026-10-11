/**
 * Share a snapshot of the sky (Night Sky / Sky Tonight do this): the engine's
 * canvas plus a caption strip, sent to the iOS share sheet. The WebGL canvas
 * isn't preserved between frames, so the capture happens in our animation
 * frame callback, which runs right after the engine has drawn.
 */
import { $, app, toast } from "./state";
import { inApp, post } from "./bridge";
import { mjdToDate } from "./astro";

let pending: { title: string } | null = null;

export function shareSky(title: string) {
  pending = { title };
}

/** Called from the main frame loop, after the engine's render. */
export function captureIfRequested() {
  if (!pending) return;
  const { title } = pending;
  pending = null;
  const sky = $<HTMLCanvasElement>("stel-canvas");
  const w = sky.width, h = sky.height;
  const scale = w / window.innerWidth;
  const bar = Math.round(64 * scale);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h + bar;
  const g = out.getContext("2d")!;
  g.fillStyle = "#05070d";
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(sky, 0, 0);
  const when = mjdToDate(app.obs.utc).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  g.fillStyle = "#fff";
  g.font = `600 ${Math.round(18 * scale)}px -apple-system, system-ui, sans-serif`;
  g.textBaseline = "middle";
  g.fillText(title, 16 * scale, h + bar * 0.36);
  g.fillStyle = "rgba(255,255,255,.6)";
  g.font = `${Math.round(13 * scale)}px -apple-system, system-ui, sans-serif`;
  g.fillText(`${when} · Star Map`, 16 * scale, h + bar * 0.72);
  const dataUrl = out.toDataURL("image/jpeg", 0.88);
  if (inApp()) post({ type: "share", dataUrl, message: `${title} in the sky right now, seen with Star Map` });
  else {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "star-map.jpg";
    a.click();
    toast("Snapshot saved");
  }
}
