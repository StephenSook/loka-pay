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
    /// before the screen appears, or during another payment, is not lost. Bounded, so a radio peer
    /// cannot grow it without limit.
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
    /// Held texts dropped because the inbox was full (the oldest go first) or because they waited
    /// longer than `maxAge`. The Receive screen shows this count when it is not zero.
    public private(set) var droppedWhileDetached = 0

    public let maxAge: TimeInterval
    private let now: @MainActor () -> Date
    @ObservationIgnored private var listener: ObjectIdentifier?
    /// Returns false when its model is gone; the inbox then detaches and holds the text.
    @ObservationIgnored private var handler: (@MainActor (String) -> Bool)?

    public init(maxAge: TimeInterval = PaymentInbox.defaultMaxAge, now: @escaping @MainActor () -> Date = { Date() }) {
        self.maxAge = maxAge
        self.now = now
    }

    /// True while a Receive screen is taking texts.
    public var isAttached: Bool { handler != nil }

    /// Hands one received transport text to the attached Receive model, or holds it.
    public func deliver(_ text: String) {
        if let handler {
            if handler(text) { return }
            listener = nil
            self.handler = nil
        }
        hold(text)
    }

    /// Keeps `text` until a Receive screen can take it: none is attached, or the attached one is
    /// on a payment and calls `release()` when it is ready for the next payer.
    func hold(_ text: String) {
        dropExpired()
        waiting.append(Held(text: text, at: now()))
        if waiting.count > Self.capacity {
            waiting.removeFirst()
            droppedWhileDetached += 1
        }
    }

    /// Hands every held text that is not too old to the listener again, in arrival order.
    func release() {
        dropExpired()
        let texts = waiting
        waiting = []
        for item in texts {
            if let handler {
                if handler(item.text) { continue }
                listener = nil
                self.handler = nil
            }
            // Re-held with its first arrival time.
            waiting.append(item)
        }
    }

    /// Makes `owner` the listener and hands it every held text in arrival order.
    func attach(_ owner: AnyObject, handler: @escaping @MainActor (String) -> Bool) {
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
