import CryptoKit
import Foundation
import SwiftUI
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// Review round 1 on the payment screens (3.71). Each suite names the finding it covers.
@Suite("receipt timings never trap on signed clock values (review 1, finding 1)")
struct ReceiptTimingOverflowTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    /// A verified receipt whose ACK and CONF carry the given clock readings.
    func facts(receivedAt: Int64, blockTime: Int64 = 1_800_000_065, uploadedAt: Int64 = 1_800_000_060,
               status: UInt8 = 1) throws -> ReceiptFacts {
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let ack = try Ack.sign(note: note, receivedAt: receivedAt, with: merchant)
        let conf = F.confWire(noteId: note.noteId, status: status, blockTime: blockTime, uploadedAt: uploadedAt)
        let receipt = try Receipts.verify(Bundles.receipt(note: note, ack: ack, confirmationWire: conf),
                                          deployment: F.deployment, serverPublicKey: F.serverKey)
        return ReceiptFacts(receipt: receipt, merchant: nil, clusterId: 0)
    }

    @Test("an ACK received at Int64.min or Int64.max reads as the clocks disagree")
    func extremeReceivedAt() throws {
        for receivedAt in [Int64.min, Int64.min + 1, Int64.max] {
            let f = try facts(receivedAt: receivedAt)
            #expect(f.heldOffline == .clocksDisagree, "receivedAt \(receivedAt)")
            #expect(f.heldOfflineSeconds == nil)
            #expect(f.timingLines.contains("Held offline: the clocks disagree, so no figure is shown"))
            // The CONF's own clocks are sane, so that line still has its figure.
            #expect(f.settledAfterUploadSeconds == 5)
        }
    }

    @Test("a CONF whose block time and upload time are 64-bit extremes reads as the clocks disagree")
    func extremeConfClocks() throws {
        let cases: [(Int64, Int64)] = [(.max, -1), (.min, 1), (.max, .min), (.min, .max)]
        for (blockTime, uploadedAt) in cases {
            let f = try facts(receivedAt: 1_800_000_000, blockTime: blockTime, uploadedAt: uploadedAt)
            #expect(f.settledAfterUpload == .clocksDisagree, "blockTime \(blockTime) uploadedAt \(uploadedAt)")
            #expect(f.timingLines.contains("Settled after upload: the clocks disagree, so no figure is shown"))
        }
        // Upload at Int64.max and received at Int64.min: the held span overflows too.
        let both = try facts(receivedAt: .min, blockTime: .min, uploadedAt: .max)
        #expect(both.heldOffline == .clocksDisagree)
        #expect(both.settledAfterUpload == .clocksDisagree)
        #expect(both.timingLines.count == 2)
    }

    @Test("ordinary clocks still give figures; a negative span gives none")
    func ordinary() throws {
        let f = try facts(receivedAt: 1_800_000_000)
        #expect(f.heldOffline == .seconds(60))
        #expect(f.settledAfterUpload == .seconds(5))
        #expect(f.timingLines == [
            "Held offline 1:00 (server clock minus the merchant phone's clock)",
            "Settled 5 s after upload (chain time minus server clock)",
        ])
        #expect(try facts(receivedAt: 1_800_000_061).heldOffline == .clocksDisagree)
        #expect(ClockSpan.between(later: 10, earlier: 10) == .seconds(0))
        #expect(ClockSpan.between(later: .max, earlier: 0) == .seconds(.max))
        #expect(ClockSpan.between(later: 0, earlier: .min) == .clocksDisagree)
    }
}

@Suite("Receive shows one allowance and its own unsettled total (review 1, finding 2)")
@MainActor
struct ReceiveTwoPayersTests {
    let payerA = SoftwareP256Signer()
    let payerB = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()
    let merchantWire: Data
    let allowanceA: Data
    let allowanceB: Data

    init() {
        merchantWire = F.merchantWire(merchant: merchant.keyHash)
        allowanceA = F.allowanceWire(payer: payerA.keyHash, id: 77, offlineLimit: 3_000_000)
        allowanceB = F.allowanceWire(payer: payerB.keyHash, id: 88, offlineLimit: 2_000_000)
    }

