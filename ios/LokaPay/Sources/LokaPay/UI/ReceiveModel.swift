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
/// certificate as a code; the payer's allowance (A) and note (N) arrive by camera or Bluetooth in
/// either order. A note is accepted only after PAYMENT-V1 section 6 (`SignedNote.validate`), the
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
    public private(set) var lastAllowance: AllowanceCertificate?
    /// A valid note that arrived before its allowance certificate.
    public private(set) var waitingNote: SignedNote?
    public private(set) var payment: ReceivedPayment?
    public private(set) var settlement: SettledPayment?
    /// The last HTTP 202 for this note: the chain has not decided yet. Unsigned.
    public private(set) var pendingSettlement: PendingSettlement?
    public private(set) var issue: MoneyIssue?
    /// A second valid note from the certificate's payer on a serial already in the ledger.
    public private(set) var conflictingSpend = false
    public private(set) var isWorking = false
    /// This merchant's pending total for the allowance on screen (OfflineLedger).
    public private(set) var unsettledTotal: UInt64?

    public let deployment: Deployment
    private let signer: (any PaymentSigner)?
    private let ledger: OfflineLedger
    private let settlementClient: SettlementClient?
    private let serverPublicKey: Data?
    private let internetState: (@MainActor () -> InternetState?)?
    private let now: @Sendable () -> Date

    /// - Parameters:
    ///   - merchantWire: this phone's merchant certificate from `POST /v1/merchants` (verified here).
    ///   - settlementClient: nil when no server is connected; Settle then says so.
    ///   - internetState: the phone's current path, for the phone-reported "zero bars" stamp.
    public init(merchantWire: Data?, signer: (any PaymentSigner)?, ledger: OfflineLedger,
                settlementClient: SettlementClient?, deployment: Deployment, serverPublicKey: Data?,
                internetState: (@MainActor () -> InternetState?)? = nil,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.deployment = deployment
        self.signer = signer
        self.ledger = ledger
        self.settlementClient = settlementClient
        self.serverPublicKey = serverPublicKey
        self.internetState = internetState
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

    /// The acceptance check chip state for the allowance on screen.
    public var limitState: LimitState? {
        guard let certificate = payment?.certificate ?? lastAllowance, let unsettled = unsettledTotal else { return nil }
        return LimitState.from(unsettled: unsettled, offlineLimit: certificate.offlineLimit, conflict: conflictingSpend)
    }

    // MARK: - Incoming codes

    /// Scanned or received `L1|P|1|A|...` or `L1|P|1|N|...`. Nothing is dropped silently: an
    /// allowance is always kept, and a note that arrives during another payment is refused by name.
    public func accept(text: String) async {
        guard phase != .unavailable, merchant != nil else { return }
        switch ScanParser.parse(text, accepting: [.allowance, .note]) {
        case .failure(let kind):
            report(kind)
        case .success(let decoded):
            if decoded.kind == .allowance {
                await acceptAllowance(decoded.payload)
            } else {
                await acceptNote(decoded.payload)
            }
        }
    }

    private func acceptAllowance(_ wire: Data) async {
        guard let serverPublicKey else { return }
        do {
            let certificate = try AllowanceCertificate.verify(wire: wire, deployment: deployment,
                                                              serverPublicKey: serverPublicKey)
            allowances[certificate.allowanceId] = certificate
            lastAllowance = certificate
            // During a payment the screen shows that payment's allowance and its issues; leave them.
            guard phase == .ready else { return }
            issue = nil
            refreshUnsettled(certificate.allowanceId)
            if let waiting = waitingNote, waiting.note.allowanceId == certificate.allowanceId {
                waitingNote = nil
                await process(waiting, certificate: certificate)
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
        let seconds = Int64(now().timeIntervalSince1970)
        do {
            try Acceptance.check(note: note, certificate: certificate, merchantKeyHash: merchant.merchantKeyHash, now: seconds)
            try ledger.accept(note: note, certificate: certificate, now: seconds)
        } catch PaymentError.serialSeen {
            refreshUnsettled(certificate.allowanceId)
            // The identical note again is not a reuse: it is already in the ledger.
            if let entries = try? ledger.entries(), entries.contains(where: { $0.noteIdHex == note.noteId.hex }) {
                conflictingSpend = false
                return report(.alreadyReceived)
            }
            conflictingSpend = isEquivocation(note, certificate: certificate)
            return report(.payment(.serialSeen))
        } catch {
            refreshUnsettled(certificate.allowanceId)
            return report(PayModel.kind(of: error))
        }
        conflictingSpend = false
        waitingNote = nil
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
                report(.payment(.storage))
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

    /// Clears the screen for the next payer. The ledger keeps every accepted note.
    public func nextPayment() {
        guard phase != .unavailable, !isWorking else { return }
        payment = nil
        settlement = nil
        pendingSettlement = nil
        waitingNote = nil
        issue = nil
        conflictingSpend = false
        phase = .ready
    }

    // MARK: - Helpers

    private func refreshUnsettled(_ allowanceId: UInt64) {
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
                        unsettled: UInt64? = nil, serverKey: Data? = PreviewFixtures.serverKey) -> ReceiveModel {
        let model = ReceiveModel(merchantWire: PreviewFixtures.merchantWire, signer: PreviewFixtures.merchantSigner,
                                 ledger: OfflineLedger(url: PreviewFixtures.scratchURL("preview-ledger.json")),
                                 settlementClient: nil, deployment: PreviewFixtures.deployment,
                                 serverPublicKey: serverKey, now: { PreviewFixtures.now })
        guard model.phase != .unavailable else { return model }
        model.phase = phase
        model.payment = payment
        model.settlement = settlement
        model.pendingSettlement = pending
        model.conflictingSpend = conflict
        model.unsettledTotal = unsettled
        model.lastAllowance = payment?.certificate ?? PreviewFixtures.allowance
        model.issue = issue.map { MoneyIssue($0, at: PreviewFixtures.now) }
        return model
    }
}
#endif
