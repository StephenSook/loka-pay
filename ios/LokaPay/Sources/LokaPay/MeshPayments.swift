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
        /// A well-formed allowance (`A`) or note (`N`) from a contact, for the Receive screen's inbox.
        case receive
        /// A well-formed ack (`Y`) or receipt (`X`) from a contact, for the Pay screen.
        case pay
        /// Payment family text that is not taken: malformed (`admittedKind`), a kind no screen takes
        /// over the mesh in this build (spend markers, confirmations, merchant codes), another
        /// version of `L1|P`, or a sender that is not a contact (the payment-only scope for
        /// non-contacts is a follow-up of task 2.2). It is counted, never queued in an inbox, and
        /// never shown, stored or notified as chat.
        case drop
    }

    /// The version 1 transport prefix.
    public static let prefix = "L1|P|1|"

    /// True for every text of the payment family (`L1|P`). None of them ever reaches chat.
    public static func isPaymentFamily(_ text: String) -> Bool { text.hasPrefix("L1|P") }

    /// Sorts a decrypted text. Only a well-formed version 1 allowance, note, ack or receipt from a
    /// contact reaches an inbox, so junk can never take an inbox place from a real payment.
    public static func route(_ text: String, fromContact: Bool) -> Route {
        guard isPaymentFamily(text) else { return .loka }
        guard fromContact, let kind = admittedKind(text) else { return .drop }
        switch kind {
        case .allowance, .note: return .receive
        case .ack, .receipt: return .pay
        case .marker, .confirmation, .merchant: return .drop
        }
    }

    /// The kind of a version 1 text whose wrapper is canonical (`PaymentTransport.decode`: five
    /// fields, a known kind, canonical base64url without padding) and whose payload has that kind's
    /// exact structure: its length, its domain prefix, the earmark count of an allowance, and for a
    /// note and an ack a P-256 signature that verifies over the signed bytes with the attached key.
    /// nil otherwise. The deployment and the server key are not checked here; the screens check them.
    static func admittedKind(_ text: String) -> PaymentTransport.Kind? {
        guard text.hasPrefix(prefix), let decoded = try? PaymentTransport.decode(text) else { return nil }
        let bytes = Data(decoded.payload)
        switch decoded.kind {
        case .note:
            return signedNoteId(bytes) != nil ? .note : nil
        case .ack:
            return signedAckNoteId(bytes) != nil ? .ack : nil
        case .receipt:
            guard let parts = try? Bundles.splitReceipt(bytes), let noteId = signedNoteId(Data(parts.note)),
                  signedAckNoteId(Data(parts.ack)) == noteId else { return nil }
            if let conf = parts.confirmation, Data(conf).prefix(16) != Data(Confirmation.prefix.utf8) { return nil }
            return .receipt
        case .allowance:
            let fixed = AllowanceCertificate.size + 64
            guard bytes.count >= fixed + 2, bytes.prefix(16) == Data(AllowanceCertificate.prefix.utf8) else { return nil }
            let count = Int(bytes[fixed]) << 8 | Int(bytes[fixed + 1])
            return count <= 16 && bytes.count == fixed + 2 + 32 * count ? .allowance : nil
        case .marker, .confirmation, .merchant:
            return decoded.kind
        }
    }

    /// The note id of a 238-byte note wire with the right prefix whose signature verifies.
    private static func signedNoteId(_ wire: Data) -> Data? {
        guard wire.count == SignedNote.wireSize else { return nil }
        var r = ByteReader(wire)
        guard let bytes = try? r.read(NoteV1.size), bytes.prefix(16) == Data(NoteV1.prefix.utf8),
              let signature = try? r.read(64), let key = try? r.read(33),
              (try? P256Rules.verify(signature: signature, message: bytes, compressedPublicKey: key)) != nil else { return nil }
        return Data(SHA256.hash(data: bytes))
    }

    /// The note id a 153-byte ack wire names, when its prefix is right and its signature verifies
    /// with its own key (whether that key is the payee's needs the note; Pay checks it).
    private static func signedAckNoteId(_ wire: Data) -> Data? {
        guard wire.count == Ack.wireSize else { return nil }
        var r = ByteReader(wire)
        guard let body = try? r.read(56), body.prefix(16) == Data(Ack.prefix.utf8),
              let signature = try? r.read(64), let key = try? r.read(33),
              (try? P256Rules.verify(signature: signature, message: body, compressedPublicKey: key)) != nil else { return nil }
        return body.subdata(in: 16..<48)
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

    /// The note id of an `N` text only (an ack or receipt is about a note, but is not one).
    static func noteTextId(_ text: String) -> Data? {
        text.hasPrefix(prefix + "N|") ? noteId(of: text) : nil
    }

    /// The note id of an `N` text whose payer signature verifies over its 141 note bytes. A copy
    /// with a broken signature can never become a payment, so it never counts as a delivery of the
    /// note (it cannot make a reply ambiguous either).
    static func signedNoteTextId(_ text: String) -> Data? {
        guard text.hasPrefix(prefix + "N|"), let decoded = try? PaymentTransport.decode(text) else { return nil }
        return signedNoteId(Data(decoded.payload))
    }
}