    func makeModel(_ ledger: OfflineLedger) -> ReceiveModel {
        ReceiveModel(merchantWire: merchantWire, signer: merchant, ledger: ledger, settlementClient: nil,
                     deployment: F.deployment, serverPublicKey: F.serverKey, now: { F.now })
    }

    func text(_ kind: PaymentTransport.Kind, _ wire: Data) -> String { PaymentTransport.encode(kind, wire) }

    @Test("two payers in a row: Next payment drops the first allowance; each payer's numbers are their own")
    func twoPayersInARow() async throws {
        let model = makeModel(OfflineLedger(url: F.tempURL("ledger.json")))
        #expect(model.readyStep == .waitingForBoth(bluetooth: false))

        // Payer A pays 1.00 against allowance 77.
        await model.accept(text: text(.allowance, allowanceA))
        #expect(model.readyStep == .allowanceVerified(allowanceId: 77))
        let noteA = try F.note(payer: payerA, payee: merchant.keyHash, amount: 1_000_000, serial: 0, allowanceId: 77)
        await model.accept(text: text(.note, noteA.wire))
        #expect(model.phase == .received)
        let certA = try #require(model.payment?.certificate)
        #expect(model.unsettled(for: certA) == 1_000_000)

        // Payer B's allowance arrives during A's payment: kept, but A's card is untouched.
        await model.accept(text: text(.allowance, allowanceB))
        let certB = try #require(model.allowances[88])
        #expect(model.lastAllowance?.allowanceId == 77)
        #expect(model.unsettledAllowanceId == 77)
        #expect(model.limitState == .withinLimit)

        // Next payment: nothing from payer A is shown as the next payer's progress.
        model.nextPayment()
        #expect(model.lastAllowance == nil)
        #expect(model.unsettledTotal == nil)
        #expect(model.unsettledAllowanceId == nil)
        #expect(model.limitState == nil)
        #expect(model.readyStep == .waitingForBoth(bluetooth: false))

        // Payer B's note uses the kept certificate, and every figure is B's.
        let noteB = try F.note(payer: payerB, payee: merchant.keyHash, amount: 1_700_000, serial: 0, allowanceId: 88)
        await model.accept(text: text(.note, noteB.wire))
        #expect(model.phase == .received)
        #expect(model.payment?.certificate.allowanceId == 88)
        #expect(model.unsettled(for: certB) == 1_700_000)
        #expect(model.unsettled(for: certA) == nil)
        // 1.70 of B's 2.00 limit is past 80 percent; against A's 3.00 it would not be.
        #expect(model.limitState == .nearLimit)

        // Payer A comes back: their own total, still pending in the ledger.
        model.nextPayment()
        await model.accept(text: text(.allowance, allowanceA))
        #expect(model.readyStep == .allowanceVerified(allowanceId: 77))
        #expect(model.unsettled(for: certA) == 1_000_000)
        #expect(model.unsettled(for: certB) == nil)
        #expect(model.limitState == .withinLimit)
    }

    @Test("a note for an allowance not on the phone reads as waiting even with another allowance on screen")
    func waitingNoteBeforeLastAllowance() async throws {
        let model = makeModel(OfflineLedger(url: F.tempURL("ledger.json")))
        await model.accept(text: text(.allowance, allowanceA))
        #expect(model.readyStep == .allowanceVerified(allowanceId: 77))
        let noteB = try F.note(payer: payerB, payee: merchant.keyHash, amount: 500_000, serial: 2, allowanceId: 88)
        await model.accept(text: text(.note, noteB.wire))
        #expect(model.issue?.kind == .allowanceNeeded)
        #expect(model.readyStep == .noteWaitingForAllowance)
        #expect(model.readyStep.text == "Payment note checked. Waiting for its allowance (code 1 of 2).")
        await model.accept(text: text(.allowance, allowanceB))
        #expect(model.phase == .received)
        #expect(model.payment?.note == noteB)
        #expect(model.unsettledAllowanceId == 88)
    }

