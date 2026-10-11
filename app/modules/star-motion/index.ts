import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/** Device → East/North/Up rotation matrix, rows E, N, U. */
export type MotionEvent = { m: number[][]; acc: number };

type StarMotionNative = {
  isAvailable(): boolean;
  start(hz: number, trueNorth: boolean): void;
  stop(): void;
  log(text: string): void;
  addListener(event: "onMotion", cb: (e: MotionEvent) => void): EventSubscription;
};

const native = requireOptionalNativeModule<StarMotionNative>("StarMotion");

export const StarMotion = {
  isAvailable: () => !!native?.isAvailable(),
  start: (hz = 60, trueNorth = true) => native?.start(hz, trueNorth),
  stop: () => native?.stop(),
  /** Write a line to the device log (shows in Console.app in release builds). */
  log: (text: string) => native?.log(text),
  addListener: (cb: (e: MotionEvent) => void) => native?.addListener("onMotion", cb),
};
