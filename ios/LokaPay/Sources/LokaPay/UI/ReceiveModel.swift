import Foundation
import Observation

/// A note this merchant verified and reserved in its offline ledger.
public struct ReceivedPayment: Equatable, Sendable {
    public let note: SignedNote
    public let certificate: AllowanceCertificate
    /// The merchant phone's clock, whole seconds: the same value the ACK signs.
    public let receivedAt: Date
    /// The phone's own report that it had no internet path at receipt. Never signed (PLAN 3.53).
    public let receivedWithZeroBars: Bool
    /// The signed acknowledgement, once the merchant key has signed it.
    public internal(set) var ack: Ack?

    /// `L1|P|1|Y|...` for the payer.
    public var ackText: String? { ack.map { PaymentTransport.encode(.ack, $0.wire) } }
}

/// A decision on chain for the received note, re-verified as a full receipt.
public struct SettledPayment: Equatable, Sendable {
    public let receipt: VerifiedReceipt
    /// `L1|P|1|X|...` with the CONF attached, for the payer.
    public let receiptText: String
    /// The server said it had decided this note before. Unsigned, display only.
    public let replayed: Bool
    /// The program's error name as the server reported it. Unsigned, display only.
    public let reasonUnsigned: String?

    public var status: MoneyStatus { MoneyStatus(receipt: receipt) }
}

/// A note this phone accepted offline that no verified CONF has decided yet, read back from the
/// offline ledger with what settling it needs. Listed under "Unsettled on this phone".
public struct UnsettledPayment: Equatable, Sendable, Identifiable {
    /// From the ledger's stored wire: the original note bytes, which are the ones uploaded.
    public let note: SignedNote
    /// The stored ACK's signed received-at time. Without an ACK it is the time the ledger recorded,
    /// for display only: nothing signs it and no check relies on it.
    public let receivedAt: Date
    /// The phone's report at receipt that it had no internet path. Never signed.
    public let receivedWithZeroBars: Bool
    /// The allowance certificate it was accepted against, verified again with the pinned key; nil
    /// when the ledger entry was written before certificates were kept.
    public let certificate: AllowanceCertificate?
    /// The ACK this phone signed for it, verified again with this merchant's key and bound to this
    /// note; nil when none was stored (settling then checks the note as if accepted now and signs one).
    public let ack: Ack?
    /// A stored ACK or certificate is present but does not verify: the record is damaged, so the
    /// note is never shown as received from it and nothing is signed for it.
    public let damaged: Bool

    public var id: Data { note.noteId }
}

/// The Receive screen (tasks 3.71, 3.70, 3.27, 2.1 package side). The merchant shows its own
/// certificate as a code; the payer's allowance (A) and note (N) arrive in either order by camera,
/// as pasted text, or over Bluetooth when the app supplies a `PaymentInbox` that the mesh glue
/// feeds. A note is accepted only after PAYMENT-V1 section 6 (`SignedNote.validate`), the
/// merchant checks (`Acceptance.check`) and the durable offline-ledger reservation
/// (`OfflineLedger.accept`: seen serials and the offline limit). Then the merchant key signs the ACK.
/// Settling uses the injected `SettlementClient`; Paid or Failed comes only from the verified CONF.
@MainActor
@Observable
public final class ReceiveModel {
    public enum Phase: Equatable, Sendable {
        case unavailable
        /// Showing the merchant code, waiting for the payer's codes.
        case ready
        case received
        /// The chain decided (Paid or Failed), from a verified CONF.
        case settled
    }

    public private(set) var phase: Phase = .unavailable
    public private(set) var merchant: MerchantCertificate?
    /// `L1|P|1|C|...`: this merchant's certificate, shown as the first code.
    public private(set) var merchantText: String?
    /// Verified allowance certificates seen on this screen, by allowance id.
    public private(set) var allowances: [UInt64: AllowanceCertificate] = [:]
    /// The allowance the ready card shows for the payer at the till: set only while ready (from
    /// an allowance code, or the allowance a note was checked against), cleared by Next payment.
    public private(set) var lastAllowance: AllowanceCertificate?
    /// A valid note that arrived before its allowance certificate. It keeps waiting through another
    /// payer's payment, until its allowance arrives or the merchant taps Clear the waiting note.
    public private(set) var waitingNote: SignedNote?
    public private(set) var payment: ReceivedPayment?
    public private(set) var settlement: SettledPayment?
    /// The last HTTP 202 for this note: the chain has not decided yet. Unsigned.
    public private(set) var pendingSettlement: PendingSettlement?
    /// The last settlement call for the note on screen got no answer this phone can trust
    /// (`SettlementError.leavesOutcomeUnknown`): the server may have settled it, so the note stays
    /// reserved and Check again is offered.
    public private(set) var settlementOutcomeUnknown = false
    public private(set) var issue: MoneyIssue?
    /// The allowance a proven conflicting spend was seen for (a second valid note from that
    /// certificate's payer on a serial already in the ledger). Read it through `conflictingSpend`,
    /// which checks it against the allowance on screen.
    public private(set) var conflictAllowanceId: UInt64?
    /// Bluetooth texts of kinds this screen does not use (spend markers, receipts, confirmations),
    /// counted instead of reported: nobody at the till asked for them. Counted since the last
    /// Next payment, like `inboxDropped`.
    public private(set) var inboxIgnored = 0
    /// Bluetooth texts that were not valid payment codes (not LOKA text, too long, damaged, or an
    /// allowance or note that fails its own checks), counted and dropped: no later step can make
    /// them valid. Counted since the last Next payment.
    public private(set) var inboxUnreadable = 0
    /// The inbox's drop count when Next payment was last tapped: drops before it were shown during
    /// an earlier payment, so they are not the next payer's.
    private var inboxDroppedBefore = 0
    public private(set) var isWorking = false
    /// This merchant's pending total for the allowance on screen (OfflineLedger); nil when the
    /// ledger could not be read. Read it through `unsettled(for:)`, which checks the pairing.
    public private(set) var unsettledTotal: UInt64?
    /// The allowance `unsettledTotal` was read for.
    public private(set) var unsettledAllowanceId: UInt64?
    /// "Unsettled on this phone": notes accepted offline that no verified CONF has decided yet,
    /// oldest first, read from the offline ledger when the screen is ready for a payer (set up, and
    /// at each Next payment). They survive Next payment and a relaunch, and each can be settled.
    public private(set) var unsettledPayments: [UnsettledPayment] = []
    /// True when the ledger could not be read, so the list is unknown (never shown as empty).
    public private(set) var unsettledPaymentsUnreadable = false
    /// Pending ledger notes that could not be read back as notes to this merchant. The ledger still
    /// counts them; the list says how many it could not show.
    public private(set) var unsettledPaymentsUnlisted = 0

