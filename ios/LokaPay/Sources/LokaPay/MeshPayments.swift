import CryptoKit
import Foundation
import Observation

/// LOKA Pay over the LOKA mesh, app side (protocol/PAYMENT-V1.md section 5; tasks 2.1, 2.2, 2.7).
/// Nothing here knows LOKA's types: a peer is the contact id the app uses, and the app's ChatStore
/// does the encrypting and the sending. Payment texts travel as ordinary encrypted LOKA content to
/// one contact at a time; nothing is broadcast.
public enum MeshPaymentText {
    /// Where one decrypted LOKA text goes.
    public enum Route: Equatable, Sendable {
        /// Not payment content. LOKA's own paths (chat, games, delivery and read receipts) take it
        /// unchanged.
        case loka
        /// `L1|P|1|...` from a contact, for the Receive screen's inbox: allowances and notes, and the
        /// kinds Receive counts and ignores (spend markers, confirmations, anything unknown).
        case receive
        /// `L1|P|1|Y|...` or `L1|P|1|X|...` from a contact: the merchant's ack or receipt, for Pay.
        case pay
        /// Payment family text that is not taken: another version of `L1|P`, or a sender that is not a
        /// contact (the payment-only scope for non-contacts is a follow-up of task 2.2). It is counted
        /// and never shown, stored or notified.
        case drop
    }

    /// The version 1 transport prefix.
    public static let prefix = "L1|P|1|"

    /// Sorts a decrypted text. Everything that starts with `L1|P` is payment family text and never
    /// reaches chat; only exactly `L1|P|1|` from a contact is delivered.
    public static func route(_ text: String, fromContact: Bool) -> Route {
        guard text.hasPrefix("L1|P") else { return .loka }
        guard fromContact, text.hasPrefix(prefix) else { return .drop }
        let rest = text.dropFirst(prefix.count)
        return rest.hasPrefix("Y|") || rest.hasPrefix("X|") ? .pay : .receive
    }

    /// The id of the note an `N`, `Y` or `X` text is about, read from its bytes WITHOUT verifying
    /// anything: routing only. The screens verify every text they act on. nil for other kinds and for
    /// text that does not parse.
    public static func noteId(of text: String) -> Data? {
        guard let decoded = try? PaymentTransport.decode(text) else { return nil }
        let bytes = Data(decoded.payload)
        switch decoded.kind {
        case .note:
            guard bytes.count == SignedNote.wireSize else { return nil }
            return Data(SHA256.hash(data: bytes.prefix(NoteV1.size)))
        case .ack:
            guard bytes.count == Ack.wireSize, bytes.prefix(16) == Data(Ack.prefix.utf8) else { return nil }
            return bytes.subdata(in: 16..<48)
        case .receipt:
            guard let parts = try? Bundles.splitReceipt(bytes) else { return nil }
            return Data(SHA256.hash(data: Data(parts.note).prefix(NoteV1.size)))
        default:
            return nil
        }
    }
}

/// Routes payment texts that arrive over the LOKA mesh to the two screens, and remembers which peer
/// each note came from, so the merchant's ack and receipt go back to that peer and nobody else.
/// It also remembers the packets that carried this phone's own notes, so LOKA can stop retrying
/// them once the merchant's verified ack comes back (task 2.2 review: the sender's copy of N is
/// discarded when the matching Y arrives).
@MainActor
@Observable
public final class MeshPaymentRouter {
    /// For the Receive screen (`LokaPayDependencies.meshInbox`).
    public let receiveInbox: PaymentInbox
    /// For the Pay screen (`LokaPayDependencies.meshReturns`): acks and receipts.
    public let payInbox: PaymentInbox
    /// Payment family texts dropped here (another version, or not from a contact).
    public private(set) var dropped = 0
    /// How many note senders, outgoing payments and packet ids are kept (the oldest go first).
    public static let memory = 64

    @ObservationIgnored private var noteSenders: [(noteId: Data, peer: String)] = []
    @ObservationIgnored private var seenPackets: [String] = []
    @ObservationIgnored private var outbound: [(note: SignedNote, packetIDs: [String])] = []

    /// Builds its own two inboxes unless given them.
    public init(receiveInbox: PaymentInbox? = nil, payInbox: PaymentInbox? = nil) {
        self.receiveInbox = receiveInbox ?? PaymentInbox()
        self.payInbox = payInbox ?? PaymentInbox()
    }

