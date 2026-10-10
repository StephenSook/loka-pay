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

    public let deployment: Deployment
    private let signer: (any PaymentSigner)?
    private let ledger: OfflineLedger
    private let settlementClient: SettlementClient?
    private let serverPublicKey: Data?
    private let internetState: (@MainActor () -> InternetState?)?
    private let now: @Sendable () -> Date
    private let inbox: PaymentInbox?
    /// A Bluetooth text this screen took from the inbox and has not started checking yet.
    private struct QueuedText {
        let text: String
        let arrivedAt: Date
    }
    /// Inbox texts waiting for the single consumer, oldest first. Together with the inbox's held
    /// texts they never exceed `PaymentInbox.capacity`.
    @ObservationIgnored private var inboxQueue: [QueuedText] = []
    /// The one task that checks queued inbox texts, one after another, in arrival order.
    @ObservationIgnored private var inboxConsumer: Task<Void, Never>?

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
        guard phase != .unavailable else { return }
        inbox?.attach(self) { [weak self] text, arrivedAt in
            guard let self else { return false }
            self.takeFromInbox(text, arrivedAt: arrivedAt)
            return true
        }
    }

    /// Stops taking inbox texts (a newer Receive model that already attached keeps the inbox).
    public func stopInbox() {
        inbox?.detach(self)
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

    /// The inbox handler: counts junk at once, so it never takes a place, and queues the rest for
    /// the single consumer. Queued texts count toward `PaymentInbox.capacity` with the held ones;
    /// when they would pass it, the oldest pending text is dropped and counted, as when the inbox
    /// holds too many. A text arriving while a signature is pending (Face ID) therefore waits in a
    /// bounded queue, never in an open-ended chain of tasks.
    private func takeFromInbox(_ text: String, arrivedAt: Date) {
        guard let inbox, phase != .unavailable, merchant != nil else { return }
        switch triage(text) {
        case .ignored:
            inboxIgnored += 1
        case .unreadable:
            inboxUnreadable += 1
        case .payment:
            if inbox.held.count + inboxQueue.count >= PaymentInbox.capacity { dropOldestPending(inbox) }
            inboxQueue.append(QueuedText(text: text, arrivedAt: arrivedAt))
            if inboxConsumer == nil {
                // Holds the model until the queue is empty, so a queued text is never lost with it.
                inboxConsumer = Task { await self.drainInboxQueue() }
            }
        }
    }

    /// Makes room for one text: drops and counts the one that arrived first, held or queued.
    private func dropOldestPending(_ inbox: PaymentInbox) {
        let queued = inboxQueue.indices.min { inboxQueue[$0].arrivedAt < inboxQueue[$1].arrivedAt }
        if let heldAt = inbox.oldestHeldArrival, queued.map({ heldAt <= inboxQueue[$0].arrivedAt }) ?? true {
            inbox.dropOldestHeld()
        } else if let queued {
            inboxQueue.remove(at: queued)
            inbox.recordDrop()
        }
    }

    /// The single consumer: checks queued texts one at a time, in arrival order.
    private func drainInboxQueue() async {
        while !inboxQueue.isEmpty {
            let item = inboxQueue.removeFirst()
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
        do {
            try Acceptance.check(note: note, certificate: certificate, merchantKeyHash: merchant.merchantKeyHash, now: seconds)
            try ledger.accept(note: note, certificate: certificate, now: seconds)
        } catch PaymentError.serialSeen {
            refreshUnsettled(certificate.allowanceId)
            // The identical note again is not a reuse: it is already in the ledger.
            if let entries = try? ledger.entries(), entries.contains(where: { $0.noteIdHex == note.noteId.hex }) {
                conflictAllowanceId = nil
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
        let zeroBars = internetState?().map { $0 == InternetState.none } ?? false
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

    /// Asks the server again after a pending answer (`GET /v1/notes/{noteId}`).
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
            issue = nil
        case .decided(let decision):
            let bytes = Bundles.receipt(note: current.note, ack: ack, confirmationWire: decision.confirmationWire)
            let receipt: VerifiedReceipt
            do {
                receipt = try Receipts.verify(bytes, deployment: deployment, serverPublicKey: serverPublicKey)
            } catch let error as PaymentError {
                return report(.settlement(.verification(error)))
            } catch {
                return report(.settlement(.verification(.transport)))
            }
            settlement = SettledPayment(receipt: receipt, receiptText: PaymentTransport.encode(.receipt, bytes),
                                        replayed: decision.replayed, reasonUnsigned: decision.reason)
            pendingSettlement = nil
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

    private func reportSettlement(_ error: Error) {
        if error is CancellationError { return }
        if let settlement = error as? SettlementError {
            if case .stillPending(let pending) = settlement { pendingSettlement = pending }
            return report(.settlement(settlement))
        }
        report(.settlement(.transport(String(describing: error))))
    }

    /// Drops the note waiting for its allowance (the payer left, or sent the wrong note). Only the
    /// merchant's tap does this; the ledger never saw that note.
    public func clearWaitingNote() {
        guard phase == .ready, waitingNote != nil else { return }
        waitingNote = nil
        issue = nil
    }

    /// Shown above Next payment while the note on screen is not settled: the ACK lives only on this
    /// screen, so the note cannot be settled from here once it is cleared. A constant string, so it
    /// is readable from any isolation domain.
    public nonisolated static let unsettledNextPaymentText =
        "Next payment leaves this note held in the offline ledger, unsettled. It cannot be settled from this "
        + "screen afterwards, so settle first when there is signal."

    /// Clears the screen for the next payer. The ledger keeps every accepted note; Bluetooth codes
    /// that arrived during the payment are checked now, in arrival order. A note still waiting for
    /// its allowance belongs to a payer who has not paid yet, so it stays and its next step shows
    /// again (Clear the waiting note drops it).
    public func nextPayment() {
        guard phase != .unavailable, !isWorking else { return }
        payment = nil
        settlement = nil
        pendingSettlement = nil
        issue = nil
        conflictAllowanceId = nil
        // The previous payer's allowance is not progress for the next one.
        lastAllowance = nil
        unsettledTotal = nil
        unsettledAllowanceId = nil
        phase = .ready
        if waitingNote != nil { report(.allowanceNeeded) }
        // Drops, ignored and unreadable texts so far were shown during that payment; the next
        // payer's counts start here. Taken before release(), so a held code that expires now counts for them.
        inboxDroppedBefore = inbox?.droppedWhileDetached ?? 0
        inboxIgnored = 0
        inboxUnreadable = 0
        inbox?.release()
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