    @Test("a refused note leaves the card on the allowance it was checked against")
    func refusedNoteShowsItsAllowance() async throws {
        let model = makeModel(OfflineLedger(url: F.tempURL("ledger.json")))
        await model.accept(text: text(.allowance, allowanceA))
        await model.accept(text: text(.allowance, allowanceB))
        #expect(model.lastAllowance?.allowanceId == 88)
        // A note for allowance 77 over its 3.00 offline limit: refused, and the card shows 77.
        let big = try F.note(payer: payerA, payee: merchant.keyHash, amount: 3_500_000, serial: 0, allowanceId: 77)
        await model.accept(text: text(.note, big.wire))
        #expect(model.issue?.kind == .payment(.offlineLimit))
        #expect(model.lastAllowance?.allowanceId == 77)
        #expect(model.unsettledAllowanceId == 77)
        #expect(model.unsettledTotal == 0)
    }
}

@Suite("an unreadable ledger never reads as $0.00 unsettled (review 1, finding 5)")
@MainActor
struct UnreadableLedgerTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    /// A ledger whose file exists and is not a ledger (OfflineLedger then throws `storage`).
    static func corruptLedger() throws -> OfflineLedger {
        let url = F.tempURL("ledger.json")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not a ledger".utf8).write(to: url)
        return OfflineLedger(url: url)
    }

    @Test("the risk line names the unreadable ledger instead of a zero total")
    func riskLineWithoutTotal() {
        let line = LimitState.riskLine(unsettled: nil, offlineLimit: 3_000_000, allowanceId: 77)
        #expect(line == "Unsettled total unavailable (the ledger could not be read). Allowance #77, offline limit $3.00. Sandbox.")
        #expect(!line.contains("$0.00"))
        #expect(LimitState.riskLine(unsettled: 0, offlineLimit: 3_000_000, allowanceId: 77).contains("carries $0.00 unsettled"))
    }

    @Test("with an unreadable ledger the model has no total and no limit chip for the allowance on screen")
    func modelWithoutTotal() async throws {
        let ledger = try Self.corruptLedger()
        #expect(throws: PaymentError.storage) { try ledger.unsettledTotal(allowanceId: F.allowanceId) }
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant, ledger: ledger,
                                 settlementClient: nil, deployment: F.deployment, serverPublicKey: F.serverKey,
                                 now: { F.now })
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        let certificate = try #require(model.lastAllowance)
        #expect(model.unsettledAllowanceId == F.allowanceId)
        #expect(model.unsettled(for: certificate) == nil)
        #expect(model.limitState == nil)
        // And no note can be accepted against a ledger that cannot be read.
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        await model.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(model.issue?.kind == .payment(.storage))
        #expect(model.phase == .ready)
    }
}