    public let deployment: Deployment
    private let signer: (any PaymentSigner)?
    private let ledger: OfflineLedger
    private let settlementClient: SettlementClient?
    private let serverPublicKey: Data?
    private let internetState: (@MainActor () -> InternetState?)?
    private let now: @Sendable () -> Date
    private let inbox: PaymentInbox?
    /// The verified wire of each certificate in `allowances`, kept with every note accepted against it.
    @ObservationIgnored private var allowanceWires: [UInt64: Data] = [:]
    /// The one task that checks the inbox's queued texts for this screen, one after another, in
    /// arrival order. The queue and its bound live in the shared `PaymentInbox`.
    @ObservationIgnored private var inboxConsumer: Task<Void, Never>?
    /// The attachment `PaymentInbox.attach` returned; nil while this screen is not attached. The
    /// consumer takes queued texts only with it, so it stops when the screen goes or is replaced.
    @ObservationIgnored private var inboxAttachment: UInt64?

    /// - Parameters:
    ///   - merchantWire: this phone's merchant certificate from `POST /v1/merchants` (verified here).
    ///   - settlementClient: nil when no server is connected; Settle then says so.
    ///   - internetState: the phone's current path, for the phone-reported "zero bars" stamp.
    ///   - inbox: payer codes received over Bluetooth; nil leaves Bluetooth unmentioned.
    public init(merchantWire: Data?, signer: (any PaymentSigner)?, ledger: OfflineLedger,
                settlementClient: SettlementClient?, deployment: Deployment, serverPublicKey: Data?,
                internetState: (@MainActor () -> InternetState?)? = nil,
                inbox: PaymentInbox? = nil,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.deployment = deployment
        self.signer = signer
        self.ledger = ledger
        self.settlementClient = settlementClient
        self.serverPublicKey = serverPublicKey
        self.internetState = internetState
        self.inbox = inbox
        self.now = now
        if let problem = setUp(merchantWire: merchantWire) { report(problem) }
        loadUnsettled()
    }

    private func setUp(merchantWire: Data?) -> MoneyIssueKind? {
        guard let serverPublicKey, serverPublicKey.count == 32 else { return .serverKeyMissing }
        guard let merchantWire else { return .noMerchantCertificate }
        guard let signer else { return .noSigner }
        do {
            let verified = try MerchantCertificate.verify(wire: merchantWire, deployment: deployment,
                                                          serverPublicKey: serverPublicKey)
            merchant = verified
            guard verified.merchantKeyHash == signer.keyHash else { return .keyMismatch }
            merchantText = PaymentTransport.encode(.merchant, merchantWire)
        } catch {
            return PayModel.kind(of: error)
        }
        phase = .ready
        return nil
    }

    /// True only while the allowance on screen is the one the conflicting spend was seen for.
    public var conflictingSpend: Bool {
        guard let id = conflictAllowanceId, let shown = payment?.certificate ?? lastAllowance else { return false }
        return id == shown.allowanceId
    }

    /// The acceptance check chip state for the allowance on screen.
    public var limitState: LimitState? {
        guard let certificate = payment?.certificate ?? lastAllowance,
              let unsettled = unsettled(for: certificate) else { return nil }
        return LimitState.from(unsettled: unsettled, offlineLimit: certificate.offlineLimit, conflict: conflictingSpend)
    }

    /// The one chip the limit block shows for an allowance.
    public enum LimitBadge: Equatable, Sendable {
        case conflictingSpend
        /// A limit state (never `.conflictingSpend`, which has its own case).
        case limit(LimitState)
    }

    /// The chip for `certificate`: Conflicting spend seen when the conflict was seen for it, else
    /// its limit state when its own total is on hand, else none ("Within local limit" would be a guess).
    public func limitBadge(for certificate: AllowanceCertificate) -> LimitBadge? {
        if conflictingSpend, conflictAllowanceId == certificate.allowanceId { return .conflictingSpend }
        guard let unsettled = unsettled(for: certificate) else { return nil }
        return .limit(LimitState.from(unsettled: unsettled, offlineLimit: certificate.offlineLimit, conflict: false))
    }

    /// This merchant's unsettled total for `certificate`, only when the total on hand was read
    /// for that same allowance; nil otherwise (never another allowance's figure).
    public func unsettled(for certificate: AllowanceCertificate) -> UInt64? {
        unsettledAllowanceId == certificate.allowanceId ? unsettledTotal : nil
    }

    /// What the ready card says about the payer's two codes.
    public enum ReadyStep: Equatable, Sendable {
        /// `bluetooth` is true only when the app supplied a Bluetooth inbox.
        case waitingForBoth(bluetooth: Bool)
        /// A note checked out and waits for its allowance. Checked before `lastAllowance`, which
        /// may belong to someone else.
        case noteWaitingForAllowance
        case allowanceVerified(allowanceId: UInt64)

