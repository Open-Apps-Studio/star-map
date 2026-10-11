import Foundation
import Network

/// TCP client for a telescope on the local network. Speaks two protocols:
///
/// - Stellarium Telescope Protocol (binary, little endian; port 10001 by
///   default). Goto: LENGTH=20, TYPE=0, TIME (µs), RA (uint32, 2^32 = 24h),
///   DEC (int32, 2^30 = 90°). The server streams CurrentPosition messages
///   (LENGTH=24 … STATUS). Coordinates are J2000.
/// - Meade LX200 over TCP (ASCII; SkyFi, SynScan/StarSense Wi-Fi, OnStep):
///   ":Sr HH:MM:SS#", ":Sd sDD*MM:SS#", ":MS#" to slew; ":GR#" / ":GD#"
///   polled once a second for the position. Coordinates are of date (JNow).
///
/// Positions go to `onEvent` in the protocol's own frame (radians); the page
/// converts between J2000 and JNow.
final class TelescopeClient {
  enum Proto: String { case stellarium, lx200 }

  private let queue = DispatchQueue(label: "starmap.telescope")
  private var conn: NWConnection?
  private var proto: Proto = .stellarium
  private var buffer = Data()
  private var pollTimer: DispatchSourceTimer?
  /// LX200 replies arrive in order; remember what each pending one answers.
  private var pending: [String] = []
  private var lxRa: Double?
  private let onEvent: ([String: Any]) -> Void

  init(onEvent: @escaping ([String: Any]) -> Void) {
    self.onEvent = onEvent
  }

