/**
 * Ambient soundtrack (Sky Guide's signature touch): a calm 57-second loop,
 * off by default. Web Audio rather than <audio loop> so the loop is gapless
 * (AAC adds a few ms of padding at both ends; we loop just inside it). iOS
 * only lets audio start from a tap, so a saved "on" waits for the first touch.
 */
import { abs } from "./engine";
import { settings, saveSettings } from "./settings";

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let source: AudioBufferSourceNode | null = null;
let buffer: Promise<AudioBuffer> | null = null;

function load(c: AudioContext) {
  buffer ??= new Promise<ArrayBuffer>((resolve, reject) => {
    // XHR: WKWebView's fetch() can't read the app's file:// bundle.
    const x = new XMLHttpRequest();
    x.open("GET", abs("audio/ambient.m4a"));
    x.responseType = "arraybuffer";
    x.onload = () => (x.response ? resolve(x.response) : reject(new Error("no audio")));
    x.onerror = () => reject(new Error("audio"));
    x.send();
  }).then((data) => c.decodeAudioData(data));
  return buffer;
}

async function start() {
  ctx ??= new AudioContext();
  await ctx.resume();
  if (source) return;
  const buf = await load(ctx);
  if (!settings.ambient || source) return;
  gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  source = ctx.createBufferSource();
  source.buffer = buf;
  source.loop = true;
  source.loopStart = 0.06;
  source.loopEnd = buf.duration - 0.06;
  source.connect(gain);
  source.start(0, 0.06);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 3); // fade in
}

function stop() {
  if (!ctx || !source || !gain) return;
  const s = source, g = gain;
  source = null;
  gain = null;
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
  s.stop(ctx.currentTime + 1.3);
}

export function setAmbient(on: boolean) {
  settings.ambient = on;
  saveSettings();
  if (on) start().catch(() => {});
  else stop();
}

/** A saved "on" starts with the first touch (iOS needs a gesture). */
export function initAmbient() {
  if (settings.ambient) {
    const kick = () => {
      window.removeEventListener("pointerdown", kick, true);
      start().catch(() => {});
    };
    window.addEventListener("pointerdown", kick, true);
  }
  // Quiet while the app is in the background.
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (settings.ambient) ctx.resume();
  });
}
