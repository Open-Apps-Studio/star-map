/**
 * Point-at-the-sky: turns phone orientation into the engine's view
 * (observer yaw / pitch / roll).
 *
 * Two sources, same output:
 *  - Web: DeviceOrientationEvent (alpha/beta/gamma) + iOS webkitCompassHeading
 *    to anchor alpha to north. Works in Safari with no install.
 *  - Native: the Expo shell can post a rotation matrix (device → East/North/Up)
 *    from CoreMotion's true-north frame via `pushNativeMatrix`. Smoother; wins
 *    over the web source when present.
 *
 * We never use Euler angles for the view directly (they gimbal-lock when you
 * point straight up, which is the stargazing pose). Instead we take the
 * camera's look direction and the screen's "up" vector in East/North/Up space
 * and derive yaw (azimuth), pitch (altitude) and roll from those vectors.
 */

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3]; // rows; maps device xyz → ENU

export interface View {
  /** Azimuth of the view centre, radians, N=0, E=+π/2. */
  yaw: number;
  /** Altitude of the view centre, radians. */
  pitch: number;
  /** Rotation of the screen around the view axis, radians. */
  roll: number;
  /** Unit vectors in ENU: where the camera looks, screen right, screen up. */
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

const D2R = Math.PI / 180;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mulMV = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/** W3C rotation matrix R = Rz(alpha)·Rx(beta)·Ry(gamma), device frame → earth frame. */
function matrixFromEuler(alpha: number, beta: number, gamma: number): Mat3 {
  const [cA, sA] = [Math.cos(alpha), Math.sin(alpha)];
  const [cB, sB] = [Math.cos(beta), Math.sin(beta)];
  const [cG, sG] = [Math.cos(gamma), Math.sin(gamma)];
  // Earth frame of DeviceOrientation: x = East, y = North, z = Up (when alpha
  // is absolute). Rows are earth axes, columns device axes.
  return [
    [cA * cG - sA * sB * sG, -sA * cB, cA * sG + sA * sB * cG],
    [sA * cG + cA * sB * sG, cA * cB, sA * sG - cA * sB * cG],
    [-cB * sG, sB, cB * cG],
  ];
}

/** Derive the engine view from a device→ENU matrix, accounting for screen rotation. */
export function viewFromMatrix(m: Mat3, screenAngleDeg: number): View {
  // Back camera looks along device -z; screen up is device +y in portrait,
  // rotated by the current screen orientation.
  const forward = norm(mulMV(m, [0, 0, -1]));
  const a = screenAngleDeg * D2R;
  const upDevice: Vec3 = [Math.sin(a), Math.cos(a), 0];
  const rightDevice: Vec3 = [Math.cos(a), -Math.sin(a), 0];
  const up = norm(mulMV(m, upDevice));
  const right = norm(mulMV(m, rightDevice));

  const yaw = Math.atan2(forward[0], forward[1]); // atan2(E, N)
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward[2])));
  // Reference frame for roll = 0: "up" is towards the zenith along the
  // meridian through the view centre.
  const refUp: Vec3 = [
    -Math.sin(pitch) * Math.sin(yaw),
    -Math.sin(pitch) * Math.cos(yaw),
    Math.cos(pitch),
  ];
  const refRight: Vec3 = [Math.cos(yaw), -Math.sin(yaw), 0];
  const roll = Math.atan2(dot(up, refRight), dot(up, refUp));
  return { yaw, pitch, roll, forward, right, up };
}

/**
 * Exponential smoothing on vectors (not angles) so wrap-around at north and
 * the zenith never cause jumps. Time-based, so 60 Hz and 120 Hz feel the same.
 */