        public var text: String {
            switch self {
            case .waitingForBoth(let bluetooth):
                return "Waiting for the payer's allowance (code 1 of 2) and payment note (code 2 of 2), by "
                    + (bluetooth ? "camera or Bluetooth." : "camera.")
            case .noteWaitingForAllowance:
                return "Payment note checked. Waiting for its allowance (code 1 of 2)."
            case .allowanceVerified(let id):
                // String(...) keeps the id verbatim: a localized interpolation would print "1,001".
                return "Allowance #" + String(id) + " verified (code 1 of 2). Now the payment note (code 2 of 2)."
            }
        }
    }

    public var readyStep: ReadyStep {
        if waitingNote != nil { return .noteWaitingForAllowance }
        if let allowance = lastAllowance { return .allowanceVerified(allowanceId: allowance.allowanceId) }
        return .waitingForBoth(bluetooth: receivesOverBluetooth)
    }

    // MARK: - Incoming codes

    /// True when the app supplied a Bluetooth inbox (`LokaPayDependencies.meshInbox`).
    public var receivesOverBluetooth: Bool { inbox != nil }

    /// Bluetooth codes the inbox dropped before any screen could check them (it was full, or they
    /// waited longer than its age limit), since the last Next payment.
    public var inboxDropped: Int { max(0, (inbox?.droppedWhileDetached ?? 0) - inboxDroppedBefore) }

    /// Bluetooth codes held in the inbox until this screen is ready for the next payer.
    public var inboxWaiting: Int { inbox?.held.count ?? 0 }

    /// The line about Bluetooth texts that were not checked since the last Next payment; nil when
    /// there are none.
    public var inboxLine: String? {
        Self.inboxLine(dropped: inboxDropped, ignored: inboxIgnored, unreadable: inboxUnreadable,
                       maxAge: inbox?.maxAge ?? PaymentInbox.defaultMaxAge)
    }

    public static func inboxLine(dropped: Int, ignored: Int, unreadable: Int = 0, maxAge: TimeInterval) -> String? {
        var lines: [String] = []
        if dropped > 0 {
            let minutes = String(max(1, Int((maxAge / 60).rounded())))
            lines.append("Bluetooth codes dropped before this screen could check them: " + String(dropped)
                         + " (too many waiting, or held longer than " + minutes + " min). Ask the payer to send again.")
        }
        if unreadable > 0 {
            lines.append("Bluetooth texts that were not valid payment codes: " + String(unreadable)
                         + " (damaged, or not LOKA codes). Ask the payer to send again if one was theirs.")
        }
        if ignored > 0 {
            lines.append("Bluetooth texts for other steps ignored: " + String(ignored) + " (such as spend markers).")
        }
        return lines.isEmpty ? nil : lines.joined(separator: " ")
    }

    /// Takes payer codes from the Bluetooth inbox, held ones first. ReceiveView calls this while it
    /// is shown, so a code that lands on another tab waits in the inbox and is never accepted unseen.
    /// A screen that cannot receive (no merchant certificate) leaves the codes in the inbox.
    public func startInbox() {
        guard phase != .unavailable, let inbox else { return }
        inboxAttachment = inbox.attach(self) { [weak self] text, arrivedAt in
            guard let self else { return false }
            self.takeFromInbox(text, arrivedAt: arrivedAt)
            return true
        }
        // Texts a screen this one replaced had queued are this screen's now, in arrival order.
        if inbox.hasQueued { startInboxConsumer() }
    }

    /// Stops taking inbox texts (a newer Receive model that already attached keeps the inbox).
    /// Queued texts nobody started go back to the inbox's held list at once, with their first
    /// arrival times (`PaymentInbox.detach`), so nothing is validated, reserved or signed for a
    /// screen that is not shown. A text already being checked when the screen goes finishes, like
    /// a scan would.
    public func stopInbox() {
        inbox?.detach(self)
        inboxAttachment = nil
    }

    /// What a Bluetooth text can become on this screen.
    private enum InboxTriage {
        /// A payment code for another step (spend marker, receipt, confirmation): counted.
        case ignored
        /// Not a valid payment code, now or ever: counted.
        case unreadable
        /// An allowance or note this screen may accept.
        case payment((kind: PaymentTransport.Kind, payload: Data))
    }

    /// Sorts a Bluetooth text without accepting anything. Parsing depends only on the text, and a
    /// structure check only on the bytes, the deployment and the pinned server key, so a text that
    /// fails either fails forever. During a payment the structure check runs here, because the text
    /// can only wait; while ready, `accept` runs the same checks and reports a failure by name.
    private func triage(_ text: String) -> InboxTriage {
        switch ScanParser.parse(text, accepting: [.allowance, .note]) {
        case .failure(.wrongKind):
            // Spend markers (M) reach every nearby merchant (PAYMENT-V1 4.9); receipts and
            // confirmations are for payers. None of them is a step on this screen.
            return .ignored
        case .failure:
            // Not a payment code, too long, or damaged text: the same text can never parse later.
            return .unreadable
        case .success(let decoded):
            if phase != .ready, !passesStructureChecks(decoded) { return .unreadable }
            return .payment(decoded)
        }
    }

