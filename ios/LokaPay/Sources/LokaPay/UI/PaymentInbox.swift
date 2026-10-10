import Foundation
import Observation

/// The Bluetooth inbound hook for the Receive screen (task 3.71; the 2.2 mesh glue feeds it).
/// The LokaMesh glue calls `deliver(_:)` with each received `L1|P|1|...` transport text, and the
/// Receive model checks it exactly like a scanned code. Pass one inbox as
/// `LokaPayDependencies.meshInbox`; the Receive screen mentions Bluetooth only when one is supplied.
///
/// A class rather than an `AsyncStream`: SwiftUI can build a model more than once and can rebuild
/// the screen with a new identity, while a stream allows a single consumer and ends for good when
/// that consumer's task is cancelled. Here the Receive screen on display attaches its model, and a
/// newer screen takes over from an older one.
@MainActor
@Observable
public final class PaymentInbox {
    /// Texts held while no Receive screen can take them (oldest first), so a payment that arrives
    /// before the screen appears, or during another payment, is not lost. The bound also covers
    /// texts the attached screen has queued and not started checking yet: held and queued together
    /// stay at or under it, so a radio peer cannot grow either without limit.
    public static let capacity = 16
    /// A held text older than this is dropped (and counted) instead of being handed over: a payer
    /// who sent it has likely left the till.
    public nonisolated static let defaultMaxAge: TimeInterval = 300

    private struct Held {
        let text: String
        let at: Date
    }

    private var waiting: [Held] = []
    /// Held texts, oldest first.
    public var held: [String] { waiting.map(\.text) }
    /// Texts dropped because the inbox was full (held and queued texts together at `capacity`; the
    /// oldest go first) or because they waited longer than `maxAge`. The Receive screen shows this
    /// count when it is not zero.
    public private(set) var droppedWhileDetached = 0

    public let maxAge: TimeInterval
    private let now: @MainActor () -> Date
    @ObservationIgnored private var listener: ObjectIdentifier?
    /// Takes a text and the time it first arrived. Returns false when its model is gone; the inbox
    /// then detaches and holds the text.
    @ObservationIgnored private var handler: (@MainActor (String, Date) -> Bool)?

    public init(maxAge: TimeInterval = PaymentInbox.defaultMaxAge, now: @escaping @MainActor () -> Date = { Date() }) {
        self.maxAge = maxAge
        self.now = now
    }

    /// True while a Receive screen is taking texts.
    public var isAttached: Bool { handler != nil }

    /// Hands one received transport text to the attached Receive model, or holds it.
    public func deliver(_ text: String) {
        let arrived = now()
        if let handler {
            if handler(text, arrived) { return }
            listener = nil
            self.handler = nil
        }
        hold(text, arrivedAt: arrived)
    }

    /// Keeps `text` until a Receive screen can take it: none is attached, or the attached one is
    /// on a payment and calls `release()` when it is ready for the next payer. `arrivedAt` is when
    /// the text first reached this inbox: a text handed over and given back keeps its first time,
    /// so going round a payment never restarts its `maxAge`.
    func hold(_ text: String, arrivedAt: Date) {
        waiting.append(Held(text: text, at: arrivedAt))
        dropExpired()
        if waiting.count > Self.capacity {
            waiting.removeFirst()
            droppedWhileDetached += 1
        }
    }

    /// When the oldest held text first arrived; nil when none is held.
    var oldestHeldArrival: Date? { waiting.map(\.at).min() }

    /// Drops and counts the held text that arrived first, to make room for a newer one.
    func dropOldestHeld() {
        guard let i = waiting.indices.min(by: { waiting[$0].at < waiting[$1].at }) else { return }
        waiting.remove(at: i)
        droppedWhileDetached += 1
    }

    /// Counts a text the attached screen dropped from its queue because the inbox was full.
    func recordDrop() {
        droppedWhileDetached += 1
    }

    /// Hands every held text that is not too old to the listener again, in arrival order.
    func release() {
        dropExpired()
        let texts = waiting
        waiting = []
        for item in texts {
            if let handler {
                if handler(item.text, item.at) { continue }
                listener = nil
                self.handler = nil
            }
            // Re-held with its first arrival time.
            waiting.append(item)
        }
    }

    /// Makes `owner` the listener and hands it every held text in arrival order.
    func attach(_ owner: AnyObject, handler: @escaping @MainActor (String, Date) -> Bool) {
        listener = ObjectIdentifier(owner)
        self.handler = handler
        release()
    }

    /// Detaches only when `owner` is still the listener: a newer screen may have attached first.
    func detach(_ owner: AnyObject) {
        guard listener == ObjectIdentifier(owner) else { return }
        listener = nil
        handler = nil
    }

    private func dropExpired() {
        let cutoff = now().addingTimeInterval(-maxAge)
        let before = waiting.count
        waiting.removeAll { $0.at < cutoff }
        // Assigned only on a real drop: an observed write would refresh the screen for nothing.
        if waiting.count < before { droppedWhileDetached += before - waiting.count }
    }
}
