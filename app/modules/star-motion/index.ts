import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/** Device → East/North/Up rotation matrix, rows E, N, U. */
export type MotionEvent = { m: number[][]; acc: number };

/** Telescope state; ra/dec in the protocol's frame (radians). */
export type TelescopeEvent = { status: "off" | "connecting" | "connected" | "error"; message?: string; warning?: string; ra?: number; dec?: number };

type StarMotionNative = {
  isAvailable(): boolean;
  start(hz: number, trueNorth: boolean): void;
  stop(): void;
  log(text: string): void;
  telescopeConnect(host: string, port: number, proto: string): void;
  telescopeGoto(ra: number, dec: number): void;
  telescopeDisconnect(): void;
  addListener(event: "onMotion", cb: (e: MotionEvent) => void): EventSubscription;
  addListener(event: "onTelescope", cb: (e: TelescopeEvent) => void): EventSubscription;
};

const native = requireOptionalNativeModule<StarMotionNative>("StarMotion");

export const StarMotion = {
  isAvailable: () => !!native?.isAvailable(),
  start: (hz = 60, trueNorth = true) => native?.start(hz, trueNorth),
  stop: () => native?.stop(),
  /** Write a line to the device log (shows in Console.app in release builds). */
  log: (text: string) => native?.log(text),
  telescopeConnect: (host: string, port: number, proto: string) => native?.telescopeConnect(host, port, proto),
  telescopeGoto: (ra: number, dec: number) => native?.telescopeGoto(ra, dec),
  telescopeDisconnect: () => native?.telescopeDisconnect(),
  onTelescope: (cb: (e: TelescopeEvent) => void) => native?.addListener("onTelescope", cb),
  addListener: (cb: (e: MotionEvent) => void) => native?.addListener("onMotion", cb),
};
