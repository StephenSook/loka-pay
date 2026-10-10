import Foundation

/// Local receipt scheduling only; packet bytes and framing stay unchanged.
enum BleSendQueue {
    static func enqueue(_ frame: Data, queue: inout [Data], urgent: Bool, inFlight: Bool) throws {
        guard (1...16384).contains(frame.count) else { throw BleFrameError.invalid }
        let chunks = stride(from: 0, to: frame.count, by: 19).map { start -> Data in
            let end = min(start + 19, frame.count)
            return Data([UInt8((start == 0 ? 1 : 0) | (end == frame.count ? 2 : 0))]) + frame[start..<end]
        }
        // A retry must not append another complete copy already waiting on this link.
        if queue.count >= chunks.count {
            for start in 0...(queue.count - chunks.count) where queue[start] == chunks[0] {
                if queue[start..<(start + chunks.count)].elementsEqual(chunks) { return }
            }
        }
        guard queue.count + chunks.count <= (urgent ? 2048 : 1920) else { throw BleFrameError.invalid }
        guard urgent else { queue.append(contentsOf: chunks); return }
        var keep = 0
        while keep < queue.count {
            let flags = queue[keep].first ?? 255
            if flags > 3 { keep += 1; continue }
            if (keep == 0 && inFlight) || flags & 1 == 0 {
                repeat {
                    let end = queue[keep].first ?? 255; keep += 1
                    if end <= 3 && end & 2 != 0 { break }
                } while keep < queue.count
            } else { break }
        }
        queue.insert(contentsOf: chunks, at: keep)
    }
}

/// Discovery selects an untrusted next hop, never a contact. Pace failing candidates.
struct NearbyCandidatePolicy {
    private var attempted: [UUID: TimeInterval] = [:]
    mutating func reset() { attempted.removeAll() }
    mutating func take(_ id: UUID, now: TimeInterval) -> Bool {
        attempted = attempted.filter { now - $0.value < 30 }
        guard attempted[id] == nil, attempted.count < 32 else { return false }
        attempted[id] = now
        return true
    }
}

/// Monotonic setup deadline, also checked when returning from OS suspension.
struct LinkSetupDeadline {
    private var deadline: TimeInterval?
    mutating func begin(now: TimeInterval) { deadline = now + 20 }
    mutating func cancel() { deadline = nil }
    func expired(now: TimeInterval) -> Bool { deadline.map { now >= $0 } ?? false }
}

/// Bounded rediscovery backoff; discovering a route never grants contact trust.
struct LinkRecovery {
    private var attempts = 0
    mutating func reset() { attempts = 0 }
    mutating func nextDelay(enabled: Bool, canDiscover: Bool) -> TimeInterval? {
        guard enabled, canDiscover, attempts < 6 else { return nil }
        let delay = min(pow(2, Double(attempts)), 30)
        attempts += 1
        return delay
    }
}

/// Bounded foreground checks for an explicitly selected local phone.
/// A successful probe proves a transport path, never a friend's identity or delivery.
struct LinkApprovalChecks {
    private var deadline: TimeInterval?
    private var nextAttempt: TimeInterval = 0
    private var remaining = 0
    mutating func begin(now: TimeInterval) {
        deadline = now + 60; nextAttempt = now; remaining = 20
    }
    func active(now: TimeInterval) -> Bool { deadline.map { now < $0 && remaining > 0 } ?? false }
    mutating func takeAttempt(now: TimeInterval) -> Bool {
        guard active(now: now), now >= nextAttempt else { return false }
        remaining -= 1; nextAttempt = now + 3; return true
    }
    mutating func cancel() { deadline = nil; remaining = 0 }
}

enum BleFrameError: Error { case invalid }
struct BleFrameAssembler {
    private var bytes = Data()
    private var assembling = false
    private var last: TimeInterval = 0
    mutating func accept(_ chunk: Data, now: TimeInterval) throws -> Data? {
        do {
            guard (2...20).contains(chunk.count), let flags = chunk.first, flags <= 3 else { throw BleFrameError.invalid }
            if flags & 1 != 0 { bytes.removeAll(); assembling = true }
            guard assembling, (flags & 1 != 0 || (0...10).contains(now - last)), bytes.count + chunk.count - 1 <= 16384 else { throw BleFrameError.invalid }
            last = now; bytes.append(contentsOf: chunk.dropFirst())
            if flags & 2 != 0 { let frame = bytes; bytes.removeAll(); assembling = false; return frame }
            return nil
        } catch { bytes.removeAll(); assembling = false; throw error }
    }
}

/// Shared TCP framing: four-byte big-endian length, followed by unchanged packet-v0.
enum LocalWifiFraming {
    static func isPrivateIPv4(_ address: Data) -> Bool {
        let bytes = Array(address)
        guard bytes.count == 4 else { return false }
        return bytes[0] == 10 || (bytes[0] == 172 && (16...31).contains(bytes[1])) ||
            (bytes[0] == 192 && bytes[1] == 168)
    }

    static func header(_ count: Int) throws -> Data {
        guard (1...16384).contains(count) else { throw BleFrameError.invalid }
        let value = UInt32(count)
        return Data([UInt8((value >> 24) & 255), UInt8((value >> 16) & 255), UInt8((value >> 8) & 255), UInt8(value & 255)])
    }
    static func length(_ data: Data) throws -> Int {
        guard data.count == 4 else { throw BleFrameError.invalid }
        let value = data.reduce(0) { ($0 << 8) | Int($1) }
        guard (1...16384).contains(value) else { throw BleFrameError.invalid }
        return value
    }
}

/// Aggregate usable transports, not recipient reachability or delivery confirmation.
struct LocalRouteState {
    private var bluetoothReady = false
    private var wifiReady = false
    private var awareReady = false
    private var peripheralReady = false
    private var additionalReady = false
    var available: Bool { bluetoothReady || wifiReady || awareReady || peripheralReady || additionalReady }
    mutating func updateAdditional(ready: Bool) -> Bool {
        let previous = available; additionalReady = ready; return previous != available
    }
    mutating func updatePeripheral(ready: Bool) -> Bool {
        let previous = available; peripheralReady = ready; return previous != available
    }
    mutating func updateAware(ready: Bool) -> Bool {
        let previous = available; awareReady = ready; return previous != available
    }
    mutating func update(wifi: Bool, ready: Bool) -> Bool {
        let previous = available
        if wifi { wifiReady = ready } else { bluetoothReady = ready }
        return previous != available
    }
}

/// Bound complete frames/probes before expensive identity processing (8 burst, 4/s).
struct BleAdmissionBudget {
    private var tokens = 8.0
    private var last: TimeInterval?
    mutating func take(now: TimeInterval) -> Bool {
        guard now.isFinite else { return false }
        if let last { tokens = min(8, tokens + max(0, now - last) * 4) }
        last = now
        guard tokens >= 1 else { return false }
        tokens -= 1
        return true
    }
}

/// Only central-side handles share CBPeripheral identifiers. Incoming CBCentral IDs
/// must not be guessed to represent the same radio identity.
enum NearbyRadioKey {
    static func applePeripheral(_ handle: String) -> String? {
        let prefix = handle.hasPrefix("ble:extra:") ? "ble:extra:" : "ble:"
        guard handle.hasPrefix(prefix), let id = UUID(uuidString: String(handle.dropFirst(prefix.count))) else { return nil }
        return id.uuidString
    }
}
