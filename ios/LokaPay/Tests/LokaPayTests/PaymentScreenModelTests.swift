import CryptoKit
import Foundation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

@Suite("Pay screen model (3.71)")
@MainActor
struct PayModelTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    func makeModel(signer: (any PaymentSigner)? = nil, serials: SerialReservations? = nil,
                   allowance: Data? = nil, serverKey: Data? = F.serverKey) -> (PayModel, SerialReservations) {
        let store = serials ?? SerialReservations(url: F.tempURL("serials.json"))
        // A fixed "." locale, so "1,000" means one thousand (unreadable) on any test machine.
        let model = PayModel(allowanceWire: allowance ?? F.allowanceWire(payer: payer.keyHash), signer: signer ?? payer,
                             serials: store, deployment: F.deployment, serverPublicKey: serverKey,
                             locale: Locale(identifier: "en_US_POSIX"), now: { F.now })
        return (model, store)
    }

    var merchantText: String { PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchant.keyHash)) }

    @Test("refuses zero, over the offline limit, over the cap and unreadable amounts, reserving nothing")
    func refusesBadAmounts() async throws {
        let (model, serials) = makeModel()
        model.acceptMerchant(text: merchantText)
        #expect(model.phase == .enterAmount)
        let cases: [(String, MoneyIssueKind)] = [
            ("0", .payment(.amountZero)), ("0.00", .payment(.amountZero)),
            ("3.000001", .payment(.offlineLimit)), ("5.01", .overCap),
            ("abc", .amountUnreadable), ("1,000", .amountUnreadable), ("", .amountUnreadable),
        ]
        for (text, kind) in cases {
            model.amountText = text
            await model.pay()
            #expect(model.issue?.kind == kind, "amount \(text)")
            #expect(model.phase == .enterAmount)
            #expect(model.payment == nil)
        }
        #expect(try serials.remaining(allowanceId: F.allowanceId) == 256)
        model.amountText = " $3.00 "
        #expect(model.amountCheck == .success(3_000_000))
    }

    @Test("refuses a merchant certificate the pinned server key did not sign, and other code kinds")
    func refusesUnverifiedMerchant() throws {
        let (model, _) = makeModel()
        let rogue = Curve25519.Signing.PrivateKey()
        model.acceptMerchant(text: PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchant.keyHash, signedBy: rogue)))
        #expect(model.issue?.kind == .payment(.badSignature))
        #expect(model.merchant == nil)
        #expect(model.phase == .scanMerchant)
        model.acceptMerchant(text: PaymentTransport.encode(.note, Data(repeating: 1, count: 238)))
        #expect(model.issue?.kind == .wrongKind(expected: [.merchant], got: .note))
        model.acceptMerchant(text: "hello")
        #expect(model.issue?.kind == .notPaymentCode)
        #expect(model.phase == .scanMerchant)
    }

    @Test("refuses a merchant the allowance is not earmarked for")
    func refusesUnearmarkedMerchant() {
        let other = SoftwareP256Signer()
        let (model, _) = makeModel(allowance: F.allowanceWire(payer: payer.keyHash, earmarks: [other.keyHash]))
        model.acceptMerchant(text: merchantText)
        #expect(model.issue?.kind == .payment(.notEarmarked))
        #expect(model.merchant == nil)
    }

    @Test("pay reserves the serial durably before signing, and the note passes section 6")
    func paysReservingFirst() async throws {
        let url = F.tempURL("serials.json")
        let serials = SerialReservations(url: url)
        let recorder = RecordingSigner(inner: payer, serials: serials, allowanceId: F.allowanceId)
        // Built once: CryptoKit's Ed25519 signatures are randomized, so a rebuilt wire differs.
        let allowanceWire = F.allowanceWire(payer: payer.keyHash)
        let (model, _) = makeModel(signer: recorder, serials: serials, allowance: allowanceWire)
        model.acceptMerchant(text: merchantText)
        model.amountText = "1.25"
        await model.pay()
        #expect(model.phase == .showNote)
        #expect(model.issue == nil)
        let payment = try #require(model.payment)
        let checked = try SignedNote.validate(wire: payment.note.wire, deployment: F.deployment)
        #expect(checked.note.amount == 1_250_000)
        #expect(checked.note.payeeKeyHash == merchant.keyHash)
        #expect(checked.note.allowanceId == F.allowanceId)
        #expect(checked.note.serial == 0)
        #expect(checked.note.expiry == F.expiry)
        #expect(checked.payerKeyHash == payer.keyHash)
        // When the signer ran, serial 0 was already written to disk: 255 left.
        #expect(recorder.remainingAtSign == [255])
        #expect(try SerialReservations(url: url).remaining(allowanceId: F.allowanceId) == 255)
        #expect(model.notesSigned == 1)

        // Both handover texts decode to the exact wires, allowance first.
        let a = try #require(try PaymentTransport.decode(payment.allowanceText))
        #expect(a.kind == .allowance)
        #expect(a.payload == allowanceWire)
        let n = try #require(try PaymentTransport.decode(payment.noteText))
        #expect(n.kind == .note)
        #expect(n.payload == payment.note.wire)
        #expect(payment.transportTexts == [payment.allowanceText, payment.noteText])
        #expect(model.currentCodeText == payment.allowanceText)
        model.showCode(.note)
        #expect(model.currentCodeText == payment.noteText)

        model.newPayment()
        model.amountText = "0.50"
        await model.pay()
        #expect(model.payment?.note.note.serial == 1)
        #expect(recorder.remainingAtSign == [255, 254])
    }

    @Test("a cancelled Face ID signs nothing, shows the error state and never reuses the serial")
    func signerCancelled() async throws {
        let serials = SerialReservations(url: F.tempURL("serials.json"))
        let (model, _) = makeModel(signer: CancelledSigner(inner: payer), serials: serials)
        model.acceptMerchant(text: merchantText)
        model.amountText = "1"
        await model.pay()
        #expect(model.phase == .enterAmount)
        #expect(model.payment == nil)
        #expect(model.issue?.name == "signing")
        #expect(model.issue?.message.contains("Nothing was sent") == true)
        #expect(try serials.remaining(allowanceId: F.allowanceId) == 255)
    }

    @Test("Pay is unavailable without a pinned key, an allowance, or with someone else's allowance")
    func unavailable() {
        let rogue = Curve25519.Signing.PrivateKey()
        let other = SoftwareP256Signer()
        let cases: [(PayModel, MoneyIssueKind)] = [
            (makeModel(serverKey: nil).0, .serverKeyMissing),
            (PayModel(allowanceWire: nil, signer: payer, serials: SerialReservations(url: F.tempURL("s.json")),
                      deployment: F.deployment, serverPublicKey: F.serverKey), .noAllowance),
            (makeModel(allowance: F.allowanceWire(payer: other.keyHash)).0, .keyMismatch),
            (makeModel(allowance: F.allowanceWire(payer: payer.keyHash, signedBy: rogue)).0, .payment(.badSignature)),
        ]
        for (model, kind) in cases {
            #expect(model.phase == .unavailable)
            #expect(model.issue?.kind == kind)
        }
    }

    @Test("the merchant's ack and settled receipt become verified receipts; strangers' are refused")
    func receiptsBack() async throws {
        let (model, _) = makeModel()
        model.acceptMerchant(text: merchantText)
        model.amountText = "2"
        await model.pay()
        let note = try #require(model.payment?.note)

        // An ack from a key that is not the payee is refused by name.
        let stranger = SoftwareP256Signer()
        let fakeBody = Ack.encode(noteId: note.noteId, receivedAt: 5)
        let fake = fakeBody + (try stranger.sign(fakeBody)) + stranger.compressedPublicKey
        model.acceptReturn(text: PaymentTransport.encode(.ack, fake))
        #expect(model.issue?.kind == .payment(.payeeMismatch))
        #expect(model.phase == .showNote)

        let ack = try Ack.sign(note: note, receivedAt: 1_800_000_010, with: merchant)
        model.acceptReturn(text: PaymentTransport.encode(.ack, ack.wire))
        #expect(model.phase == .receipt)
        let pending = try #require(model.receipt)
        #expect(MoneyStatus(receipt: pending) == .received)

        let conf = F.confWire(noteId: note.noteId, status: 1)
        let settled = Bundles.receipt(note: note, ack: ack, confirmationWire: conf)
        model.acceptReturn(text: PaymentTransport.encode(.receipt, settled))
        let paid = try #require(model.receipt)
        #expect(MoneyStatus(receipt: paid) == .paid)

        // A bare ack afterwards does not downgrade the settled receipt.
        model.acceptReturn(text: PaymentTransport.encode(.ack, ack.wire))
        let still = try #require(model.receipt)
        #expect(MoneyStatus(receipt: still) == .paid)

        // A valid receipt for a different note is refused.
        let otherNote = try F.note(payer: payer, payee: merchant.keyHash, amount: 1, serial: 9)
        let otherAck = try Ack.sign(note: otherNote, receivedAt: 1, with: merchant)
        model.acceptReturn(text: PaymentTransport.encode(.receipt, Bundles.receipt(note: otherNote, ack: otherAck,
                                                                                    confirmationWire: nil)))
        #expect(model.issue?.kind == .receiptMismatch)
        #expect(model.receipt?.note.noteId == note.noteId)
    }
}

