import Foundation
import Observation

/// The payer's allowance as this phone trusts it: the certificate verified with the pinned server
/// key, plus the wire as received (the merchant needs it too: PAYMENT-V1 section 6, merchant checks).
public struct PayerAllowance: Equatable, Sendable {
    public let certificate: AllowanceCertificate
    public let wire: Data

    public init(wire: Data, deployment: Deployment, serverPublicKey: Data) throws {
        certificate = try AllowanceCertificate.verify(wire: wire, deployment: deployment, serverPublicKey: serverPublicKey)
        self.wire = Data(wire)
    }
}

/// A note this phone signed, ready to hand over. Bluetooth glue sends `transportTexts` in order;
/// the camera path shows them as two QR codes in the same order.
public struct SignedPayment: Equatable, Sendable {
    public let note: SignedNote
    /// `L1|P|1|A|...`: the payer's allowance certificate (existing kind A).
    public let allowanceText: String
    /// `L1|P|1|N|...`: the signed note (existing kind N).
    public let noteText: String

    public var transportTexts: [String] { [allowanceText, noteText] }
}

/// Try to cheat (task 2.13), a sandbox demo of a double spend: this phone's last signed note
/// signed AGAIN, with the same allowance, serial, amount, currency and expiry, for a different
/// merchant. It is a genuine note, so merchant B accepts it offline; Solana refuses the reused
/// serial on chain (SerialUsed), and that failed transaction is the evidence.
public struct CheatNote: Equatable, Sendable {
    /// The note this phone signed first. Its payment card stays as it was.
    public let original: SignedNote
    /// Merchant B, verified with the pinned server key and the deployment.
    public let merchant: MerchantCertificate
    /// The cheat note and its two codes (allowance first), shown like any note.
    public let payment: SignedPayment

    /// The banner over the cheat codes.
    public var banner: String {
        Self.banner(serial: payment.note.note.serial, allowanceId: payment.note.note.allowanceId,
                    merchantName: merchant.displayName)
    }

    public static func banner(serial: UInt8, allowanceId: UInt64, merchantName: String) -> String {
        // String(...) keeps the id verbatim: a localized interpolation would print "1,001".
        "Cheat note: serial " + String(serial) + " of allowance #" + String(allowanceId) + " signed again for "
            + merchantName + ". Merchant B will accept it offline; Solana should refuse it. Sandbox only."
    }
}

/// The Pay screen (tasks 3.71, 3.70, 2.1 package side). Order of work: scan and verify the merchant
/// certificate, check the amount against the verified allowance, durably reserve a serial, sign
/// (the Secure Enclave signer shows Face ID or the passcode), check the signed note with the same
/// rules every verifier runs, then hand it over as text or QR codes. Every number on screen comes
/// from a verified certificate; the status comes from verified acks and receipts only.
@MainActor
@Observable
public final class PayModel {
    public enum Phase: Equatable, Sendable {
        /// Something required is missing or does not verify; `issue` says what.
        case unavailable
        case scanMerchant
        case enterAmount
        /// Waiting for the signer (Face ID or passcode on a phone).
        case signing
        /// The note is signed: show the two codes or send the texts.
        case showNote
        /// A verified merchant ack or receipt for this note.
        case receipt
    }

    /// Which of the two codes is on screen.
    public enum CodeStep: Int, Equatable, Sendable {
        case allowance = 0
        case note = 1
    }

    /// The Try to cheat control's own steps. They sit under the payment card and never change
    /// `phase`, `payment` or `receipt`, so the original payment is shown exactly as before.
    public enum CheatStep: Equatable, Sendable {
        case off
        /// Scanning merchant B's code.
        case scanMerchant
        /// Merchant B verified; waiting for the owner to sign.
        case confirm
        /// Waiting for the signer (Face ID or passcode on a phone).
        case signing
        /// The cheat note is signed: show its two codes.
        case showNote
    }

    public private(set) var phase: Phase = .unavailable
    public private(set) var allowance: PayerAllowance?
    public private(set) var merchant: MerchantCertificate?
    public private(set) var payment: SignedPayment?
    public private(set) var receipt: VerifiedReceipt?
    public private(set) var issue: MoneyIssue?
    public private(set) var codeStep: CodeStep = .allowance
    /// Serials reserved for this allowance on this phone (from SerialReservations).
    public private(set) var notesSigned: Int?
    public var amountText = ""

