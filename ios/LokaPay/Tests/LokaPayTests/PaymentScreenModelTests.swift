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

        // After Next payment, the identical note again is "already received", not a reuse.
        model.nextPayment()
        await model.accept(text: noteText(note))
        #expect(model.issue?.kind == .alreadyReceived)
        #expect(model.conflictingSpend == false)
        #expect(try ledger.entries().count == 1)
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
        #expect(model.issue?.message.contains("refused this note before it reached the chain") == true)
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

    @Test("a pending answer keeps waiting; Check again reads the decision")
    func pendingThenDecided() async throws {
        let n = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let pendingBody = APIFixtures.json(["noteId": n.noteId.hex, "status": "pending", "signature": NSNull(), "retryAfter": 2])
        let conf = F.confWire(noteId: n.noteId, status: 1)
        let (model, _, _, stub) = try await received([
            StubReply(status: 202, body: pendingBody),
            StubReply(status: 200, body: F.decisionBody(conf: conf, noteId: n.noteId, jsonStatus: "settled")),
        ])
        await model.settle()
        #expect(model.phase == .received)
        #expect(model.pendingSettlement?.retryAfter == 2)
        await model.checkAgain()
        #expect(model.phase == .settled)
        #expect(model.settlement?.status == .paid)
        #expect(stub?.requests.last?.url?.path == "/v1/notes/\(n.noteId.hex)")
    }
}
