/**
 * Messages between the sky page and the Expo shell (react-native-webview).
 * In a plain browser every call here is a harmless no-op.
 */
import type { Mat3 } from "./sensors";

export type NativeIn =
  | { type: "motion"; m: Mat3 }
  | { type: "location"; lat: number; lon: number; alt?: number }
  /** Compass needs calibrating (CoreMotion reports it uncalibrated). */
  | { type: "calibrate" }
  /** No location permission: orientation is magnetic, not true, north. */
  | { type: "north"; magnetic: boolean };

export type NativeOut =
  | { type: "haptic"; style: "light" | "medium" | "success" | "selection" }
  | { type: "ready" }
  | { type: "sensor-mode"; on: boolean };

const rn = () => (window as any).ReactNativeWebView as { postMessage(s: string): void } | undefined;

export const inApp = () => !!rn();

export function post(msg: NativeOut) {
  const w = rn();
  if (w) w.postMessage(JSON.stringify(msg));
  else if (msg.type === "haptic" && "vibrate" in navigator) navigator.vibrate?.(msg.style === "success" ? [12, 40, 12] : 8);
}

/** The shell calls `window.__starmap.onNative({...})` via injectJavaScript (fast path, 60 Hz). */
export function listen(handler: (msg: NativeIn) => void) {
  (window as any).__starmap = { onNative: handler };
}