    /// The inbox handler: counts junk at once, so it never takes a place, and queues the rest in the
    /// inbox's one FIFO for the single consumer. The inbox keeps held and queued texts together
    /// within `PaymentInbox.capacity` (the oldest goes first, counted), whichever screen queued
    /// them. A text arriving while a signature is pending (Face ID) therefore waits in a bounded
    /// queue, never in an open-ended chain of tasks, and a newer screen takes that queue over.
    private func takeFromInbox(_ text: String, arrivedAt: Date) {
        guard let inbox, phase != .unavailable, merchant != nil else { return }
        switch triage(text) {
        case .ignored:
            inboxIgnored += 1
        case .unreadable:
            inboxUnreadable += 1
        case .payment:
            inbox.enqueue(text, arrivedAt: arrivedAt)
            startInboxConsumer()
        }
    }

    private func startInboxConsumer() {
        guard inboxConsumer == nil else { return }
        // Weak: queued texts live in the inbox, so a model that goes away loses none of them.
        inboxConsumer = Task { [weak self] in await self?.drainInbox() }
    }

    /// The single consumer: takes the inbox's queued texts one at a time, in arrival order, only
    /// while this screen's attachment owns the inbox. Once the screen goes away or a newer screen
    /// takes over, it stops; the queue stays in the inbox for whoever is attached.
    private func drainInbox() async {
        while let inbox, let attachment = inboxAttachment,
              let item = inbox.takeNext(for: self, attachment: attachment) {
            await acceptFromInbox(item.text, arrivedAt: item.arrivedAt)
        }
        inboxConsumer = nil
    }

    /// A Bluetooth text. Nobody at the till chose to scan it, so it is checked only while the screen
    /// is ready for a payer: during a payment it goes back to the inbox until Next payment, and never
    /// replaces that payment's issue (a settlement error, a ledger write that failed). Texts that can
    /// never be accepted here are counted, not reported or held: protocol texts for other steps, and
    /// texts that are not valid payment codes. Only an allowance or note that passes its own checks
    /// goes back to the inbox, so junk takes no inbox place and never shows as Stopped later.
    private func acceptFromInbox(_ text: String, arrivedAt: Date) async {
        guard phase != .unavailable, merchant != nil else { return }
        switch triage(text) {
        case .ignored:
            inboxIgnored += 1
        case .unreadable:
            inboxUnreadable += 1
        case .payment(let decoded):
            guard phase == .ready else {
                // Back with its first arrival time, so the inbox age limit still counts from then.
                inbox?.hold(text, arrivedAt: arrivedAt)
                return
            }
            await accept(decoded)
        }
    }

    /// True when the allowance verifies, or the note passes PAYMENT-V1 section 6, on their own.
    private func passesStructureChecks(_ decoded: (kind: PaymentTransport.Kind, payload: Data)) -> Bool {
        switch decoded.kind {
        case .allowance:
            guard let serverPublicKey else { return false }
            return (try? AllowanceCertificate.verify(wire: decoded.payload, deployment: deployment,
                                                     serverPublicKey: serverPublicKey)) != nil
        case .note:
            return (try? SignedNote.validate(wire: decoded.payload, deployment: deployment)) != nil
        default:
            return false
        }
    }

    /// Waits until every inbox text handed over so far has been checked (for tests).
    func inboxDrained() async {
        await inboxConsumer?.value
    }

    /// Scanned or received `L1|P|1|A|...` or `L1|P|1|N|...`. Nothing is dropped silently: an
    /// allowance is always kept, and a note that arrives during another payment, or while a
    /// different note waits for its allowance, is refused by name.
    public func accept(text: String) async {
        guard phase != .unavailable, merchant != nil else { return }
        switch ScanParser.parse(text, accepting: [.allowance, .note]) {
        case .failure(let kind):
            report(kind)
        case .success(let decoded):
            await accept(decoded)
        }
    }

    /// An `A` or `N` payload that has already been parsed.
    private func accept(_ decoded: (kind: PaymentTransport.Kind, payload: Data)) async {
        if decoded.kind == .allowance {
            await acceptAllowance(decoded.payload)
        } else {
            await acceptNote(decoded.payload)
        }
    }

    private func acceptAllowance(_ wire: Data) async {
        guard let serverPublicKey else { return }
        do {
            let certificate = try AllowanceCertificate.verify(wire: wire, deployment: deployment,
                                                              serverPublicKey: serverPublicKey)
            allowances[certificate.allowanceId] = certificate
            allowanceWires[certificate.allowanceId] = wire
            // During a payment the screen shows that payment's allowance and its issues; leave
            // them. The certificate is kept, so the next payer's note still finds it.
            guard phase == .ready else { return }
            show(certificate)
            refreshUnsettled(certificate.allowanceId)
            guard let waiting = waitingNote else {
                issue = nil
                return
            }
            if waiting.note.allowanceId == certificate.allowanceId {
                waitingNote = nil
                issue = nil
                await process(waiting, certificate: certificate)
            } else if issue?.kind != .allowanceNeeded {
                // Another payer's note still waits for its own allowance: its next step stays.
                report(.allowanceNeeded)
            }
        } catch {
            report(PayModel.kind(of: error))
        }
    }

    private func acceptNote(_ wire: Data) async {
        do {
            let note = try SignedNote.validate(wire: wire, deployment: deployment)
            // The same note scanned again is not a second payment.
            if let current = payment, current.note.noteId == note.noteId { return }
            guard phase == .ready else { return report(.busy) }
            // A note this phone already holds unsettled comes back on screen to settle, from the
            // ledger's own copy and only after `recheck`, never reserved again. Without a certificate
            // it takes the allowance path below, and `process` brings it back once the allowance arrives.
            if let held = heldPayment(noteId: note.noteId),
               held.damaged || held.certificate != nil || boundCertificate(for: held.note) != nil {
                await bringBack(held)
                return
            }
            guard let certificate = allowances[note.note.allowanceId] else {
                // One note waits at a time. A different one is refused by name, never swapped in.
                if let waiting = waitingNote, waiting.noteId != note.noteId { return report(.otherNoteWaiting) }
                waitingNote = note
                return report(.allowanceNeeded)
            }
            await process(note, certificate: certificate)
        } catch {
            report(PayModel.kind(of: error))
        }
    }