@Suite("Receive screen model (3.71, 3.27)")
@MainActor
struct ReceiveModelTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()
    /// Built once: CryptoKit's Ed25519 signatures are randomized, so a rebuilt wire differs.
    let merchantWire: Data

    init() { merchantWire = ScreenFixtures.merchantWire(merchant: merchant.keyHash) }

    func makeModel(ledger: OfflineLedger) -> ReceiveModel {
        ReceiveModel(merchantWire: merchantWire, signer: merchant, ledger: ledger,
                     settlementClient: nil, deployment: F.deployment, serverPublicKey: F.serverKey,
                     internetState: { InternetState.none }, now: { F.now })
    }

    var allowanceText: String { PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)) }

    func noteText(_ note: SignedNote) -> String { PaymentTransport.encode(.note, note.wire) }

    @Test("a valid allowance and note show Received, reserve the note, and the signed ACK verifies")
    func acceptsValidPair() async throws {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let model = makeModel(ledger: ledger)
        #expect(model.phase == .ready)
        let merchantText = try #require(model.merchantText)
        let shown = try #require(try PaymentTransport.decode(merchantText))
        #expect(shown.kind == .merchant)
        #expect(shown.payload == merchantWire)

        await model.accept(text: allowanceText)
        #expect(model.lastAllowance?.allowanceId == F.allowanceId)
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        await model.accept(text: noteText(note))
        #expect(model.phase == .received)
        #expect(model.issue == nil)
        let payment = try #require(model.payment)
        #expect(payment.receivedWithZeroBars)
        let ack = try #require(payment.ack)
        let verified = try Ack.verify(wire: ack.wire, for: note)
        #expect(verified.receivedAt == Int64(F.now.timeIntervalSince1970))
        let ackText = try #require(payment.ackText)
        let decoded = try #require(try PaymentTransport.decode(ackText))
        #expect(decoded.kind == .ack)
        #expect(decoded.payload == ack.wire)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 1_000_000)
        #expect(model.unsettledTotal == 1_000_000)
        #expect(model.limitState == .withinLimit)

        // The same note scanned again is not a second payment.
        await model.accept(text: noteText(note))
        #expect(model.issue == nil)
        #expect(try ledger.entries().count == 1)

        // A second payer's codes during this payment: the allowance is kept, the note refused by
        // name, and the screen keeps this payment's numbers.
        let other = SoftwareP256Signer()
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: other.keyHash, id: 88)))
        #expect(model.allowances[88] != nil)
        #expect(model.unsettledTotal == 1_000_000)
        #expect(model.issue == nil)
        await model.accept(text: noteText(try F.note(payer: other, payee: merchant.keyHash, amount: 1, serial: 0,
                                                     allowanceId: 88)))
        #expect(model.issue?.kind == .busy)
        #expect(model.payment?.note == note)

        // After Next payment, the identical note again is not a reuse: it is still unsettled, so it
        // comes back on screen to settle with its signed ACK, and is not reserved a second time.
        model.nextPayment()
        await model.accept(text: noteText(note))
        #expect(model.phase == .received)
        #expect(model.issue == nil)
        #expect(model.payment?.ack == ack)
        #expect(model.conflictingSpend == false)
        #expect(try ledger.entries().count == 1)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 1_000_000)
    }

    @Test("a note that arrives before its allowance waits, then is accepted")
    func noteFirst() async throws {
        let model = makeModel(ledger: OfflineLedger(url: F.tempURL("ledger.json")))
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 500_000, serial: 3)
        await model.accept(text: noteText(note))
        #expect(model.issue?.kind == .allowanceNeeded)
        #expect(model.waitingNote == note)
        #expect(model.phase == .ready)
        await model.accept(text: allowanceText)
        #expect(model.phase == .received)
        #expect(model.payment?.note == note)
        #expect(model.waitingNote == nil)
    }

    @Test("a tampered signature is refused as bad_signature and nothing is reserved")
    func badSignature() async throws {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let model = makeModel(ledger: ledger)
        await model.accept(text: allowanceText)
        var wire = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0).wire
        wire[141 + 10] ^= 0x01  // a byte of r
        await model.accept(text: PaymentTransport.encode(.note, wire))
        #expect(model.issue?.kind == .payment(.badSignature))
        #expect(model.phase == .ready)
        #expect(try ledger.entries().isEmpty)
    }

    @Test("a note for another merchant is refused as payee_mismatch")
    func wrongPayee() async throws {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let model = makeModel(ledger: ledger)
        await model.accept(text: allowanceText)
        let note = try F.note(payer: payer, payee: SoftwareP256Signer().keyHash, amount: 1_000_000, serial: 0)
        await model.accept(text: noteText(note))
        #expect(model.issue?.kind == .payment(.payeeMismatch))
        #expect(model.phase == .ready)
        #expect(try ledger.entries().isEmpty)
    }

    @Test("a reused serial is refused as serial_seen and shows Conflicting spend seen")
    func reusedSerial() async throws {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let model = makeModel(ledger: ledger)
        await model.accept(text: allowanceText)
        await model.accept(text: noteText(try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 4)))
        #expect(model.phase == .received)
        model.nextPayment()
        await model.accept(text: noteText(try F.note(payer: payer, payee: merchant.keyHash, amount: 500_000, serial: 4)))
        #expect(model.issue?.kind == .payment(.serialSeen))
        #expect(model.conflictingSpend)
        #expect(model.limitState == .conflictingSpend)
        #expect(model.phase == .ready)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 1_000_000)
    }

    @Test("a note past the offline limit is refused as offline_limit")
    func overOfflineLimit() async throws {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let model = makeModel(ledger: ledger)
        await model.accept(text: allowanceText)
        await model.accept(text: noteText(try F.note(payer: payer, payee: merchant.keyHash, amount: 2_500_000, serial: 0)))
        #expect(model.phase == .received)
        #expect(model.limitState == .nearLimit)
        model.nextPayment()
        await model.accept(text: noteText(try F.note(payer: payer, payee: merchant.keyHash, amount: 600_000, serial: 1)))
        #expect(model.issue?.kind == .payment(.offlineLimit))
        #expect(model.conflictingSpend == false)
        #expect(model.phase == .ready)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 2_500_000)
    }

    @Test("an allowance the pinned key did not sign is refused, so its note cannot be accepted")
    func rogueAllowance() async throws {
        let model = makeModel(ledger: OfflineLedger(url: F.tempURL("ledger.json")))
        let rogue = Curve25519.Signing.PrivateKey()
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash, signedBy: rogue)))
        #expect(model.issue?.kind == .payment(.badSignature))
        #expect(model.lastAllowance == nil)
        await model.accept(text: noteText(try F.note(payer: payer, payee: merchant.keyHash, amount: 1, serial: 0)))
        #expect(model.issue?.kind == .allowanceNeeded)
        #expect(model.phase == .ready)
    }

    @Test("Receive is unavailable without a pinned key or with another merchant's certificate")
    func unavailable() {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let noKey = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant, ledger: ledger,
                                 settlementClient: nil, deployment: F.deployment, serverPublicKey: nil)
        #expect(noKey.phase == .unavailable)
        #expect(noKey.issue?.kind == .serverKeyMissing)
        let other = ReceiveModel(merchantWire: F.merchantWire(merchant: SoftwareP256Signer().keyHash), signer: merchant,
                                 ledger: ledger, settlementClient: nil, deployment: F.deployment, serverPublicKey: F.serverKey)
        #expect(other.issue?.kind == .keyMismatch)
        #expect(other.phase == .unavailable)
    }
}