@Suite("Bluetooth codes reach Receive through the mesh inbox (review 1, finding 3)")
@MainActor
struct MeshInboxTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()
    let merchantWire: Data

    init() { merchantWire = F.merchantWire(merchant: merchant.keyHash) }

    func makeModel(inbox: PaymentInbox?, ledger: OfflineLedger = OfflineLedger(url: F.tempURL("ledger.json"))) -> ReceiveModel {
        ReceiveModel(merchantWire: merchantWire, signer: merchant, ledger: ledger, settlementClient: nil,
                     deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox, now: { F.now })
    }

    var allowanceText: String { PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)) }

    func noteText(serial: UInt8 = 0) throws -> (SignedNote, String) {
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: serial)
        return (note, PaymentTransport.encode(.note, note.wire))
    }

    @Test("with an inbox the card says camera or Bluetooth, and inbox texts are checked like scans")
    func inboxCarriesAPayment() async throws {
        let inbox = PaymentInbox()
        let model = makeModel(inbox: inbox)
        #expect(model.receivesOverBluetooth)
        #expect(model.readyStep == .waitingForBoth(bluetooth: true))
        #expect(model.readyStep.text.hasSuffix("by camera or Bluetooth."))

        // The note lands before the screen is shown: it is held, not accepted unseen.
        let (note, text) = try noteText()
        inbox.deliver(text)
        #expect(inbox.held == [text])
        #expect(model.phase == .ready)
        #expect(model.waitingNote == nil)

        model.startInbox()
        #expect(inbox.isAttached)
        #expect(inbox.held.isEmpty)
        inbox.deliver(allowanceText)
        await model.inboxDrained()
        #expect(model.phase == .received)
        #expect(model.payment?.note == note)
        let ack = try #require(model.payment?.ack)
        #expect(try Ack.verify(wire: ack.wire, for: note).noteId == note.noteId)

        // Text that is not a payment code is refused by name, as from the camera.
        model.nextPayment()
        inbox.deliver("hello over Bluetooth")
        await model.inboxDrained()
        #expect(model.issue?.kind == .notPaymentCode)
    }

    @Test("without an inbox Receive is camera only and never mentions Bluetooth")
    func noInbox() {
        let model = makeModel(inbox: nil)
        #expect(!model.receivesOverBluetooth)
        #expect(model.readyStep == .waitingForBoth(bluetooth: false))
        #expect(model.readyStep.text.hasSuffix("by camera."))
        #expect(!model.readyStep.text.contains("Bluetooth"))
        model.startInbox()
        model.stopInbox()
    }

    @Test("a stopped screen holds texts again; a rebuilt model takes over and the old one cannot detach it")
    func attachAndDetach() async throws {
        let inbox = PaymentInbox()
        let allowance = allowanceText
        let old = makeModel(inbox: inbox)
        old.startInbox()
        old.stopInbox()
        #expect(!inbox.isAttached)
        inbox.deliver(allowance)
        #expect(inbox.held == [allowance])

        // The old screen shows again and takes the held allowance.
        old.startInbox()
        await old.inboxDrained()
        #expect(old.lastAllowance?.allowanceId == F.allowanceId)

        // A rebuilt screen appears, then the old one's late onDisappear must not detach it.
        let fresh = makeModel(inbox: inbox)
        fresh.startInbox()
        old.stopInbox()
        #expect(inbox.isAttached)
        let (note, text) = try noteText()
        inbox.deliver(allowance)
        inbox.deliver(text)
        await fresh.inboxDrained()
        #expect(fresh.payment?.note == note)
        #expect(old.payment == nil)
        #expect(old.waitingNote == nil)
    }

    @Test("a model that is gone hands texts back to the inbox instead of dropping them")
    func goneModel() throws {
        let inbox = PaymentInbox()
        do {
            let model = makeModel(inbox: inbox)
            model.startInbox()
        }
        let allowance = allowanceText
        inbox.deliver(allowance)
        #expect(!inbox.isAttached)
        #expect(inbox.held == [allowance])
    }

    @Test("held texts are bounded and every drop is counted")
    func bounded() {
        let inbox = PaymentInbox()
        for i in 0...PaymentInbox.capacity { inbox.deliver("text \(i)") }
        #expect(inbox.held.count == PaymentInbox.capacity)
        #expect(inbox.held.first == "text 1")
        #expect(inbox.droppedWhileDetached == 1)
    }
}