    /// One decrypted text from the mesh, from `peer` (a contact id when `fromContact`). Returns true
    /// when it was payment family text, delivered or dropped here: the caller then neither shows it
    /// as chat nor stores nor notifies it. Returns false for everything else, which LOKA handles as
    /// before. The mesh hands a retried packet over again; one `packetID` is delivered once.
    @discardableResult
    public func receive(_ text: String, from peer: String, fromContact: Bool, packetID: String) -> Bool {
        let route = MeshPaymentText.route(text, fromContact: fromContact)
        switch route {
        case .loka:
            return false
        case .drop:
            dropped += 1
            return true
        case .receive, .pay:
            guard !seenPackets.contains(packetID) else { return true }
            seenPackets = Array((seenPackets + [packetID]).suffix(Self.memory))
            if route == .pay {
                payInbox.deliver(text)
            } else {
                // The first peer a note arrived from gets its replies; a later copy never redirects them.
                if let id = MeshPaymentText.noteId(of: text), !noteSenders.contains(where: { $0.noteId == id }) {
                    noteSenders = Array((noteSenders + [(id, peer)]).suffix(Self.memory))
                }
                receiveInbox.deliver(text)
            }
            return true
        }
    }

    /// The peer the note that `text` (an ack or receipt) is about arrived from over the mesh; nil
    /// when that note came another way (camera, paste) or is not known here. Replies go only there.
    public func replyPeer(for text: String) -> String? {
        guard MeshPaymentText.route(text, fromContact: true) == .pay,
              let id = MeshPaymentText.noteId(of: text) else { return nil }
        return noteSenders.first(where: { $0.noteId == id })?.peer
    }

    /// Records the LOKA packets that carried one payment (the allowance, then the note) to the
    /// merchant, so `answered(by:)` can release them once that merchant's ack comes back.
    public func sent(noteText: String, packetIDs: [String]) {
        guard !packetIDs.isEmpty, let decoded = try? PaymentTransport.decode(noteText), decoded.kind == .note,
              let note = Self.ownNote(decoded.payload) else { return }
        var ids = packetIDs
        if let index = outbound.firstIndex(where: { $0.note.noteId == note.noteId }) {
            ids = outbound.remove(at: index).packetIDs + packetIDs
        }
        outbound = Array((outbound + [(note, ids)]).suffix(Self.memory))
    }

    /// The packets LOKA can stop retrying because `text` (an ack, or a receipt with its ack) carries
    /// an ack that verifies for a note this phone sent: the payee's key signed it, so the merchant
    /// has the note. Empty for anything else. Each payment is released once.
    public func answered(by text: String) -> [String] {
        guard let decoded = try? PaymentTransport.decode(text) else { return [] }
        let ackWire: Data
        switch decoded.kind {
        case .ack:
            ackWire = decoded.payload
        case .receipt:
            guard let parts = try? Bundles.splitReceipt(decoded.payload) else { return [] }
            ackWire = Data(parts.ack)
        default:
            return []
        }
        guard let index = outbound.firstIndex(where: { (try? Ack.verify(wire: ackWire, for: $0.note)) != nil }) else {
            return []
        }
        return outbound.remove(at: index).packetIDs
    }

    /// A note this phone signed and checked before sending (PayModel runs section 6 first), read back
    /// from its wire. Only its id, payee key hash and bytes are used here.
    private static func ownNote(_ wire: Data) -> SignedNote? {
        guard wire.count == SignedNote.wireSize else { return nil }
        var r = ByteReader(wire)
        guard let bytes = try? r.read(NoteV1.size), let note = try? NoteV1.decode(bytes),
              let signature = try? r.read(64), let key = try? r.read(33) else { return nil }
        return SignedNote(note: note, noteBytes: bytes, signature: signature, payerPublicKey: key)
    }
}

/// The payer's half of the mesh glue: acks and receipts from `payInbox` reach the Pay screen.
public enum MeshReturns {
    /// Hands the inbox's acks and receipts to `model`, held ones first. Only a text about the note on
    /// screen is checked (`PayModel.acceptReturn` verifies it); one about another note, or arriving
    /// when no note is on screen, is not this payment's and is dropped, never shown as an error.
    @MainActor
    @discardableResult
    public static func attach(_ inbox: PaymentInbox, to model: PayModel) -> UInt64 {
        inbox.attach(model) { [weak model] item in
            guard let model else { return false }
            if let current = model.payment?.note.noteId, MeshPaymentText.noteId(of: item.text) == current {
                model.acceptReturn(text: item.text)
            }
            return true
        }
    }

    /// The merchant's replies that still need to go back over the mesh, in order: the ack once the
    /// note is accepted, then the receipt once the chain decided. `sent` holds what already went.
    public static func repliesDue(ack: String?, receipt: String?, sent: [String]) -> [String] {
        [ack, receipt].compactMap { $0 }.filter { !sent.contains($0) }
    }
}