/// Where the merchant's ack or receipt for the payment on screen may go over the mesh.
public enum MeshReplyTarget: Equatable, Sendable {
    /// The one contact the accepted note was delivered from.
    case peer(String)
    /// The note came by camera, by paste or from the ledger: the code on screen is the way back.
    case notOverBluetooth
    /// More than one contact delivered this same note, so who paid is unclear: nothing is sent.
    case ambiguous
    /// Where the note first came from is not known here (it was accepted before a relaunch or a
    /// rebuilt screen), or the delivery is forgotten or names another note: nothing is sent.
    case unknown
}

/// Where the note on the Receive screen FIRST reached this screen. Its Bluetooth replies are bound
/// to this, never to a later copy of the same note.
public enum MeshOrigin: Equatable, Sendable {
    /// Camera or paste: replies go back by code.
    case notOverBluetooth
    /// The Bluetooth inbox delivery (`PaymentInbox.deliver`'s sequence number) it was first
    /// accepted from.
    case delivery(UInt64)
    /// A note accepted earlier, back on screen with no record here of where it first came from
    /// (after a relaunch or a rebuilt screen): no Bluetooth reply, whoever sent the copy that
    /// brought it back.
    case unknown
}

/// The contact the payer picked for one payment (its note id).
public struct MeshPick: Equatable, Sendable {
    public let noteId: Data
    public let peer: String
}

/// Routes payment texts that arrive over the LOKA mesh to the two screens, and keeps what the
/// replies and the payer's sends are bound to:
/// - each Receive delivery's sender, by the inbox's delivery id, so the ack and the receipt go only
///   to the sender of the one delivery the Receive screen first accepted (`ReceivedPayment.meshOrigin`),
///   and to nobody when another contact delivered the same note;
/// - the texts Pay handed over and the contact the payer picked for that payment only;
/// - the packets that carried this phone's notes, released when the merchant's verified ack comes
///   back (task 2.2 review: the sender's copy of N is discarded when the matching Y arrives).
@MainActor
@Observable
public final class MeshPaymentRouter {
    /// For the Receive screen (`LokaPayDependencies.meshInbox`).
    public let receiveInbox: PaymentInbox
    /// For the Pay screen (`LokaPayDependencies.meshReturns`): acks and receipts.
    public let payInbox: PaymentInbox
    /// Payment family texts dropped here (another version, or not from a contact).
    public private(set) var dropped = 0
    /// LOKA's automatic retries of a packet whose first copy is still waiting in the inbox or was
    /// already taken by a screen. Not delivered twice (it would crowd the inbox or bring a finished
    /// payment back); nothing is lost. A retry after the inbox dropped the first copy is delivered.
    public private(set) var repeatsSkipped = 0
    /// The texts Pay handed over for one payment, waiting for the payer to pick a contact.
    public private(set) var outgoing: [String] = []
    /// The contact picked for the payment whose texts are waiting or were last sent. It is cleared
    /// as soon as another payment's note is handed over, so it never carries to the next payment.
    public private(set) var pick: MeshPick?

    /// How many deliveries, packets and outgoing payments are remembered (the oldest go first).
    public static let memory = 256
    /// How long a packet is remembered for spotting LOKA's retries: payment packets live 5 minutes.
    public static let repeatWindow: TimeInterval = 300

    private struct Delivery {
        let peer: String
        let noteId: Data?
    }

    private struct Packet {
        let peer: String
        let packetID: String
        let route: MeshPaymentText.Route
        /// The inbox delivery it became; nil for a dropped packet.
        let sequence: UInt64?
        let at: Date
        /// Its inbox dropped that delivery (full, or past its age limit) before any screen took it.
        /// Kept with the packet for as long as the packet is remembered.
        var inboxDropped = false
    }

