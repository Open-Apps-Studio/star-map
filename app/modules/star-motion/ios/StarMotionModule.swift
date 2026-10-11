import CoreMotion
import ExpoModulesCore

/// Streams the phone's orientation as a device → East/North/Up rotation matrix,
/// using CoreMotion's true-north reference frame (gyro + accelerometer +
/// magnetometer fusion, magnetic declination already applied).
///
/// The sky page turns that matrix into where the camera points and which way
/// the screen is "up", so there are no Euler angles and no gimbal lock when you
/// point straight up.
public class StarMotionModule: Module {
  private let manager = CMMotionManager()
  private let queue = OperationQueue()
  /// Whether CMRotationMatrix maps reference → device (needs transposing).
  /// Settled at runtime by checking which reading puts gravity straight down.
  private var transpose: Bool?

  public func definition() -> ModuleDefinition {
    Name("StarMotion")
    Events("onMotion")

    Function("isAvailable") { () -> Bool in
      self.manager.isDeviceMotionAvailable
        && CMMotionManager.availableAttitudeReferenceFrames().contains(.xMagneticNorthZVertical)
    }

    /// trueNorth needs a known location (iOS ties the true-north frame to it);
    /// without location permission use magnetic north and let the page
    /// correct for declination.
    Function("start") { (hz: Double, trueNorth: Bool) in
      self.start(hz: hz, trueNorth: trueNorth)
    }

    Function("stop") {
      self.manager.stopDeviceMotionUpdates()
    }

    /// Page errors from the sky WebView, so they show up in the device log
    /// (Console.app / `log stream`) even in release builds.
    Function("log") { (text: String) in
      NSLog("[StarMap sky] %@", text)
    }

    OnDestroy {
      self.manager.stopDeviceMotionUpdates()
    }
  }

  private func start(hz: Double, trueNorth: Bool) {
    guard manager.isDeviceMotionAvailable else { return }
    manager.deviceMotionUpdateInterval = 1.0 / max(10, min(hz, 120))
    // Let iOS show its figure-8 compass calibration prompt when needed.
    manager.showsDeviceMovementDisplay = true
    queue.maxConcurrentOperationCount = 1
    let frames = CMMotionManager.availableAttitudeReferenceFrames()
    let frame: CMAttitudeReferenceFrame =
      trueNorth && frames.contains(.xTrueNorthZVertical) ? .xTrueNorthZVertical : .xMagneticNorthZVertical
    manager.startDeviceMotionUpdates(using: frame, to: queue) { [weak self] motion, _ in
      guard let self, let motion else { return }
      self.emit(motion)
    }
  }

  private func emit(_ motion: CMDeviceMotion) {
    let r = motion.attitude.rotationMatrix
    // A maps device coordinates → reference frame (x = north, y = west, z = up)
    // if `transpose` is false; otherwise use its transpose.
    let a: [[Double]] = [
      [r.m11, r.m12, r.m13],
      [r.m21, r.m22, r.m23],
      [r.m31, r.m32, r.m33],
    ]
    let at: [[Double]] = [
      [r.m11, r.m21, r.m31],
      [r.m12, r.m22, r.m32],
      [r.m13, r.m23, r.m33],
    ]
    // Gravity (device frame) must map to straight down (0, 0, -1) in the
    // reference frame. Pick whichever orientation of the matrix does that.
    let g = motion.gravity
    let gv = [g.x, g.y, g.z]
    func mul(_ m: [[Double]], _ v: [Double]) -> [Double] {
      return (0..<3).map { i in m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2] }
    }
    let norm = (g.x * g.x + g.y * g.y + g.z * g.z).squareRoot()
    if norm > 0.5 {
      let za = mul(a, gv)[2] / norm
      let zt = mul(at, gv)[2] / norm
      // Only decide once the evidence is clear (phone not flat-on-axis).
      if abs(za - zt) > 0.3 { transpose = zt < za }
    }
    let m = (transpose ?? true) ? at : a
    // Reference axes: x = North, y = West, z = Up  →  ENU rows.
    let east = m[1].map { -$0 }
    let north = m[0]
    let up = m[2]
    sendEvent("onMotion", [
      "m": [east, north, up],
      "acc": motion.magneticField.accuracy.rawValue,
    ])
  }
}