    public private(set) var cheatStep: CheatStep = .off
    /// The note the cheat signs again: the payment on screen when Try to cheat was pressed.
    public private(set) var cheatOriginal: SignedNote?
    /// Merchant B, once its certificate verified.
    public private(set) var cheatMerchant: MerchantCertificate?
    public private(set) var cheat: CheatNote?
    public private(set) var cheatCodeStep: CodeStep = .allowance
    /// Counts signing attempts; each `signCheat` and each close of the control moves it on, so a
    /// result from a superseded attempt is recognised and dropped.
    @ObservationIgnored private var cheatAttempt: UInt64 = 0

    public let deployment: Deployment
    private let signer: (any PaymentSigner)?
    private let serials: SerialReservations
    private let serverPublicKey: Data?
    private let meshSend: (@MainActor (String) -> Void)?
    private let now: @Sendable () -> Date
    /// The decimal separator the phone's keyboard types ("," in many locales).
    private let decimalSeparator: String

    /// - Parameters:
    ///   - allowanceWire: the allowance wire from `POST /v1/payers` (verified here before use).
    ///   - meshSend: Bluetooth glue that sends one transport text; nil hides the Bluetooth button.
    ///   - locale: whose decimal separator the amount field accepts (the decimal pad types it).
    public init(allowanceWire: Data?, signer: (any PaymentSigner)?, serials: SerialReservations,
                deployment: Deployment, serverPublicKey: Data?,
                meshSend: (@MainActor (String) -> Void)? = nil,
                locale: Locale = .current,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.deployment = deployment
        self.signer = signer
        self.serials = serials
        self.serverPublicKey = serverPublicKey
        self.meshSend = meshSend
        self.decimalSeparator = locale.decimalSeparator ?? "."
        self.now = now
        if let problem = setUp(allowanceWire: allowanceWire) { report(problem) }
    }

    /// Verifies the inputs; nil when the screen can start.
    private func setUp(allowanceWire: Data?) -> MoneyIssueKind? {
        guard let serverPublicKey, serverPublicKey.count == 32 else { return .serverKeyMissing }
        guard let allowanceWire else { return .noAllowance }
        guard let signer else { return .noSigner }
        do {
            let verified = try PayerAllowance(wire: allowanceWire, deployment: deployment, serverPublicKey: serverPublicKey)
            allowance = verified
            guard verified.certificate.payerKeyHash == signer.keyHash else { return .keyMismatch }
        } catch {
            return Self.kind(of: error)
        }
        refreshNotesSigned()
        phase = .scanMerchant
        return nil
    }

    // MARK: - Merchant

    /// Scanned or pasted `L1|P|1|C|...`. Verified with the pinned server key before use.
    public func acceptMerchant(text: String) {
        guard phase == .scanMerchant || phase == .enterAmount,
              let certificate = allowance?.certificate, let serverPublicKey else { return }
        switch ScanParser.parse(text, accepting: [.merchant]) {
        case .failure(let kind):
            report(kind)
        case .success(let decoded):
            do {
                let verified = try MerchantCertificate.verify(wire: decoded.payload, deployment: deployment,
                                                              serverPublicKey: serverPublicKey)
                guard certificate.allows(merchantKeyHash: verified.merchantKeyHash) else {
                    return report(.payment(.notEarmarked))
                }
                merchant = verified
                issue = nil
                phase = .enterAmount
            } catch {
                report(Self.kind(of: error))
            }
        }
    }

    public func changeMerchant() {
        guard phase == .enterAmount || phase == .receipt || phase == .showNote else { return }
        merchant = nil
        resetPayment()
        phase = .scanMerchant
    }

    // MARK: - Amount

    /// The amount in base units, or why it cannot be paid. Limits come from the verified certificate.
    public var amountCheck: Result<UInt64, MoneyIssueKind> {
        guard let certificate = allowance?.certificate else { return .failure(.noAllowance) }
        var text = amountText.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("$") { text = String(text.dropFirst()).trimmingCharacters(in: .whitespaces) }
        text = Self.normalizedAmount(text, decimalSeparator: decimalSeparator)
        guard let units = Money.baseUnits(text) else { return .failure(.amountUnreadable) }
        guard units > 0 else { return .failure(.payment(.amountZero)) }
        guard units <= certificate.cap else { return .failure(.overCap) }
        guard units <= certificate.offlineLimit else { return .failure(.payment(.offlineLimit)) }
        return .success(units)
    }