    private func remember(_ packet: Packet) {
        packets = Array((packets + [packet]).suffix(Self.memory))
    }

    @ObservationIgnored private var deliveries: [UInt64: Delivery] = [:]
    @ObservationIgnored private var deliveryOrder: [UInt64] = []
    @ObservationIgnored private var packets: [Packet] = []
    @ObservationIgnored private var outbound: [(note: SignedNote, packets: [(id: String, at: Date)])] = []
    /// The most packet ids kept for one payment: LOKA's payment packets live 5 minutes, and older
    /// ones are gone from its queue anyway.
    public static let packetsPerPayment = 16
    private let now: @MainActor () -> Date

    /// Builds its own two inboxes unless given them.
    public init(receiveInbox: PaymentInbox? = nil, payInbox: PaymentInbox? = nil,
                now: @escaping @MainActor () -> Date = { Date() }) {
        self.receiveInbox = receiveInbox ?? PaymentInbox()
        self.payInbox = payInbox ?? PaymentInbox()
        self.now = now
        self.receiveInbox.onDrop = { [weak self] sequence in self?.inboxDropped(sequence, route: .receive) }
        self.payInbox.onDrop = { [weak self] sequence in self?.inboxDropped(sequence, route: .pay) }
    }

    /// Records that an inbox dropped this delivery, on the packet it came from.
    private func inboxDropped(_ sequence: UInt64, route: MeshPaymentText.Route) {
        guard let index = packets.firstIndex(where: { $0.sequence == sequence && $0.route == route }) else { return }
        packets[index].inboxDropped = true
    }

    // MARK: Inbound

    /// One decrypted text from the mesh, from `peer` (a contact id when `fromContact`). Returns true
    /// when it was payment family text, delivered, skipped as a retry, or dropped here: the caller
    /// then neither shows it as chat nor stores nor notifies it. Returns false for everything else,
    /// which LOKA handles as before.
    ///
    /// Repeats are keyed on (sender, LOKA packet id) within `repeatWindow`: the same text from
    /// another contact, or a resend (a new packet), is always delivered.
    @discardableResult
    public func receive(_ text: String, from peer: String, fromContact: Bool, packetID: String) -> Bool {
        let route = MeshPaymentText.route(text, fromContact: fromContact)
        guard route != .loka else { return false }
        let clock = now()
        packets.removeAll { abs(clock.timeIntervalSince($0.at)) > Self.repeatWindow }
        let earlier = packets.firstIndex(where: { $0.peer == peer && $0.packetID == packetID && $0.route == route })
        switch route {
        case .loka:
            return false
        case .drop:
            // One dropped packet counts once, however often LOKA retries it.
            if earlier == nil {
                dropped += 1
                remember(Packet(peer: peer, packetID: packetID, route: route, sequence: nil, at: clock))
            }
            return true
        case .receive, .pay:
            let inbox = route == .pay ? payInbox : receiveInbox
            if let earlier {
                guard packets[earlier].inboxDropped else {
                    repeatsSkipped += 1
                    return true
                }
                packets.remove(at: earlier)
            }
            let sequence = inbox.deliver(text)
            remember(Packet(peer: peer, packetID: packetID, route: route, sequence: sequence, at: clock))
            if route == .receive {
                deliveries[sequence] = Delivery(peer: peer, noteId: MeshPaymentText.signedNoteTextId(text))
                deliveryOrder.append(sequence)
                while deliveryOrder.count > Self.memory { deliveries[deliveryOrder.removeFirst()] = nil }
            }
            return true
        }
    }

    /// Where a reply for the payment on screen may go: the sender of the one Receive delivery its
    /// note was first accepted from (`ReceivedPayment.meshOrigin`). Nothing is looked up by text: a
    /// text from another contact never redirects a reply, and the same note delivered by two
    /// different contacts makes the reply `ambiguous`.
    public func replyTarget(origin: MeshOrigin, noteId: Data) -> MeshReplyTarget {
        let delivery: UInt64
        switch origin {
        case .notOverBluetooth: return .notOverBluetooth
        case .unknown: return .unknown
        case .delivery(let sequence): delivery = sequence
        }
        guard let accepted = deliveries[delivery], accepted.noteId == noteId else { return .unknown }
        let others = deliveries.values.contains { $0.noteId == noteId && $0.peer != accepted.peer }
        return others ? .ambiguous : .peer(accepted.peer)
    }