@Suite("Settle from the Receive screen (3.71)")
@MainActor
struct SettleScreenTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    /// A Receive model holding one accepted, acknowledged note.
    func received(_ replies: [StubReply]?) async throws -> (ReceiveModel, SignedNote, OfflineLedger, StubTransport?) {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let stub = replies.map { StubTransport($0) }
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: ledger, settlementClient: stub.map { APIFixtures.client($0, retry: .never) },
                                 deployment: F.deployment, serverPublicKey: F.serverKey, now: { F.now })
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        await model.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(model.payment?.ack != nil)
        return (model, note, ledger, stub)
    }

    @Test("a verified settled CONF shows Paid even when the JSON says failed")
    func paidFromConf() async throws {
        let ledgerNote = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let conf = F.confWire(noteId: ledgerNote.noteId, status: 1)
        let body = F.decisionBody(conf: conf, noteId: ledgerNote.noteId, jsonStatus: "failed", error: "SerialUsed")
        let (model, note, ledger, stub) = try await received([StubReply(status: 200, body: body)])
        #expect(note.noteId == ledgerNote.noteId)
        await model.settle()
        #expect(model.phase == .settled)
        let settlement = try #require(model.settlement)
        #expect(settlement.status == .paid)
        #expect(settlement.receipt.confirmation?.status == .settled)
        #expect(try ledger.entries().first?.state == .settled)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 0)
        let x = try #require(try PaymentTransport.decode(settlement.receiptText))
        #expect(x.kind == .receipt)
        #expect(try Receipts.verify(x.payload, deployment: F.deployment, serverPublicKey: F.serverKey).status == .settled)
        let request = try #require(stub?.requests.first)
        #expect(request.url?.path == "/v1/notes")
    }

    @Test("a verified failed CONF shows Failed even when the JSON says settled")
    func failedFromConf() async throws {
        let n = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let conf = F.confWire(noteId: n.noteId, status: 2, errorCode: 6001)
        let (model, _, ledger, _) = try await received([StubReply(status: 200,
                                                                 body: F.decisionBody(conf: conf, noteId: n.noteId, jsonStatus: "settled"))])
        await model.settle()
        let settlement = try #require(model.settlement)
        #expect(settlement.status == .failed)
        #expect(ReceiptFacts(receipt: settlement.receipt, merchant: nil, clusterId: 0).errorCode == 6001)
        #expect(try ledger.entries().first?.state == .refused)
    }

    @Test("a 422 is shown as a refusal and the note stays pending in the ledger")
    func refusal() async throws {
        let body = APIFixtures.json(["error": "bad_signature", "message": "signature does not verify"])
        let (model, _, ledger, _) = try await received([StubReply(status: 422, body: body)])
        await model.settle()
        #expect(model.phase == .received)
        #expect(model.issue?.kind == .settlement(.refused(check: "bad_signature", message: "signature does not verify")))
        #expect(model.issue?.message.contains("refused this upload before it reached the chain") == true)
        #expect(model.settlement == nil)
        #expect(try ledger.entries().first?.state == .pending)
    }

    @Test("a CONF signed by another key is not trusted")
    func rogueConf() async throws {
        let n = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let conf = F.confWire(noteId: n.noteId, status: 1, signedBy: Curve25519.Signing.PrivateKey())
        let (model, _, ledger, _) = try await received([StubReply(status: 200,
                                                                 body: F.decisionBody(conf: conf, noteId: n.noteId, jsonStatus: "settled"))])
        await model.settle()
        #expect(model.phase == .received)
        #expect(model.issue?.kind == .settlement(.verification(.badSignature)))
        #expect(try ledger.entries().first?.state == .pending)
    }

    @Test("no connection, a server that is not running, and no server at all are each reported")
    func offlineAndMissingServer() async throws {
        let (offline, _, _, _) = try await received([StubReply(failure: URLError(.notConnectedToInternet))])
        await offline.settle()
        #expect(offline.issue?.kind == .settlement(.network(.notConnectedToInternet)))
        #expect(offline.phase == .received)

        let (down, _, _, _) = try await received([StubReply(status: 503, body: Data("Sandbox API not deployed yet.".utf8))])
        await down.settle()
        #expect(down.issue?.kind == .settlement(.http(status: 503, error: nil, message: nil)))
        #expect(down.issue?.message.contains("HTTP 503") == true)

        let (none, _, _, _) = try await received(nil)
        await none.settle()
        #expect(none.issue?.kind == .serverNotConnected)
        #expect(none.phase == .received)
    }

    @Test("a note still pending when the 20 s Settle wait runs out keeps waiting; Check again reads the decision (2.22)")
    func pendingThenDecided() async throws {
        let n = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let pendingBody = APIFixtures.json(["noteId": n.noteId.hex, "status": "pending", "signature": NSNull(), "retryAfter": 2])
        let conf = F.confWire(noteId: n.noteId, status: 1)
        // The upload and five polls (at 2, 4, 8, 16 and 19 s) all answer 202; the wait then ends.
        let (model, _, ledger, stub) = try await received(
            Array(repeating: StubReply(status: 202, body: pendingBody), count: 6)
                + [StubReply(status: 200, body: F.decisionBody(conf: conf, noteId: n.noteId, jsonStatus: "settled"))])
        #expect(ReceiveModel.settleWaitBudget == 20)
        await model.settle()
        #expect(stub?.requests.count == 6)
        #expect(model.phase == .received)
        #expect(model.pendingSettlement?.retryAfter == 2)
        #expect(model.offersCheckAgain)
        #expect(!model.settlementOutcomeUnknown, "the server answered 202: it holds the note")
        #expect(model.issue == nil)
        #expect(!model.isWaitingForChain && !model.isWorking)
        #expect(try ledger.entries().first?.state == .pending)
        await model.checkAgain()
        #expect(model.phase == .settled)
        #expect(model.settlement?.status == .paid)
        #expect(stub?.requests.count == 7)
        #expect(stub?.requests.last?.url?.path == "/v1/notes/\(n.noteId.hex)")
    }
}