@Suite("Pay and Receive copy says what the protocol means (review 1, finding 4)")
@MainActor
struct ScreenCopyTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    @Test("the offline limit is described as unsettled value per merchant, not a per-payment limit")
    func offlineLimitHint() throws {
        let certificate = try AllowanceCertificate.verify(wire: F.allowanceWire(payer: payer.keyHash), deployment: F.deployment,
                                                          serverPublicKey: F.serverKey)
        let hint = PayModel.offlineLimitHint(certificate)
        #expect(hint == "Up to $3.00 sandbox unsettled with any one merchant (offline limit).")
        #expect(!hint.contains("per payment"))
    }

    @Test("signing text names Face ID only for the Secure Enclave key")
    func signingText() {
        #expect(PayModel.signingTitle(secureEnclave: true) == "Waiting for Face ID or the passcode")
        #expect(PayModel.signingTitle(secureEnclave: false) == "Signing with this phone's software key (no Face ID)")
        #expect(ReceiveModel.ackSigningText(secureEnclave: true) == "Signing the receipt (Face ID or passcode)")
        #expect(!ReceiveModel.ackSigningText(secureEnclave: false).contains("Face ID"))
        let pay = PayModel(allowanceWire: F.allowanceWire(payer: payer.keyHash), signer: payer,
                           serials: SerialReservations(url: F.tempURL("serials.json")), deployment: F.deployment,
                           serverPublicKey: F.serverKey)
        #expect(!pay.signerIsSecureEnclave)
        let receive = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                   ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                                   deployment: F.deployment, serverPublicKey: F.serverKey)
        #expect(!receive.signerIsSecureEnclave)
    }

    /// A Receive model holding one accepted, acknowledged note, whose ledger file is then damaged
    /// so the post-settlement write fails.
    func settledWithBrokenLedger(confStatus: UInt8) async throws -> ReceiveModel {
        let url = F.tempURL("ledger.json")
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let conf = F.confWire(noteId: note.noteId, status: confStatus, errorCode: confStatus == 2 ? 6001 : 0)
        let stub = StubTransport([StubReply(status: 200, body: F.decisionBody(conf: conf, noteId: note.noteId,
                                                                               jsonStatus: "settled"))])
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: OfflineLedger(url: url), settlementClient: APIFixtures.client(stub, retry: .never),
                                 deployment: F.deployment, serverPublicKey: F.serverKey, now: { F.now })
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        await model.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(model.payment?.ack != nil)
        try Data("damaged".utf8).write(to: url)
        await model.settle()
        return model
    }

    @Test("a ledger write that fails after a Paid CONF says paid on chain, not 'nothing was accepted'")
    func ledgerFailsAfterPaid() async throws {
        let model = try await settledWithBrokenLedger(confStatus: 1)
        #expect(model.phase == .settled)
        #expect(model.settlement?.status == .paid)
        #expect(model.issue?.kind == .ledgerNotUpdated(paid: true))
        #expect(model.issue?.name == "ledger_not_updated")
        let message = try #require(model.issue?.message)
        #expect(message.hasPrefix("Paid on chain, but this phone could not record it"))
        #expect(message != MoneyIssueKind.payment(.storage).message)
    }

    @Test("a ledger write that fails after a Failed CONF says failed on chain")
    func ledgerFailsAfterFailed() async throws {
        let model = try await settledWithBrokenLedger(confStatus: 2)
        #expect(model.settlement?.status == .failed)
        #expect(model.issue?.kind == .ledgerNotUpdated(paid: false))
        #expect(model.issue?.message.hasPrefix("Failed on chain, but this phone could not record it") == true)
    }
}