    /// `replyTarget(origin:noteId:)` for an ack or receipt text.
    public func replyTarget(for text: String, origin: MeshOrigin) -> MeshReplyTarget {
        guard MeshPaymentText.route(text, fromContact: true) == .pay, let id = MeshPaymentText.noteId(of: text) else {
            return .unknown
        }
        return replyTarget(origin: origin, noteId: id)
    }

    // MARK: Outbound (payer)

    /// Pay hands over its texts: the allowance, then the note. Waiting texts that already end in a
    /// note belong to an earlier hand-over and are replaced, and a note for another payment than
    /// the one picked ends that pick.
    public func queueOutgoing(_ text: String) {
        if outgoing.contains(where: { MeshPaymentText.noteTextId($0) != nil }) { outgoing = [] }
        if let id = MeshPaymentText.noteTextId(text), pick?.noteId != id { pick = nil }
        outgoing = Array((outgoing + [text]).suffix(8))
    }

    /// The payer picked `peer` for the texts waiting: they go to that contact only, and the pick
    /// holds for this payment only. Empty when nothing waits.
    public func takeOutgoing(for peer: String) -> [String] {
        let texts = outgoing
        outgoing = []
        if let id = texts.compactMap(MeshPaymentText.noteTextId).last { pick = MeshPick(noteId: id, peer: peer) }
        return texts
    }

    /// The note id of the payment whose texts are waiting; nil when nothing waits.
    public var outgoingNoteId: Data? { outgoing.compactMap(MeshPaymentText.noteTextId).last }

    /// The payer closed the picker without a choice: nothing waits any more.
    public func cancelOutgoing() {
        outgoing = []
    }

    /// Records the LOKA packets that carried one payment (the allowance, then the note) to the
    /// merchant, so `answered(by:)` can release them once that merchant's ack comes back.
    /// Packets older than LOKA's payment packet lifetime are forgotten, and at most
    /// `packetsPerPayment` are kept per payment, so resends cannot grow this without bound.
    public func sent(noteText: String, packetIDs: [String]) {
        guard !packetIDs.isEmpty, let decoded = try? PaymentTransport.decode(noteText), decoded.kind == .note,
              let note = Self.ownNote(decoded.payload) else { return }
        let clock = now()
        var packets = packetIDs.map { (id: $0, at: clock) }
        if let index = outbound.firstIndex(where: { $0.note.noteId == note.noteId }) {
            packets = outbound.remove(at: index).packets + packets
        }
        pruneOutbound(clock)
        packets = Array(packets.filter { Self.live($0.at, clock) }.suffix(Self.packetsPerPayment))
        outbound = Array((outbound + [(note, packets)]).suffix(Self.memory))
    }

    /// Drops packet ids past their lifetime, and payments with none left.
    private func pruneOutbound(_ clock: Date) {
        outbound = outbound.compactMap { entry in
            let packets = entry.packets.filter { Self.live($0.at, clock) }
            return packets.isEmpty ? nil : (entry.note, packets)
        }
    }

    private static func live(_ at: Date, _ clock: Date) -> Bool { abs(clock.timeIntervalSince(at)) <= repeatWindow }

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
        pruneOutbound(now())
        guard let index = outbound.firstIndex(where: { (try? Ack.verify(wire: ackWire, for: $0.note)) != nil }) else {
            return []
        }
        return outbound.remove(at: index).packets.map(\.id)
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

/// The screens' half of the mesh glue.
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
    /// note is on screen, then the receipt once the chain decided. `sent` holds the `replyKey`s of
    /// what already went. Keys include the payment's presentation, so the same verified ack goes
    /// again when a resend brings the payment back, and never twice for one presentation.
    public static func repliesDue(ack: String?, receipt: String?, presentation: UInt64, sent: [String]) -> [String] {
        [ack, receipt].compactMap { $0 }.filter { !sent.contains(replyKey($0, presentation: presentation)) }
    }

    /// How long to wait before offering a reply again after a passing failure (a locked phone, a
    /// full queue), by attempt: 5, 20 and 60 seconds, then no more timed tries. Showing Receive
    /// again, or a local link coming up, still offers it.
    public static func replyRetryDelay(attempt: Int) -> TimeInterval? {
        let delays: [TimeInterval] = [5, 20, 60]
        return delays.indices.contains(attempt) ? delays[attempt] : nil
    }

    /// What `repliesDue` remembers for a reply that went (or has no Bluetooth route).
    public static func replyKey(_ text: String, presentation: UInt64) -> String { String(presentation) + "|" + text }
}
