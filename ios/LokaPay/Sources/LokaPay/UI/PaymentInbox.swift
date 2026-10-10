import Foundation

/// The Bluetooth inbound hook for the Receive screen (task 3.71; the 2.2 mesh glue feeds it).
/// The LokaMesh glue calls `deliver(_:)` with each received `L1|P|1|...` transport text, and the
/// Receive model checks it exactly like a scanned code. Pass one inbox as
/// `LokaPayDependencies.meshInbox`; the Receive screen mentions Bluetooth only when one is supplied.
///
/// A class rather than an `AsyncStream`: SwiftUI can build a model more than once and can rebuild
/// the screen with a new identity, while a stream allows a single consumer and ends for good when
/// that consumer's task is cancelled. Here the Receive screen on display attaches its model, and a
/// newer screen simply takes over.
@MainActor
public final class PaymentInbox {
    /// Texts held while no Receive screen is attached (oldest first), so a payment that arrives
    /// before the screen appears is not lost. Bounded, so a radio peer cannot grow it without limit.
    public static let capacity = 16
    public private(set) var held: [String] = []
    /// Texts dropped because `held` was full (the oldest go first). Counted, never silent.
    public private(set) var droppedWhileDetached = 0

    private var listener: ObjectIdentifier?
    /// Returns false when its model is gone; the inbox then detaches and holds the text.
    private var handler: (@MainActor (String) -> Bool)?

    public init() {}

    /// True while a Receive screen is taking texts.
    public var isAttached: Bool { handler != nil }

    /// Hands one received transport text to the attached Receive model, or holds it.
    public func deliver(_ text: String) {
        if let handler {
            if handler(text) { return }
            listener = nil
            self.handler = nil
        }
        held.append(text)
        if held.count > Self.capacity {
            held.removeFirst()
            droppedWhileDetached += 1
        }
    }

    /// Makes `owner` the listener and hands it every held text in arrival order.
    func attach(_ owner: AnyObject, handler: @escaping @MainActor (String) -> Bool) {
        listener = ObjectIdentifier(owner)
        self.handler = handler
        let waiting = held
        held = []
        for text in waiting { deliver(text) }
    }

    /// Detaches only when `owner` is still the listener: a newer screen may have attached first.
    func detach(_ owner: AnyObject) {
        guard listener == ObjectIdentifier(owner) else { return }
        listener = nil
        handler = nil
    }
}