    private func process(_ note: SignedNote, certificate: AllowanceCertificate) async {
        guard let merchant else { return }
        // Runs only while ready. The card, the limit chip and the risk line now describe the
        // allowance this note is checked against, whatever happens below.
        show(certificate)
        let seconds = Int64(now().timeIntervalSince1970)
        let zeroBars = internetState?().map { $0 == InternetState.none } ?? false
        do {
            try Acceptance.check(note: note, certificate: certificate, merchantKeyHash: merchant.merchantKeyHash, now: seconds)
            // The certificate wire goes into the ledger with the note, so it can be settled later.
            try ledger.accept(note: note, certificate: certificate, now: seconds,
                              allowanceWire: allowanceWires[certificate.allowanceId], receivedWithZeroBars: zeroBars)
        } catch PaymentError.serialSeen {
            refreshUnsettled(certificate.allowanceId)
            // The identical note again is not a reuse: it is already in the ledger. Still pending, it
            // comes back on screen to settle (not reserved again); decided, there is nothing to do.
            if let entries = try? ledger.entries(), let entry = entries.first(where: { $0.noteIdHex == note.noteId.hex }) {
                conflictAllowanceId = nil
                if entry.state == .pending, let held = unsettledPayment(from: entry) {
                    await bringBack(held)
                    return
                }
                return report(.alreadyReceived)
            }
            conflictAllowanceId = isEquivocation(note, certificate: certificate) ? certificate.allowanceId : nil
            return report(.payment(.serialSeen))
        } catch {
            refreshUnsettled(certificate.allowanceId)
            return report(PayModel.kind(of: error))
        }
        conflictAllowanceId = nil
        // Only this note stops waiting. Another payer's waiting note is kept for after this payment.
        if waitingNote?.noteId == note.noteId { waitingNote = nil }
        payment = ReceivedPayment(note: note, certificate: certificate,
                                  receivedAt: Date(timeIntervalSince1970: TimeInterval(seconds)),
                                  receivedWithZeroBars: zeroBars, ack: nil)
        issue = nil
        phase = .received
        refreshUnsettled(certificate.allowanceId)
        await signAck()
    }

    /// True only for a proven equivocation: the earlier note on this serial (kept in the ledger)
    /// and the new one both verify and both carry the certificate's payer key (section 4.9).
    private func isEquivocation(_ note: SignedNote, certificate: AllowanceCertificate) -> Bool {
        guard let entries = try? ledger.entries() else { return false }
        for entry in entries where entry.allowanceId == note.note.allowanceId && entry.serial == note.note.serial {
            guard let wire = Data(hex: entry.wireHex),
                  let earlier = try? SignedNote.validate(wire: wire, deployment: deployment) else { continue }
            if Conflicts.isEquivocation(earlier, note, certificate: certificate) { return true }
        }
        return false
    }

    // MARK: - ACK

    /// True for the Secure Enclave key (Face ID or passcode); false for a software key.
    public var signerIsSecureEnclave: Bool { signer is SecureEnclaveP256Signer }

    /// The line shown while the ACK is being signed: it names Face ID only for the Secure Enclave key.
    public static func ackSigningText(secureEnclave: Bool) -> String {
        secureEnclave ? "Signing the receipt (Face ID or passcode)" : "Signing the receipt with this phone's software key"
    }

    /// Signs the ACK with the merchant key (Face ID or passcode on a phone). Called automatically
    /// after a note is accepted; call again if the first attempt was cancelled.
    public func signAck() async {
        guard phase == .received, let current = payment, current.ack == nil, let signer else { return }
        isWorking = true
        defer { isWorking = false }
        let note = current.note
        let receivedAt = Int64(current.receivedAt.timeIntervalSince1970)
        do {
            let ack = try await Task.detached(priority: .userInitiated) {
                try Ack.sign(note: note, receivedAt: receivedAt, with: signer)
            }.value
            let checked = try Ack.verify(wire: ack.wire, for: note)
            // Kept with the note in the ledger, so settling it after Next payment or a relaunch needs
            // no new signature. If this write fails the note is still held and listed; settling it
            // later signs the ACK again, so nothing is lost.
            try? ledger.attachAck(noteId: note.noteId, ackWire: checked.wire)
            guard var latest = payment, latest.note.noteId == note.noteId else { return }
            latest.ack = checked
            payment = latest
            issue = nil
        } catch let error as PaymentError {
            report(.payment(error))
        } catch {
            report(.signing(error.localizedDescription))
        }
    }

    // MARK: - Settle

    /// Uploads the note and ACK. Paid or Failed comes only from the CONF, verified by the client
    /// and again here as a full receipt; a refusal, a 503 or a dropped connection leaves the note
    /// pending in the ledger.
    public func settle() async {
        guard phase == .received, let current = payment, let ack = current.ack, !isWorking else { return }
        guard let client = settlementClient else { return report(.serverNotConnected) }
        isWorking = true
        defer { isWorking = false }
        do {
            handle(try await client.settle(note: current.note, ack: ack), for: current, ack: ack)
        } catch {
            reportSettlement(error)
        }
    }

    /// True while the note on screen has a pending answer, or a call whose outcome is unknown: Check
    /// again then asks the server by note id.
    public var offersCheckAgain: Bool {
        phase == .received && (pendingSettlement != nil || settlementOutcomeUnknown)
    }

    /// Shown with Check again when the outcome is unknown. A constant string, so it is readable from
    /// any isolation domain.
    public nonisolated static let outcomeUnknownText =
        "No answer this phone can trust came back, so whether the server settled this note is unknown. "
        + "Check again asks the server by note id; Settle again sends the same note."