@Suite("Settle waits for the chain (2.22)")
@MainActor
struct SettleWaitTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    func client(_ transport: any HTTPTransport, clock: SettlementClock, retry: RetryPolicy = .never) -> SettlementClient {
        SettlementClient(deployment: F.deployment, serverPublicKey: F.serverKey, baseURL: APIFixtures.baseURL,
                         transport: transport, retryPolicy: retry, clock: clock)
    }

    /// A Receive model holding one accepted, acknowledged note, settling through `client`.
    func received(_ client: SettlementClient) async throws -> (ReceiveModel, SignedNote, OfflineLedger) {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: ledger, settlementClient: client, deployment: F.deployment,
                                 serverPublicKey: F.serverKey, now: { F.now })
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        await model.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(model.payment?.ack != nil)
        return (model, note, ledger)
    }

    func noteId() throws -> Data {
        try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0).noteId
    }

    func pendingReply(_ noteId: Data, retryAfter: Int = 2) -> StubReply {
        StubReply(status: 202, body: APIFixtures.json(["noteId": noteId.hex, "status": "pending",
                                                       "signature": NSNull(), "retryAfter": retryAfter]))
    }

    func decisionReply(_ conf: Data, _ noteId: Data, jsonStatus: String, error: String? = nil) -> StubReply {
        StubReply(status: 200, body: F.decisionBody(conf: conf, noteId: noteId, jsonStatus: jsonStatus, error: error))
    }

    @Test("a 202 and then a settled CONF end on Paid after one Settle tap")
    func oneTapToPaid() async throws {
        let id = try noteId()
        let stub = StubTransport([pendingReply(id, retryAfter: 1), decisionReply(F.confWire(noteId: id, status: 1), id,
                                                                                 jsonStatus: "settled")])
        let clock = FakeClock()
        let (model, note, ledger) = try await received(client(stub, clock: clock.clock))
        await model.settle()
        #expect(model.phase == .settled)
        let settlement = try #require(model.settlement)
        #expect(settlement.status == .paid)
        #expect(settlement.receipt.confirmation?.status == .settled)
        #expect(stub.requests.map(\.httpMethod) == ["POST", "GET"])
        #expect(stub.requests.last?.url?.path == "/v1/notes/\(note.noteId.hex)")
        #expect(clock.sleeps == [1], "one wait, the server's retryAfter")
        #expect(model.pendingSettlement == nil && !model.offersCheckAgain)
        #expect(!model.isWaitingForChain && !model.isWorking)
        #expect(try ledger.entries().first?.state == .settled)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 0)
    }

    @Test("a 202 and then a failed CONF with SerialUsed 6011 show Failed (already spent), only from the signed code")
    func waitEndsOnAlreadySpent() async throws {
        let id = try noteId()
        let failed = F.confWire(noteId: id, status: 2, errorCode: LokaVaultError.serialUsed)
        let stub = StubTransport([pendingReply(id), decisionReply(failed, id, jsonStatus: "failed", error: "SerialUsed")])
        let (model, _, ledger) = try await received(client(stub, clock: FakeClock().clock))
        await model.settle()
        #expect(model.phase == .settled)
        let settlement = try #require(model.settlement)
        #expect(settlement.status == .failed)
        let facts = settlement.facts(clusterId: F.deployment.clusterId)
        #expect(facts.errorCode == 6011)
        #expect(facts.statusDetail == "already spent")
        #expect(MoneyStatusChip.word(settlement.status, detail: facts.statusDetail) == "Failed (already spent)")
        #expect(try ledger.entries().first?.state == .refused)

        // The same wait with a settled CONF whose JSON says SerialUsed is Paid: the JSON is never read.
        let lying = StubTransport([pendingReply(id), decisionReply(F.confWire(noteId: id, status: 1), id,
                                                                   jsonStatus: "failed", error: "SerialUsed")])
        let (paid, _, _) = try await received(client(lying, clock: FakeClock().clock))
        await paid.settle()
        #expect(paid.settlement?.status == .paid)
        #expect(paid.settlement?.facts(clusterId: F.deployment.clusterId).statusDetail == nil)
    }

    @Test("a CONF that does not verify at the end of the wait is not trusted: the outcome is unknown and the note held")
    func rogueConfAfterWait() async throws {
        let id = try noteId()
        let rogue = F.confWire(noteId: id, status: 1, signedBy: Curve25519.Signing.PrivateKey())
        let stub = StubTransport([pendingReply(id), decisionReply(rogue, id, jsonStatus: "settled")])
        let (model, _, ledger) = try await received(client(stub, clock: FakeClock().clock))
        await model.settle()
        #expect(model.phase == .received)
        #expect(model.settlement == nil)
        #expect(model.issue?.kind == .settlement(.verification(.badSignature)))
        #expect(model.settlementOutcomeUnknown)
        #expect(model.offersCheckAgain)
        #expect(try ledger.entries().first?.state == .pending)
    }

    @Test("the budget running out during the upload leaves the outcome unknown, never pending")
    func budgetEndsDuringUpload() async throws {
        let id = try noteId()
        let clock = FakeClock()
        // The server takes 25 s to answer the upload: the 20 s budget ends first.
        let stub = StubTransport([decisionReply(F.confWire(noteId: id, status: 1), id, jsonStatus: "settled").delayed(25)],
                                 clock: clock)
        let (model, _, ledger) = try await received(client(stub, clock: clock.clock))
        await model.settle()
        #expect(clock.now <= ReceiveModel.settleWaitBudget)
        #expect(stub.requests.count == 1)
        #expect(model.phase == .received)
        #expect(model.pendingSettlement == nil, "no 202 came back, so the screen never says the server has the note")
        #expect(model.settlementOutcomeUnknown)
        #expect(model.issue?.kind == .settlement(.network(.timedOut)))
        #expect(model.offersCheckAgain)
        #expect(try ledger.entries().first?.state == .pending)
    }

    @Test("leaving the screen stops the wait: no poll after it, a second tap sends nothing, the 202 keeps Check again",
          .timeLimit(.minutes(1)))
    func leavingStopsThePolls() async throws {
        let id = try noteId()
        let stub = StubTransport([pendingReply(id), pendingReply(id)])
        let held = HeldClock()
        let (model, _, ledger) = try await received(client(stub, clock: held.clock))
        let settling = Task { await model.settle() }
        var sleeps = held.started.makeAsyncIterator()
        _ = await sleeps.next()  // the upload answered 202; the wait sleeps before its first poll
        #expect(model.isWaitingForChain)
        #expect(model.pendingSettlement?.noteId == id, "the 202 shows during the wait")
        await model.settle()  // a second tap during the wait
        #expect(stub.requests.count == 1, "a second tap sends nothing while the first waits")
        model.stopWaiting()
        await settling.value
        #expect(stub.requests.count == 1, "no poll after the screen went away")
        #expect(!model.isWaitingForChain && !model.isWorking)
        #expect(model.phase == .received)
        #expect(model.settlement == nil)
        #expect(model.issue == nil, "leaving the screen is not an error")
        #expect(model.offersCheckAgain)
        #expect(!model.settlementOutcomeUnknown)
        #expect(try ledger.entries().first?.state == .pending)
    }

    @Test("leaving the screen while the upload is unanswered leaves the outcome unknown", .timeLimit(.minutes(1)))
    func leavingDuringUploadIsUnknown() async throws {
        let transport = HeldTransport()
        let (model, _, ledger) = try await received(client(transport, clock: FakeClock().clock, retry: .standard))
        let settling = Task { await model.settle() }
        var uploads = transport.started.makeAsyncIterator()
        _ = await uploads.next()  // the upload is on the wire
        model.stopWaiting()
        await settling.value
        #expect(transport.requests == 1, "a cancelled upload is not retried")
        #expect(model.phase == .received)
        #expect(model.pendingSettlement == nil)
        #expect(model.settlementOutcomeUnknown, "the server may have the note: unknown, never unsent")
        #expect(model.offersCheckAgain)
        #expect(model.issue == nil)
        #expect(!model.isWaitingForChain && !model.isWorking)
        #expect(try ledger.entries().first?.state == .pending)
    }

    @Test("a poll with no answer when the budget runs out leaves the outcome unknown, never pending (Codex finding 1)")
    func unansweredPollIsUnknown() async throws {
        let id = try noteId()
        let clock = FakeClock()
        // The upload answers 202; the poll at 2 s would take 25 s, so the budget ends with it unanswered.
        let stub = StubTransport([pendingReply(id),
                                  decisionReply(F.confWire(noteId: id, status: 1), id, jsonStatus: "settled").delayed(25)],
                                 clock: clock)
        let (model, _, ledger) = try await received(client(stub, clock: clock.clock))
        await model.settle()
        #expect(stub.requests.map(\.httpMethod) == ["POST", "GET"])
        #expect(clock.now <= ReceiveModel.settleWaitBudget)
        #expect(model.phase == .received)
        #expect(model.settlement == nil)
        #expect(model.settlementOutcomeUnknown, "the poll's lost answer may have carried the decision")
        #expect(model.issue?.kind == .settlement(.network(.timedOut)))
        #expect(model.offersCheckAgain)
        #expect(try ledger.entries().first?.state == .pending)
    }

    @Test("leaving while a held note's receipt is being signed starts no upload; back on screen, Settle works (Codex finding 2)",
          .timeLimit(.minutes(1)))
    func leavingDuringHeldNoteSigning() async throws {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        // The merchant key behind a gate (ScreenReviewRound3Tests): its signature waits until opened.
        let gate = GatedSigner()
        let note = try F.note(payer: payer, payee: gate.keyHash, amount: 1_000_000, serial: 0)
        let allowanceWire = F.allowanceWire(payer: payer.keyHash)
        let certificate = try AllowanceCertificate.verify(wire: allowanceWire, deployment: F.deployment,
                                                          serverPublicKey: F.serverKey)
        // Held with no stored ACK, so Settle on its row signs a receipt first (Face ID on a phone).
        try ledger.accept(note: note, certificate: certificate, now: Int64(F.now.timeIntervalSince1970),
                          allowanceWire: allowanceWire)
        let stub = StubTransport([decisionReply(F.confWire(noteId: note.noteId, status: 1), note.noteId,
                                                jsonStatus: "settled")])
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: gate.keyHash), signer: gate, ledger: ledger,
                                 settlementClient: client(stub, clock: FakeClock().clock), deployment: F.deployment,
                                 serverPublicKey: F.serverKey, now: { F.now })
        let row = try #require(model.unsettledPayments.first)
        #expect(row.ack == nil && model.canSettle(row))
        let settling = Task { await model.settleUnsettled(noteId: note.noteId) }
        try await gate.waitUntilStarted()  // the receipt prompt is open
        model.stopWaiting()  // the merchant leaves the screen
        gate.open()
        await settling.value
        #expect(stub.requests.isEmpty, "nothing uploaded for a screen nobody sees")
        #expect(model.phase == .received)
        #expect(model.payment?.ack != nil)
        #expect(!model.isWorking && !model.isWaitingForChain)
        // Shown again: the Settle tap uploads and ends on Paid.
        model.screenShown()
        await model.settle()
        #expect(stub.requests.count == 1)
        #expect(model.settlement?.status == .paid)
    }

    @Test("cancelling the task that called Settle cancels the wait too (Codex finding 3)", .timeLimit(.minutes(1)))
    func cancelledCallerStopsTheWait() async throws {
        let id = try noteId()
        let stub = StubTransport([pendingReply(id)])
        let held = HeldClock()
        let (model, _, _) = try await received(client(stub, clock: held.clock))
        let settling = Task { await model.settle() }
        var sleeps = held.started.makeAsyncIterator()
        _ = await sleeps.next()  // the wait sleeps before its first poll
        settling.cancel()
        await settling.value
        #expect(!model.isWorking && !model.isWaitingForChain, "the wait ended with its caller")
        #expect(stub.requests.count == 1, "no poll after the caller was cancelled")
        #expect(model.offersCheckAgain)
    }
}