    /// `Money.baseUnits` reads "." only. In a locale whose decimal separator is something else
    /// ("," in German or French), that separator becomes "." first. A "," in a "." locale is a
    /// thousands separator there, so it is left alone and "1,000" stays unreadable.
    static func normalizedAmount(_ text: String, decimalSeparator: String) -> String {
        guard !decimalSeparator.isEmpty, decimalSeparator != "." else { return text }
        return text.replacingOccurrences(of: decimalSeparator, with: ".")
    }

    // MARK: - Pay

    public func pay() async {
        guard phase == .enterAmount, let allowance, let merchant, let signer else { return }
        let certificate = allowance.certificate
        let units: UInt64
        switch amountCheck {
        case .failure(let kind): return report(kind)
        case .success(let value): units = value
        }
        guard Int64(now().timeIntervalSince1970) <= certificate.expiry else { return report(.payment(.expired)) }

        // Durably reserve the serial BEFORE signing, so no crash can hand it to a second note.
        let serial: UInt8
        do {
            serial = try serials.reserve(allowanceId: certificate.allowanceId)
        } catch {
            return report(Self.kind(of: error))
        }
        refreshNotesSigned()
        // The note may not outlive the allowance (PAYMENT-V1 section 4.1); it uses the full window.
        let note = NoteV1(deployment: deployment, allowanceId: certificate.allowanceId,
                          payeeKeyHash: merchant.merchantKeyHash, amount: units, serial: serial,
                          expiry: certificate.expiry)
        issue = nil
        phase = .signing
        let signed: SignedNote
        do {
            // Off the main actor: the Secure Enclave blocks while Face ID or the passcode sheet is up.
            signed = try await Task.detached(priority: .userInitiated) { try SignedNote.sign(note, with: signer) }.value
            // The same section 6 rules the merchant runs; a broken signer stops here, not at the till.
            let checked = try SignedNote.validate(wire: signed.wire, deployment: deployment)
            guard checked.payerKeyHash == certificate.payerKeyHash else { throw PaymentError.payerMismatch }
        } catch let error as PaymentError {
            phase = .enterAmount
            return report(.payment(error))
        } catch {
            phase = .enterAmount
            return report(.signing("serial \(serial) set aside and never reused; \(error.localizedDescription)"))
        }
        payment = SignedPayment(note: signed,
                                allowanceText: PaymentTransport.encode(.allowance, allowance.wire),
                                noteText: PaymentTransport.encode(.note, signed.wire))
        codeStep = .allowance
        phase = .showNote
    }

    /// True for the Secure Enclave key (Face ID or passcode); false for a software key, which the
    /// screen labels as such (PLAN.md miss branch).
    public var signerIsSecureEnclave: Bool { signer is SecureEnclaveP256Signer }

    /// The signing card's title: it names Face ID only when the Secure Enclave key signs.
    public static func signingTitle(secureEnclave: Bool) -> String {
        secureEnclave ? "Waiting for Face ID or the passcode" : "Signing with this phone's software key (no Face ID)"
    }

    /// The line under the amount. PAYMENT-V1 section 4.5: the offline limit is the most unsettled
    /// value one merchant should accept from this allowance in total, not a per-payment limit.
    public static func offlineLimitHint(_ certificate: AllowanceCertificate) -> String {
        "Up to $\(Money.display(baseUnits: certificate.offlineLimit)) sandbox unsettled with any one merchant (offline limit)."
    }

    // MARK: - Hand over

    public var canSendOverBluetooth: Bool { meshSend != nil }

    /// Sends the allowance, then the note, through the Bluetooth glue.
    public func sendOverBluetooth() {
        guard phase == .showNote || phase == .receipt, let payment, let meshSend else { return }
        for text in payment.transportTexts { meshSend(text) }
    }

    public func showCode(_ step: CodeStep) {
        guard payment != nil else { return }
        codeStep = step
    }

    /// The text behind the code on screen.
    public var currentCodeText: String? {
        guard let payment else { return nil }
        return codeStep == .allowance ? payment.allowanceText : payment.noteText
    }

    // MARK: - Receipt back from the merchant