    /// Asks the server by note id (`GET /v1/notes/{noteId}`) after a pending answer or a call whose
    /// outcome is unknown. The CONF it returns is verified exactly as for an upload.
    public func checkAgain() async {
        guard phase == .received, let current = payment, let ack = current.ack, !isWorking else { return }
        guard let client = settlementClient else { return report(.serverNotConnected) }
        isWorking = true
        defer { isWorking = false }
        do {
            handle(try await client.outcome(noteId: current.note.noteId), for: current, ack: ack)
        } catch {
            reportSettlement(error)
        }
    }

    private func handle(_ outcome: SettlementOutcome, for current: ReceivedPayment, ack: Ack) {
        guard phase == .received, payment?.note.noteId == current.note.noteId, let serverPublicKey else { return }
        switch outcome {
        case .pending(let pending):
            pendingSettlement = pending
            settlementOutcomeUnknown = false
            issue = nil
        case .decided(let decision):
            let bytes = Bundles.receipt(note: current.note, ack: ack, confirmationWire: decision.confirmationWire)
            let receipt: VerifiedReceipt
            do {
                receipt = try Receipts.verify(bytes, deployment: deployment, serverPublicKey: serverPublicKey)
            } catch let error as PaymentError {
                return reportSettlement(SettlementError.verification(error))
            } catch {
                return reportSettlement(SettlementError.verification(.transport))
            }
            settlement = SettledPayment(receipt: receipt, receiptText: PaymentTransport.encode(.receipt, bytes),
                                        replayed: decision.replayed, reasonUnsigned: decision.reason)
            pendingSettlement = nil
            settlementOutcomeUnknown = false
            issue = nil
            phase = .settled
            do {
                try ledger.resolve(noteId: current.note.noteId, as: receipt.status == .settled ? .settled : .refused)
            } catch {
                // Not `storage` ("nothing was accepted"): the chain has decided; only the local record failed.
                report(.ledgerNotUpdated(paid: receipt.status == .settled))
            }
            refreshUnsettled(current.certificate.allowanceId)
        }
    }

    /// Shows a failed settlement call. The ledger is never touched here, so the note stays reserved
    /// whatever went wrong. A failure with no answer this phone can trust makes the note's outcome
    /// unknown and offers Check again. Only a note-specific answer that resolves it clears that
    /// (here `unknown_note` or a 422; a verified CONF or a 202 in `handle`). An error about only
    /// the latest request (a 429, the 400s, `chain_unavailable`) keeps an earlier unknown outcome.
    private func reportSettlement(_ error: Error) {
        if error is CancellationError { return }
        let settlement = (error as? SettlementError) ?? .transport(String(describing: error))
        switch settlement {
        case .stillPending(let pending): pendingSettlement = pending
        // The server never attempted this note id, so no attempt is in flight: Settle uploads it.
        case .unknownNote: pendingSettlement = nil
        default: break
        }
        if settlement.leavesOutcomeUnknown {
            settlementOutcomeUnknown = true
        } else if settlement.resolvesUnknownOutcome {
            settlementOutcomeUnknown = false
        }
        report(.settlement(settlement))
    }

    /// Drops the note waiting for its allowance (the payer left, or sent the wrong note). Only the
    /// merchant's tap does this; the ledger never saw that note.
    public func clearWaitingNote() {
        guard phase == .ready, waitingNote != nil else { return }
        waitingNote = nil
        issue = nil
    }

    /// Shown above Next payment while the note on screen is not settled: the ledger keeps the note
    /// with its certificate and signed receipt, so it stays settleable from the Receive screen. A
    /// constant string, so it is readable from any isolation domain.
    public nonisolated static let unsettledNextPaymentText =
        "Next payment keeps this note in the offline ledger with its signed receipt. It stays under Unsettled on "
        + "this phone on the Receive screen, even after a restart, so it can be settled when there is signal."

    /// Clears the screen for the next payer. The ledger keeps every accepted note, and the unsettled
    /// ones are listed again; Bluetooth codes that arrived during the payment are checked now, in
    /// arrival order. A note still waiting for its allowance belongs to a payer who has not paid yet,
    /// so it stays and its next step shows again (Clear the waiting note drops it).
    public func nextPayment() {
        guard phase != .unavailable, !isWorking else { return }
        payment = nil
        settlement = nil
        pendingSettlement = nil
        settlementOutcomeUnknown = false
        issue = nil
        conflictAllowanceId = nil
        // The previous payer's allowance is not progress for the next one.
        lastAllowance = nil
        unsettledTotal = nil
        unsettledAllowanceId = nil
        phase = .ready
        loadUnsettled()
        if waitingNote != nil { report(.allowanceNeeded) }
        // Drops, ignored and unreadable texts so far were shown during that payment; the next
        // payer's counts start here. Taken before release(), so a held code that expires now counts for them.
        inboxDroppedBefore = inbox?.droppedWhileDetached ?? 0
        inboxIgnored = 0
        inboxUnreadable = 0
        inbox?.release()
    }

    // MARK: - Unsettled on this phone

    /// Settle on a row of "Unsettled on this phone". The note is read fresh from the ledger and comes
    /// back on screen only after `recheck`, never reserved again; then it uploads like Settle: Paid
    /// or Failed only from a verified CONF, which also releases it from the ledger. Every other
    /// outcome leaves it reserved and listed.
    public func settleUnsettled(noteId: Data) async {
        guard phase == .ready, !isWorking else { return }
        guard settlementClient != nil else { return report(.serverNotConnected) }
        // No longer pending (another screen decided it) or no longer readable: list again.
        guard let held = heldPayment(noteId: noteId) else { return loadUnsettled() }
        guard await bringBack(held) else { return }
        await settle()
    }

