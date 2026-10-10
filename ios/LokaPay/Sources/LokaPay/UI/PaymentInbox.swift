import Foundation
import Observation

/// One received transport text, with when it first arrived (for the age limit) and its place in
/// arrival order (a sequence number given once, on delivery). Both stay with the text through every
/// hand-over, so going round a payment, a release or a takeover never moves it in line, even when
/// two texts share a timestamp or the phone's clock moves backwards.
struct InboxText: Equatable, Sendable {
    let text: String
    let arrivedAt: Date
    let sequence: UInt64
}

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
    /// A held or queued text older than this is dropped (and counted) instead of being handed over
    /// or checked: a payer who sent it has likely left the till.
    public nonisolated static let defaultMaxAge: TimeInterval = 300

    /// Held texts, in arrival order: no screen can take them now (none is attached, or the attached
    /// one is on a payment and gave them back until `release()`).
    private var waiting: [InboxText] = []
    /// Texts handed to the attached screen that its consumer has not started, in arrival order. One
    /// FIFO for whichever screen is attached: a newer screen takes it over as it is, and texts go
    /// back to `waiting` when no screen is attached.
    @ObservationIgnored private var queued: [InboxText] = []
    /// Counts attachments: each `attach` and each detach begins a new one. A consumer takes texts
    /// only with the attachment it got from `attach`.
    @ObservationIgnored private var generation: UInt64 = 0
    /// The next arrival sequence number. It only grows, whatever the phone's clock does.
    @ObservationIgnored private var nextSequence: UInt64 = 0
    /// Held texts, oldest first.
    public var held: [String] { waiting.map(\.text) }
    /// Queued texts, oldest first (for tests).
    var queuedTexts: [String] { queued.map(\.text) }
    /// Texts dropped because the inbox was full (held and queued texts together past `capacity`;
    /// the oldest go first) or because they waited longer than `maxAge`. The Receive screen shows
    /// this count when it is not zero.
    public private(set) var droppedWhileDetached = 0
    /// Told the sequence number of every text this inbox drops (full, or past `maxAge`), so the mesh
    /// glue can record that delivery's fate for as long as it remembers the packet: a retry of a
    /// dropped delivery is delivered again, a retry of one still waiting or taken is not.
    @ObservationIgnored var onDrop: (@MainActor (UInt64) -> Void)?

    public let maxAge: TimeInterval
    private let now: @MainActor () -> Date
    @ObservationIgnored private var listener: ObjectIdentifier?
    /// Takes one text: the screen counts what it can never accept and calls `enqueue` for the rest.
    /// Returns false when its model is gone; the inbox then detaches and holds the text.
    @ObservationIgnored private var handler: (@MainActor (InboxText) -> Bool)?

    public init(maxAge: TimeInterval = PaymentInbox.defaultMaxAge, now: @escaping @MainActor () -> Date = { Date() }) {
        self.maxAge = maxAge
        self.now = now
    }

    /// True while a Receive screen is taking texts.
    public var isAttached: Bool { handler != nil }

    /// Hands one received transport text to the attached Receive model, or holds it. Its arrival
    /// time and its place in line are fixed here, once. Returns its sequence number: the id of this
    /// delivery, which stays with the text (`InboxText.sequence`).
    @discardableResult
    public func deliver(_ text: String) -> UInt64 {
        let item = stamp(text, arrivedAt: now())
        if let handler {
            if handler(item) { return item.sequence }
            unhook()
        }
        hold(item)
        return item.sequence
    }

    private func recordDrop(_ item: InboxText) {
        onDrop?(item.sequence)
    }

    private func stamp(_ text: String, arrivedAt: Date) -> InboxText {
        nextSequence &+= 1
        return InboxText(text: text, arrivedAt: arrivedAt, sequence: nextSequence)
    }

    /// Queues a text for the attached screen's consumer (its handler calls this for each text it
    /// may accept), in its place in arrival order. Held and queued texts together stay within
    /// `capacity`; past it, the text that arrived first is dropped and counted.
    func enqueue(_ item: InboxText) {
        Self.insert(item, into: &queued)
        enforceCapacity()
    }

    /// The next queued text for `owner`'s consumer, oldest first; nil when the queue is empty or
    /// `attachment` no longer owns the inbox (the screen went away, or a newer one took over), so a
    /// text is never checked by a screen that is not shown. A text that waited past `maxAge` behind
    /// a busy consumer is dropped and counted first, never handed over.
    func takeNext(for owner: AnyObject, attachment: UInt64) -> InboxText? {
        guard listener == ObjectIdentifier(owner), generation == attachment else { return nil }
        dropExpired()
        guard !queued.isEmpty else { return nil }
        return queued.removeFirst()
    }

    /// True when texts wait in the queue for the attached screen's consumer.
    var hasQueued: Bool { !queued.isEmpty }

    /// Keeps `item` until a Receive screen can take it: none is attached, or the attached one is on
    /// a payment and calls `release()` when it is ready for the next payer. The text keeps its first
    /// arrival time and place in line, so going round a payment never restarts its `maxAge` and
    /// never moves it behind a later text.
    func hold(_ item: InboxText) {
        Self.insert(item, into: &waiting)
        dropExpired()
        enforceCapacity()
    }

    /// Hands every held text that is not too old to the listener again, in arrival order.
    func release() {
        dropExpired()
        let texts = waiting
        waiting = []
        for item in texts {
            if let handler {
                if handler(item) { continue }
                unhook()
            }
            // Re-held, in its place.
            Self.insert(item, into: &waiting)
        }
    }

    /// Makes `owner` the listener and hands it every held text in arrival order. Returns the
    /// attachment its consumer takes queued texts with. Texts a replaced screen had queued stay
    /// queued, in arrival order and inside `capacity`, for the new listener.
    @discardableResult
    func attach(_ owner: AnyObject, handler: @escaping @MainActor (InboxText) -> Bool) -> UInt64 {
        generation &+= 1
        listener = ObjectIdentifier(owner)
        self.handler = handler
        release()
        return generation
    }

    /// Detaches only when `owner` is still the listener: a newer screen may have attached first.
    func detach(_ owner: AnyObject) {
        guard listener == ObjectIdentifier(owner) else { return }
        unhook()
    }

    /// No screen takes texts now: queued ones go back to the held list in their places, so nothing
    /// is checked for a screen that is not shown and nothing is lost.
    private func unhook() {
        generation &+= 1
        listener = nil
        handler = nil
        let returned = queued
        queued = []
        for item in returned { Self.insert(item, into: &waiting) }
        dropExpired()
        enforceCapacity()
    }

    /// Drops the text that arrived first (lowest sequence), held or queued, until both fit
    /// `capacity` together.
    private func enforceCapacity() {
        while waiting.count + queued.count > Self.capacity {
            if let oldestHeld = waiting.first, queued.first.map({ oldestHeld.sequence < $0.sequence }) ?? true {
                recordDrop(waiting.removeFirst())
            } else {
                recordDrop(queued.removeFirst())
            }
            droppedWhileDetached += 1
        }
    }

    /// Inserts by arrival sequence, so a list stays in arrival order whatever the timestamps say.
    private static func insert(_ item: InboxText, into list: inout [InboxText]) {
        let index = list.firstIndex(where: { $0.sequence > item.sequence }) ?? list.endIndex
        list.insert(item, at: index)
    }

    /// Drops and counts every held or queued text older than `maxAge`, by its first arrival time.
    /// `release()` (so every attach and takeover) and `takeNext` run it before handing a text over.
    private func dropExpired() {
        let cutoff = now().addingTimeInterval(-maxAge)
        let before = waiting.count + queued.count
        for item in (waiting + queued) where item.arrivedAt < cutoff { recordDrop(item) }
        waiting.removeAll { $0.arrivedAt < cutoff }
        queued.removeAll { $0.arrivedAt < cutoff }
        let dropped = before - waiting.count - queued.count
        // Assigned only on a real drop: an observed write would refresh the screen for nothing.
        if dropped > 0 { droppedWhileDetached += dropped }
    }

    // MARK: - For tests

    /// Holds a text that first arrived at `arrivedAt`, as the newest in line.
    func hold(_ text: String, arrivedAt: Date) {
        hold(stamp(text, arrivedAt: arrivedAt))
    }

    /// Queues a text that first arrived at `arrivedAt`, as the newest in line.
    func enqueue(_ text: String, arrivedAt: Date) {
        enqueue(stamp(text, arrivedAt: arrivedAt))
    }
}