@Suite("amounts typed with a comma decimal separator (review 1, finding 7)")
@MainActor
struct DecimalSeparatorTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    func makeModel(_ locale: String) -> PayModel {
        let model = PayModel(allowanceWire: F.allowanceWire(payer: payer.keyHash), signer: payer,
                             serials: SerialReservations(url: F.tempURL("serials.json")), deployment: F.deployment,
                             serverPublicKey: F.serverKey, locale: Locale(identifier: locale), now: { F.now })
        model.acceptMerchant(text: PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchant.keyHash)))
        return model
    }

    func check(_ model: PayModel, _ text: String) -> Result<UInt64, MoneyIssueKind> {
        model.amountText = text
        return model.amountCheck
    }

    @Test("a comma locale reads 1,25 as 1.25; limits still apply; mixed grouping is refused")
    func commaLocales() async throws {
        for locale in ["de_DE", "fr_FR"] {
            let model = makeModel(locale)
            #expect(check(model, "1,25") == .success(1_250_000), "\(locale)")
            #expect(check(model, "0,5") == .success(500_000))
            #expect(check(model, " $2,75 ") == .success(2_750_000))
            #expect(check(model, "1.25") == .success(1_250_000))
            #expect(check(model, "3,000001") == .failure(.payment(.offlineLimit)))
            #expect(check(model, "1.000,50") == .failure(.amountUnreadable))
            #expect(check(model, "1,2,3") == .failure(.amountUnreadable))
        }
        let model = makeModel("de_DE")
        model.amountText = "1,25"
        await model.pay()
        #expect(model.phase == .showNote)
        #expect(model.payment?.note.note.amount == 1_250_000)
    }

    @Test("a dot locale keeps a comma as a thousands separator, so 1,25 and 1,000 stay unreadable")
    func dotLocale() {
        let model = makeModel("en_US")
        #expect(check(model, "1,25") == .failure(.amountUnreadable))
        #expect(check(model, "1,000") == .failure(.amountUnreadable))
        #expect(check(model, "1.25") == .success(1_250_000))
    }

    @Test("any separator the locale names becomes a dot; a dot or empty separator changes nothing")
    func normalize() {
        #expect(PayModel.normalizedAmount("1,5", decimalSeparator: ",") == "1.5")
        #expect(PayModel.normalizedAmount("1\u{066B}5", decimalSeparator: "\u{066B}") == "1.5")
        #expect(PayModel.normalizedAmount("1,5", decimalSeparator: ".") == "1,5")
        #expect(PayModel.normalizedAmount("1,5", decimalSeparator: "") == "1,5")
    }
}

@Suite("disabled buttons, step banners and VoiceOver announcements (review 1, finding 6)")
@MainActor
struct ScreenFeedbackTests {
    /// The rendered RGBA bytes of a view at a fixed size, for comparing two looks.
    func pixels(_ view: some View) throws -> Data {
        let renderer = ImageRenderer(content: view.frame(width: 240, height: 70).background(Color.white))
        renderer.scale = 1
        let image = try #require(renderer.cgImage)
        let data = try #require(image.dataProvider?.data)
        return data as Data
    }

    func button(enabled: Bool) -> some View {
        Button("Sign and pay") {}.buttonStyle(LokaButtonStyle()).disabled(!enabled)
    }

    @Test("a disabled primary button renders differently from an enabled one")
    func disabledButtonLooksDisabled() throws {
        let enabled = try pixels(button(enabled: true))
        #expect(try pixels(button(enabled: true)) == enabled, "rendering is deterministic")
        #expect(try pixels(button(enabled: false)) != enabled)
        #expect(LokaButtonStyle.disabledOpacity < 1)
    }

    @Test("normal steps are neutral; failures stay Stopped")
    func steps() {
        let pending = PendingSettlement(noteId: Data(repeating: 1, count: 32), signature: nil, explorer: nil, retryAfter: 2)
        let steps: [MoneyIssueKind] = [.allowanceNeeded, .alreadyReceived, .busy, .settlement(.stillPending(pending))]
        let stops: [MoneyIssueKind] = [
            .payment(.payeeMismatch), .payment(.serialSeen), .payment(.storage), .serverNotConnected, .notPaymentCode,
            .signing("x"), .ledgerNotUpdated(paid: true), .settlement(.http(status: 503, error: nil, message: nil)),
        ]
        for kind in steps { #expect(kind.isStep, "\(kind.name)") }
        for kind in stops { #expect(!kind.isStep, "\(kind.name)") }
    }

    @Test("banner titles and VoiceOver announcements use plain words")
    func titlesAndAnnouncements() {
        let step = MoneyIssue(.allowanceNeeded, at: F.now)
        #expect(IssueBanner.title(for: step) == "Next step")
        #expect(IssueBanner.announcement(for: step) == "Next step. " + MoneyIssueKind.allowanceNeeded.message)
        let stop = MoneyIssue(.payment(.payeeMismatch), at: F.now)
        #expect(IssueBanner.title(for: stop) == "Stopped: payee_mismatch")
        #expect(IssueBanner.announcement(for: stop) == "Stopped. This payment is addressed to a different merchant.")
        #expect(!IssueBanner.announcement(for: stop).contains("_"))
    }
}