    /// False for a damaged record, and for a note stored without its certificate whose allowance has
    /// not been scanned on this screen. True does not promise `recheck` passes.
    public func canSettle(_ held: UnsettledPayment) -> Bool {
        !held.damaged && (held.certificate != nil || boundCertificate(for: held.note) != nil)
    }

    /// The line above the list.
    public nonisolated static func unsettledSummary(count: Int, total: UInt64, unlisted: Int, unreadable: Bool) -> String {
        if unreadable {
            return "This phone could not read its offline ledger, so its unsettled notes cannot be listed. "
                + "Nothing was released; they stay reserved."
        }
        var line = (count == 1 ? "1 note" : String(count) + " notes") + ", $" + Money.display(baseUnits: total)
            + " sandbox, accepted offline and not settled yet. Each keeps its signed receipt; settling needs internet."
        if unlisted > 0 {
            line += " " + String(unlisted) + " more held " + (unlisted == 1 ? "note" : "notes")
                + " could not be read back to settle here; the ledger still counts them."
        }
        return line
    }

    /// The caption under one row.
    public nonisolated static func unsettledRowText(_ held: UnsettledPayment, canSettle: Bool) -> String {
        // String(...) keeps the id verbatim: a localized interpolation would print "1,001".
        var line = "Allowance #" + String(held.note.note.allowanceId) + ", received "
            + held.receivedAt.formatted(date: .abbreviated, time: .shortened) + " (this phone's clock)."
        if held.damaged {
            line += " Its saved record on this phone does not verify, so it cannot be settled from here."
        } else if !canSettle {
            line += " Scan its allowance code (code 1 of 2) to settle it."
        } else if held.ack == nil {
            line += " Settling checks it again as if received now and signs its receipt first."
        }
        return line
    }

    /// Reads "Unsettled on this phone" from the offline ledger. A ledger that cannot be read is
    /// reported as such, never as an empty list.
    private func loadUnsettled() {
        guard merchant != nil, phase != .unavailable else { return }
        do {
            let entries = try ledger.pending()
            let payments = entries.compactMap(unsettledPayment(from:))
            unsettledPayments = payments
            unsettledPaymentsUnlisted = entries.count - payments.count
            unsettledPaymentsUnreadable = false
        } catch {
            unsettledPayments = []
            unsettledPaymentsUnlisted = 0
            unsettledPaymentsUnreadable = true
        }
    }

    /// A pending ledger entry read back: the stored note must pass PAYMENT-V1 section 6 and be
    /// addressed to this merchant. A stored certificate must verify with the pinned key and name the
    /// note's allowance and payer; a stored ACK must verify with this merchant's key and bind this
    /// note id. A part that is present but fails marks the record damaged, and so does another entry
    /// on the same allowance and serial; nothing stored is trusted as stored. Nothing here is a
    /// merchant check: `recheck` runs those before the note is shown.
    private func unsettledPayment(from entry: OfflineLedger.Entry) -> UnsettledPayment? {
        guard let merchant, let serverPublicKey, let wire = Data(hex: entry.wireHex),
              let note = try? SignedNote.validate(wire: wire, deployment: deployment),
              note.note.payeeKeyHash == merchant.merchantKeyHash else { return nil }
        var damaged = entry.sharesSerial
        var certificate: AllowanceCertificate?
        if let hex = entry.allowanceWireHex {
            if let wire = Data(hex: hex),
               let verified = try? AllowanceCertificate.verify(wire: wire, deployment: deployment,
                                                               serverPublicKey: serverPublicKey),
               verified.allowanceId == note.note.allowanceId, verified.payerKeyHash == note.payerKeyHash {
                certificate = verified
            } else {
                damaged = true
            }
        }
        var ack: Ack?
        if let hex = entry.ackWireHex {
            if let wire = Data(hex: hex), let verified = try? Ack.verify(wire: wire, for: note),
               P256Rules.keyHash(verified.merchantPublicKey) == merchant.merchantKeyHash {
                ack = verified
            } else {
                damaged = true
            }
        }
        let seconds = ack?.receivedAt ?? entry.acceptedAt
        return UnsettledPayment(note: note, receivedAt: Date(timeIntervalSince1970: TimeInterval(seconds)),
                                receivedWithZeroBars: entry.receivedWithZeroBars ?? false,
                                certificate: certificate, ack: ack, damaged: damaged)
    }

    /// Checks a held note again, as an acceptance, before it may show as Received.
    ///
    /// The stored ACK is this merchant's own signature over the note id and the time the note was
    /// received, so it authenticates the ledger record: with one, the merchant checks run at that
    /// signed time and the ACK is reused (no new signature). With no ACK stored (an older entry, or
    /// a signature that never finished), the note is treated as received now, like a fresh scan:
    /// the checks run at the phone's time now and the owner signs a new ACK for that time. A
    /// damaged record is refused and nothing is signed. Either way the note was reserved when it
    /// was accepted, so it is not reserved again: the ledger must hold exactly one reservation for
    /// its allowance and serial, this note's, and the allowance's reserved total must still be
    /// within the certificate's offline limit.
    private func recheck(_ held: UnsettledPayment) -> Result<ReceivedPayment, MoneyIssueKind> {
        guard let merchant else { return .failure(.noMerchantCertificate) }
        guard !held.damaged else { return .failure(.damagedRecord) }
        guard let certificate = held.certificate ?? boundCertificate(for: held.note) else {
            return .failure(.allowanceNeeded)
        }
        let receivedAt: Int64
        let zeroBars: Bool
        if let ack = held.ack {
            receivedAt = ack.receivedAt
            zeroBars = held.receivedWithZeroBars
        } else {
            receivedAt = Int64(now().timeIntervalSince1970)
            zeroBars = internetState?().map { $0 == InternetState.none } ?? false
        }
        do {
            // Merchant check 6, read again now: the one reservation on this serial is this note's.
            // Two on one serial is a damaged ledger; both stay reserved and neither is shown or signed.
            guard try ledger.holdsSoleReservation(noteId: held.note.noteId) else { return .failure(.damagedRecord) }
            // PAYMENT-V1 section 6 merchant checks 2 to 5: allowance, payer, payee and earmarks, expiry.
            try Acceptance.check(note: held.note, certificate: certificate, merchantKeyHash: merchant.merchantKeyHash,
                                 now: receivedAt)
            // Checks 6 and 7 held when it was reserved; the reserved total, this note included, must
            // still be within the offline limit of the certificate it is shown against.
            guard try ledger.unsettledTotal(allowanceId: certificate.allowanceId) <= certificate.offlineLimit else {
                throw PaymentError.offlineLimit
            }
        } catch let error as PaymentError {
            return .failure(.payment(error))
        } catch {
            return .failure(.payment(.storage))
        }
        return .success(ReceivedPayment(note: held.note, certificate: certificate,
                                        receivedAt: Date(timeIntervalSince1970: TimeInterval(receivedAt)),
                                        receivedWithZeroBars: zeroBars, ack: held.ack))
    }