  func connect(host: String, port: Int, proto: String) {
    queue.async {
      self.closeLocked()
      self.proto = Proto(rawValue: proto) ?? .stellarium
      guard let p = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
        self.onEvent(["status": "error", "message": "Invalid port"])
        return
      }
      let tcp = NWProtocolTCP.Options()
      tcp.connectionTimeout = 8
      tcp.noDelay = true
      let c = NWConnection(host: NWEndpoint.Host(host), port: p, using: NWParameters(tls: nil, tcp: tcp))
      self.conn = c
      self.onEvent(["status": "connecting"])
      c.stateUpdateHandler = { [weak self] state in
        guard let self, self.conn === c else { return }
        switch state {
        case .ready:
          self.onEvent(["status": "connected"])
          self.receive(c)
          if self.proto == .lx200 { self.startPolling() }
        case .waiting(let err):
          // No route yet (Wi-Fi changing, or iOS is asking for Local Network
          // access). Keep trying for a while before giving up.
          self.onEvent(["status": "connecting", "message": Self.describe(err)])
          self.queue.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self, self.conn === c, c.state != .ready else { return }
            self.onEvent(["status": "error", "message": Self.describe(err)])
            self.closeLocked()
          }
        case .failed(let err):
          self.onEvent(["status": "error", "message": Self.describe(err)])
          self.closeLocked()
        case .cancelled:
          break
        default:
          break
        }
      }
      c.start(queue: self.queue)
    }
  }

  func disconnect() {
    queue.async {
      self.closeLocked()
      self.onEvent(["status": "off"])
    }
  }

  /// Slew to RA/Dec (radians) in the protocol's frame.
  func goto(ra: Double, dec: Double) {
    queue.async {
      guard let c = self.conn else { return }
      switch self.proto {
      case .stellarium:
        var msg = Data()
        func put<T: FixedWidthInteger>(_ v: T) { withUnsafeBytes(of: v.littleEndian) { msg.append(contentsOf: $0) } }
        let raNorm = (ra.truncatingRemainder(dividingBy: 2 * .pi) + 2 * .pi).truncatingRemainder(dividingBy: 2 * .pi)
        put(UInt16(20))
        put(UInt16(0))
        put(Int64(Date().timeIntervalSince1970 * 1_000_000))
        put(UInt32(clamping: Int64((raNorm / (2 * .pi)) * 4_294_967_296.0) & 0xFFFF_FFFF))
        put(Int32(clamping: Int64((dec / (.pi / 2)) * 1_073_741_824.0)))
        c.send(content: msg, completion: .contentProcessed { _ in })
      case .lx200:
        let raH = ((ra * 12 / .pi).truncatingRemainder(dividingBy: 24) + 24).truncatingRemainder(dividingBy: 24)
        let raS = Int((raH * 3600).rounded()) % 86400
        let decS = Int((abs(dec) * 180 / .pi * 3600).rounded())
        let cmd = String(format: ":Sr %02d:%02d:%02d#", raS / 3600, raS / 60 % 60, raS % 60)
          + String(format: ":Sd %@%02d*%02d:%02d#", dec < 0 ? "-" : "+", decS / 3600, decS / 60 % 60, decS % 60)
          + ":MS#"
        self.pending += ["Sr", "Sd", "MS"]
        c.send(content: cmd.data(using: .ascii), completion: .contentProcessed { _ in })
      }
    }
  }

  // MARK: - Internals (all on `queue`)

  private func closeLocked() {
    pollTimer?.cancel()
    pollTimer = nil
    conn?.stateUpdateHandler = nil
    conn?.cancel()
    conn = nil
    buffer.removeAll()
    pending.removeAll()
    lxRa = nil
  }

  private func receive(_ c: NWConnection) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, done, err in
      guard let self, self.conn === c else { return }
      if let data, !data.isEmpty {
        self.buffer.append(data)
        self.proto == .stellarium ? self.parseStellarium() : self.parseLX200()
      }
      if done || err != nil {
        self.onEvent(["status": "error", "message": err.map(Self.describe) ?? "Telescope closed the connection"])
        self.closeLocked()
        return
      }
      self.receive(c)
    }
  }

  private func parseStellarium() {
    while buffer.count >= 2 {
      let len = Int(buffer[buffer.startIndex]) | Int(buffer[buffer.startIndex + 1]) << 8
      if len < 4 { buffer.removeAll(); return }
      guard buffer.count >= len else { return }
      let msg = buffer.prefix(len)
      buffer.removeFirst(len)
      guard len >= 24 else { continue }
      func read<T: FixedWidthInteger>(_ off: Int, _: T.Type) -> T {
        var v: T = 0
        withUnsafeMutableBytes(of: &v) { $0.copyBytes(from: msg[(msg.startIndex + off)..<(msg.startIndex + off + MemoryLayout<T>.size)]) }
        return T(littleEndian: v)
      }
      let ra = Double(read(12, UInt32.self)) / 4_294_967_296.0 * 2 * .pi
      let dec = Double(read(16, Int32.self)) / 1_073_741_824.0 * (.pi / 2)
      onEvent(["status": "connected", "ra": ra, "dec": dec])
    }
  }

  private func startPolling() {
    let t = DispatchSource.makeTimerSource(queue: queue)
    t.schedule(deadline: .now() + 0.2, repeating: 1.0)
    t.setEventHandler { [weak self] in
      guard let self, let c = self.conn, self.pending.count < 6 else { return }
      self.pending += ["GR", "GD"]
      c.send(content: ":GR#:GD#".data(using: .ascii), completion: .contentProcessed { _ in })
    }
    t.resume()
    pollTimer = t
  }

  private func parseLX200() {
    // Slew replies are single characters with no '#': "1" (Sr/Sd ok), "0" (MS ok).
    while !buffer.isEmpty, let what = pending.first {
      if what == "Sr" || what == "Sd" || what == "MS" {
        let ch = buffer[buffer.startIndex]
        buffer.removeFirst()
        pending.removeFirst()
        if what == "MS" && ch != UInt8(ascii: "0") {
          // "1<reason>#" / "2<reason>#": below horizon, etc. Drop the text.
          if let end = buffer.firstIndex(of: UInt8(ascii: "#")) { buffer.removeSubrange(buffer.startIndex...end) }
          onEvent(["status": "connected", "warning": "The telescope refused the slew (below its limits?)"])
        }
        continue
      }
      guard let end = buffer.firstIndex(of: UInt8(ascii: "#")) else { return }
      let text = String(decoding: buffer[buffer.startIndex..<end], as: UTF8.self)
      buffer.removeSubrange(buffer.startIndex...end)
      pending.removeFirst()
      if what == "GR" { lxRa = Self.parseSexagesimal(text).map { $0 * 15 * .pi / 180 } }
      if what == "GD", let dec = Self.parseSexagesimal(text), let ra = lxRa {
        onEvent(["status": "connected", "ra": ra, "dec": dec * .pi / 180])
      }
    }
  }

  /// "HH:MM:SS", "HH:MM.T", "sDD*MM:SS", "sDD*MM", "sDD°MM'SS" → hours/degrees.
  static func parseSexagesimal(_ s: String) -> Double? {
    let neg = s.hasPrefix("-")
    let parts = s.split(whereSeparator: { !("0"..."9").contains($0) && $0 != "." }).compactMap { Double($0) }
    guard !parts.isEmpty else { return nil }
    var v = parts[0]
    if parts.count > 1 { v += parts[1] / 60 }
    if parts.count > 2 { v += parts[2] / 3600 }
    return neg ? -v : v
  }

  static func describe(_ e: Error) -> String {
    if let nw = e as? NWError {
      switch nw {
      case .posix(let code) where code == .ECONNREFUSED: return "Connection refused (is the telescope server running?)"
      case .posix(let code) where code == .ETIMEDOUT: return "No answer from that address"
      case .posix(let code) where code == .EHOSTUNREACH || code == .ENETUNREACH: return "Can't reach that address (same Wi-Fi?)"
      default: return nw.localizedDescription
      }
    }
    return e.localizedDescription
  }
}
