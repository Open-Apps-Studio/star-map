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
  | { type: "north"; magnetic: boolean }
  /** What the phone can do (sent once the page is ready). */
  | { type: "caps"; motion: boolean }
  /** Telescope connection state and position (J2000 radians). */
  | { type: "telescope"; status: "off" | "connecting" | "connected" | "error"; message?: string; warning?: string; ra?: number; dec?: number };

export type NativeOut =
  | { type: "haptic"; style: "light" | "medium" | "success" | "selection" }
  | { type: "ready" }
  | { type: "sensor-mode"; on: boolean }
  /** Page errors, written to the device log so crashes can be diagnosed. */
  | { type: "log"; text: string }
  | { type: "telescope-connect"; protocol: "stellarium" | "lx200"; host: string; port: number }
  | { type: "telescope-goto"; ra: number; dec: number }
  | { type: "telescope-disconnect" };

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