    /// Scanned or received `L1|P|1|Y|...` (the merchant's ack) or `L1|P|1|X|...` (a receipt, with
    /// a CONF once settled). The status shown comes from the verified parts only.
    public func acceptReturn(text: String) {
        guard phase == .showNote || phase == .receipt, let payment, let serverPublicKey else { return }
        switch ScanParser.parse(text, accepting: [.ack, .receipt]) {
        case .failure(let kind):
            reportReceipt(kind)
        case .success(let decoded):
            do {
                let bytes: Data
                if decoded.kind == .ack {
                    let ack = try Ack.verify(wire: decoded.payload, for: payment.note)
                    bytes = Bundles.receipt(note: payment.note, ack: ack, confirmationWire: nil)
                } else {
                    bytes = decoded.payload
                }
                let verified = try Receipts.verify(bytes, deployment: deployment, serverPublicKey: serverPublicKey)
                guard verified.note.noteId == payment.note.noteId else { return report(.receiptMismatch) }
                // A bare ack never replaces a receipt that already carries a confirmation.
                if verified.confirmation == nil, receipt?.confirmation != nil {
                    issue = nil
                    return
                }
                receipt = verified
                issue = nil
                phase = .receipt
            } catch {
                reportReceipt(Self.kind(of: error))
            }
        }
    }

    /// Back to the amount for the same merchant (or to the scanner when there is none).
    public func newPayment() {
        guard phase == .showNote || phase == .receipt || phase == .enterAmount else { return }
        resetPayment()
        phase = merchant == nil ? .scanMerchant : .enterAmount
    }

    // MARK: - Try to cheat (task 2.13, sandbox demo)

    /// True while this phone's signed note is on screen (its card or its receipt). The cheat signs
    /// exactly that note again; the user never picks an allowance or a serial.
    public var canTryToCheat: Bool {
        (phase == .showNote || phase == .receipt) && payment != nil && signer != nil
    }

    /// Starts the control for the payment on screen (again, for another merchant, after a cheat note).
    public func startCheat() {
        guard canTryToCheat, cheatStep != .signing, let payment else { return }
        clearCheat()
        cheatOriginal = payment.note
        issue = nil
        cheatStep = .scanMerchant
    }

    /// Closes the control. The original payment is untouched.
    public func cancelCheat() {
        guard cheatStep != .off, cheatStep != .signing else { return }
        clearCheat()
        issue = nil
    }

    /// Scanned or pasted `L1|P|1|C|...` for merchant B, checked exactly like merchant selection:
    /// the pinned server key, the deployment binding and the allowance's earmarks. The merchant the
    /// original note already pays is refused by name (re-signing to the same payee is no double spend).
    public func acceptCheatMerchant(text: String) {
        guard cheatStep == .scanMerchant || cheatStep == .confirm, let original = cheatOriginal,
              let certificate = allowance?.certificate, let serverPublicKey else { return }
        switch ScanParser.parse(text, accepting: [.merchant]) {
        case .failure(let kind):
            report(kind)
        case .success(let decoded):
            do {
                let verified = try MerchantCertificate.verify(wire: decoded.payload, deployment: deployment,
                                                              serverPublicKey: serverPublicKey)
                guard verified.merchantKeyHash != original.note.payeeKeyHash else { return report(.cheatSameMerchant) }
                guard certificate.allows(merchantKeyHash: verified.merchantKeyHash) else {
                    return report(.payment(.notEarmarked))
                }
                cheatMerchant = verified
                issue = nil
                cheatStep = .confirm
            } catch {
                report(Self.kind(of: error))
            }
        }
    }

    /// Signs the cheat note: the original note with merchant B as payee and every other field
    /// unchanged (allowance id, serial, amount, currency, expiry), through the same signer as a
    /// payment (Face ID or the passcode on a phone). It never reads or writes the serial store:
    /// this is the one deliberate reuse SerialReservations names.
    public func signCheat() async {
        guard cheatStep == .confirm, let original = cheatOriginal, payment?.note.noteId == original.noteId,
              let merchantB = cheatMerchant, let allowance, let signer else { return }
        let certificate = allowance.certificate
        guard original.note.allowanceId == certificate.allowanceId, original.payerKeyHash == certificate.payerKeyHash else {
            return report(.payment(.allowanceMismatch))
        }
        guard Int64(now().timeIntervalSince1970) <= original.note.expiry else { return report(.payment(.expired)) }
        let body: NoteV1 = {
            var copy = original.note
            copy.payeeKeyHash = merchantB.merchantKeyHash
            return copy
        }()
        let deployment = deployment
        cheatAttempt &+= 1
        let attempt = cheatAttempt
        issue = nil
        cheatStep = .signing
        // True only while this attempt is the control's current one. New payment, Change merchant
        // or a newer attempt supersedes it, and its late result (success or failure) is dropped,
        // so it can never touch a newer attempt's state.
        func isCurrent() -> Bool {
            cheatAttempt == attempt && cheatStep == .signing && cheatOriginal?.noteId == original.noteId
        }
        let signed: SignedNote
        do {
            // Off the main actor: the Secure Enclave blocks while Face ID or the passcode sheet is up.
            signed = try await Task.detached(priority: .userInitiated) { try SignedNote.sign(body, with: signer) }.value
            let checked = try SignedNote.validate(wire: signed.wire, deployment: deployment)
            guard checked.payerKeyHash == certificate.payerKeyHash else { throw PaymentError.payerMismatch }
        } catch {
            guard isCurrent() else { return }
            cheatStep = .confirm
            if let error = error as? PaymentError { return report(.payment(error)) }
            return report(.signing("no serial was reserved; \(error.localizedDescription)"))
        }
        guard isCurrent() else { return }
        cheat = CheatNote(original: original, merchant: merchantB,
                          payment: SignedPayment(note: signed,
                                                 allowanceText: PaymentTransport.encode(.allowance, allowance.wire),
                                                 noteText: PaymentTransport.encode(.note, signed.wire)))
        cheatCodeStep = .allowance
        cheatStep = .showNote
    }