    /// Brings a held note back on screen after `recheck`, or shows the named reason it cannot come back.
    @discardableResult
    private func bringBack(_ held: UnsettledPayment) async -> Bool {
        switch recheck(held) {
        case .failure(let kind):
            report(kind)
            return false
        case .success(let received):
            await restore(received)
            return true
        }
    }

    /// The pending ledger entry for `noteId`, read fresh, as a settleable payment.
    private func heldPayment(noteId: Data) -> UnsettledPayment? {
        guard let entry = (try? ledger.pending())?.first(where: { $0.noteIdHex == noteId.hex }) else { return nil }
        return unsettledPayment(from: entry)
    }

    /// A certificate seen on this screen that binds `note`: same allowance id and payer key.
    private func boundCertificate(for note: SignedNote) -> AllowanceCertificate? {
        guard let certificate = allowances[note.note.allowanceId],
              certificate.payerKeyHash == note.payerKeyHash else { return nil }
        return certificate
    }

    /// Puts a rechecked held note back on screen to settle. It was reserved when it was accepted, so
    /// the ledger is not touched here; a stored ACK is reused, so there is no new Face ID prompt.
    /// Without one, the owner signs an ACK for the time `recheck` used, as after a fresh scan.
    private func restore(_ received: ReceivedPayment) async {
        show(received.certificate)
        conflictAllowanceId = nil
        if waitingNote?.noteId == received.note.noteId { waitingNote = nil }
        payment = received
        settlement = nil
        pendingSettlement = nil
        settlementOutcomeUnknown = false
        issue = nil
        phase = .received
        refreshUnsettled(received.certificate.allowanceId)
        if received.ack == nil { await signAck() }
    }

    // MARK: - Helpers

    /// Puts `certificate` on the ready card. A conflict seen for another allowance is not this one's.
    private func show(_ certificate: AllowanceCertificate) {
        if conflictAllowanceId != certificate.allowanceId { conflictAllowanceId = nil }
        lastAllowance = certificate
    }

    private func refreshUnsettled(_ allowanceId: UInt64) {
        unsettledAllowanceId = allowanceId
        unsettledTotal = try? ledger.unsettledTotal(allowanceId: allowanceId)
    }

    private func report(_ kind: MoneyIssueKind) {
        issue = MoneyIssue(kind, at: now())
    }
}

#if DEBUG
extension ReceiveModel {
    /// PREVIEW ONLY: places a model built from test vectors into one state for the Xcode canvas.
    static func preview(_ phase: Phase, payment: ReceivedPayment? = nil, settlement: SettledPayment? = nil,
                        pending: PendingSettlement? = nil, issue: MoneyIssueKind? = nil, conflict: Bool = false,
                        unsettled: UInt64? = nil, waitingNote: SignedNote? = nil, bluetoothInbox: Bool = false,
                        outcomeUnknown: Bool = false, held: [UnsettledPayment] = [],
                        serverKey: Data? = PreviewFixtures.serverKey) -> ReceiveModel {
        let model = ReceiveModel(merchantWire: PreviewFixtures.merchantWire, signer: PreviewFixtures.merchantSigner,
                                 ledger: OfflineLedger(url: PreviewFixtures.scratchURL("preview-ledger.json")),
                                 settlementClient: nil, deployment: PreviewFixtures.deployment,
                                 serverPublicKey: serverKey, inbox: bluetoothInbox ? PaymentInbox() : nil,
                                 now: { PreviewFixtures.now })
        guard model.phase != .unavailable else { return model }
        model.phase = phase
        model.payment = payment
        model.settlement = settlement
        model.pendingSettlement = pending
        model.settlementOutcomeUnknown = outcomeUnknown
        model.unsettledPayments = held
        model.unsettledPaymentsUnreadable = false
        model.unsettledPaymentsUnlisted = 0
        model.waitingNote = waitingNote
        // A ready screen with an unsettled figure has seen the payer's allowance; a bare ready
        // screen has seen nothing yet.
        model.lastAllowance = payment?.certificate ?? (unsettled != nil ? PreviewFixtures.allowance : nil)
        model.unsettledTotal = unsettled
        model.unsettledAllowanceId = model.lastAllowance?.allowanceId
        model.conflictAllowanceId = conflict ? model.lastAllowance?.allowanceId : nil
        model.issue = issue.map { MoneyIssue($0, at: PreviewFixtures.now) }
        return model
    }
}
#endif
