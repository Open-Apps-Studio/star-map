import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

/** Device → East/North/Up rotation matrix, rows E, N, U. */
export type MotionEvent = { m: number[][]; acc: number };

type StarMotionNative = {
  isAvailable(): boolean;
  start(hz: number): void;
  stop(): void;
  addListener(event: "onMotion", cb: (e: MotionEvent) => void): EventSubscription;
};

const native = requireOptionalNativeModule<StarMotionNative>("StarMotion");

export const StarMotion = {
  isAvailable: () => !!native?.isAvailable(),
  start: (hz = 60) => native?.start(hz),
  stop: () => native?.stop(),
  addListener: (cb: (e: MotionEvent) => void) => native?.addListener("onMotion", cb),
};