    public func showCheatCode(_ step: CodeStep) {
        guard cheat != nil else { return }
        cheatCodeStep = step
    }

    /// The text behind the cheat code on screen.
    public var currentCheatCodeText: String? {
        guard let cheat else { return nil }
        return cheatCodeStep == .allowance ? cheat.payment.allowanceText : cheat.payment.noteText
    }

    private func clearCheat() {
        // Supersedes any signing attempt still waiting for the signer.
        cheatAttempt &+= 1
        cheatStep = .off
        cheatOriginal = nil
        cheatMerchant = nil
        cheat = nil
        cheatCodeStep = .allowance
    }

    // MARK: - Helpers

    private func resetPayment() {
        payment = nil
        receipt = nil
        amountText = ""
        issue = nil
        codeStep = .allowance
        clearCheat()
    }

    private func refreshNotesSigned() {
        guard let id = allowance?.certificate.allowanceId else { return }
        notesSigned = (try? serials.remaining(allowanceId: id)).map { 256 - $0 }
    }

    private func report(_ kind: MoneyIssueKind) {
        issue = MoneyIssue(kind, at: now())
    }

    /// A receipt or ack handed back that this phone refused. Its check failure is the receipt's,
    /// not the payment's, so the banner names the receipt check and claims nothing about the chain.
    private func reportReceipt(_ kind: MoneyIssueKind) {
        issue = MoneyIssue(kind, at: now(), refusedBy: kind.refusedBy == nil ? nil : .receiptCheck)
    }

    static func kind(of error: Error) -> MoneyIssueKind {
        if let payment = error as? PaymentError { return .payment(payment) }
        return .payment(.transport)
    }
}

#if DEBUG
extension PayModel {
    /// PREVIEW ONLY: places a model built from test vectors into one state for the Xcode canvas.
    static func preview(_ phase: Phase, merchant: MerchantCertificate? = nil, payment: SignedPayment? = nil,
                        receipt: VerifiedReceipt? = nil, issue: MoneyIssueKind? = nil, amountText: String = "",
                        codeStep: CodeStep = .allowance, serverKey: Data? = PreviewFixtures.serverKey,
                        cheatStep: CheatStep = .off, cheatMerchant: MerchantCertificate? = nil,
                        cheat: CheatNote? = nil) -> PayModel {
        let model = PayModel(allowanceWire: PreviewFixtures.allowanceWire, signer: PreviewFixtures.payerSigner,
                             serials: SerialReservations(url: PreviewFixtures.scratchURL("preview-serials.json")),
                             deployment: PreviewFixtures.deployment, serverPublicKey: serverKey,
                             now: { PreviewFixtures.now })
        guard model.phase != .unavailable else { return model }
        model.phase = phase
        model.merchant = merchant
        model.payment = payment
        model.receipt = receipt
        model.amountText = amountText
        model.codeStep = codeStep
        model.cheatStep = cheatStep
        model.cheatOriginal = cheatStep == .off ? nil : payment?.note
        model.cheatMerchant = cheatMerchant ?? cheat?.merchant
        model.cheat = cheat
        model.issue = issue.map { MoneyIssue($0, at: PreviewFixtures.now) }
        return model
    }
}
#endif