class VecSmoother {
  private f: Vec3 | null = null;
  private u: Vec3 | null = null;
  private t = 0;
  constructor(private tauMs: number) {}
  push(f: Vec3, u: Vec3): [Vec3, Vec3] {
    const now = performance.now();
    if (!this.f || !this.u || now - this.t > 500) {
      this.f = f;
      this.u = u;
    } else {
      const k = 1 - Math.exp(-(now - this.t) / this.tauMs);
      this.f = norm([this.f[0] + (f[0] - this.f[0]) * k, this.f[1] + (f[1] - this.f[1]) * k, this.f[2] + (f[2] - this.f[2]) * k]);
      this.u = norm([this.u[0] + (u[0] - this.u[0]) * k, this.u[1] + (u[1] - this.u[1]) * k, this.u[2] + (u[2] - this.u[2]) * k]);
    }
    this.t = now;
    return [this.f, this.u];
  }
}

export interface SensorController {
  /** inApp: the native shell supplies motion, so skip the web permission prompt. */
  start(inApp: boolean): Promise<boolean>;
  stop(): void;
  readonly active: boolean;
  /** Feed a device→ENU matrix from the native shell (CoreMotion true north). */
  pushNativeMatrix(m: Mat3): void;
}

/**
 * `onView` fires with a smoothed view as soon as a new reading arrives, so the
 * engine gets it before its next frame (no one-frame lag).
 */
export function createSensors(onView: (v: View) => void): SensorController {
  let active = false;
  let nativeAt = 0;
  // alpha on iOS is relative to an arbitrary start; this offset (radians)
  // anchors it to north using webkitCompassHeading.
  let alphaOffset: number | null = null;
  const smoother = new VecSmoother(70);

  const screenAngle = () =>
    (screen.orientation?.angle ?? (window as any).orientation ?? 0) as number;

  const emit = (m: Mat3, screenDeg: number) => {
    const raw = viewFromMatrix(m, screenDeg);
    const [f, u] = smoother.push(raw.forward, raw.up);
    // Rebuild a consistent, orthonormal view from the smoothed vectors.
    const right = norm([f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]]);
    const up = norm([right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]]);
    const ortho: Mat3 = [
      [right[0], up[0], -f[0]],
      [right[1], up[1], -f[1]],
      [right[2], up[2], -f[2]],
    ];
    onView(viewFromMatrix(ortho, 0));
  };

  const onOrientation = (e: DeviceOrientationEvent) => {
    if (!active || Date.now() - nativeAt < 500) return; // native source wins
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const heading = (e as any).webkitCompassHeading as number | undefined;
    const accuracy = (e as any).webkitCompassAccuracy as number | undefined;
    let alpha = e.alpha * D2R;
    // Only trust the compass while the phone is tilted up between 15° and 75°
    // and not twisted: past 90° the top edge points behind you and iOS's
    // heading can flip by 180°. Outside that window, keep the last offset
    // (the gyro holds it steady).
    const comfy = e.beta > 15 && e.beta < 75 && Math.abs(e.gamma) < 30;
    const good = accuracy == null || (accuracy >= 0 && accuracy < 25);
    if (typeof heading === "number" && !Number.isNaN(heading) && (comfy || alphaOffset == null) && good) {
      const target = -heading * D2R - alpha;
      if (alphaOffset == null) alphaOffset = target;
      else {
        const d = Math.atan2(Math.sin(target - alphaOffset), Math.cos(target - alphaOffset));
        alphaOffset += d * 0.05;
      }
    } else if ((e as any).absolute && alphaOffset == null) {
      alphaOffset = 0;
    }
    alpha += alphaOffset ?? 0;
    emit(matrixFromEuler(alpha, e.beta * D2R, e.gamma * D2R), screenAngle());
  };

  return {
    get active() {
      return active;
    },
    async start(inApp: boolean) {
      const DOE = (window as any).DeviceOrientationEvent;
      if (!inApp && DOE && typeof DOE.requestPermission === "function") {
        try {
          if ((await DOE.requestPermission()) !== "granted") return false;
        } catch {
          return false;
        }
      }
      window.addEventListener("deviceorientation", onOrientation, true);
      active = true;
      return true;
    },
    stop() {
      window.removeEventListener("deviceorientation", onOrientation, true);
      active = false;
    },
    pushNativeMatrix(m: Mat3) {
      nativeAt = Date.now();
      // Native matrices are already in the portrait device frame.
      if (active) emit(m, screenAngle());
    },
  };
}
