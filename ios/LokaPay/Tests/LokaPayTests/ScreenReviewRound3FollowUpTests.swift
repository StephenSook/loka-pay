import Foundation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// Codex review 3, its third round on the Receive screen. Each suite names its finding.
@Suite("a held note comes back only when its reservation is the one on its serial (review 3 round 3, finding 1)")
@MainActor
struct SoleReservationTests {
    let payer = SoftwareP256Signer()
    let merchant = CountingSigner()
    /// Built once: CryptoKit's Ed25519 signatures are randomized, so a rebuilt wire differs.
    let merchantWire: Data
    let allowanceWire: Data
    let nowSeconds = Int64(F.now.timeIntervalSince1970)

    init() {
        merchantWire = F.merchantWire(merchant: merchant.keyHash)
        allowanceWire = F.allowanceWire(payer: payer.keyHash)
    }

    /// A ledger holding note A, accepted with no ACK, and a planted note B from the same payer on
    /// the same allowance and serial: two genuine notes that no acceptance would both have written.
    func ledgerWithDuplicateSerial() throws -> (OfflineLedger, URL, SignedNote, SignedNote) {
        let url = F.tempURL("ledger.json")
        let ledger = OfflineLedger(url: url)
        let a = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 3)
        let b = try F.note(payer: payer, payee: merchant.keyHash, amount: 500_000, serial: 3)
        let certificate = try AllowanceCertificate.verify(wire: allowanceWire, deployment: F.deployment,
                                                          serverPublicKey: F.serverKey)
        try ledger.accept(note: a, certificate: certificate, now: nowSeconds, allowanceWire: allowanceWire)
        var rows = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        rows.append([
            "noteIdHex": b.noteId.hex, "allowanceId": F.allowanceId, "serial": 3, "amount": 500_000,
            "acceptedAt": nowSeconds, "state": "pending", "wireHex": b.wire.hex, "allowanceWireHex": allowanceWire.hex,
        ])
        try JSONSerialization.data(withJSONObject: rows).write(to: url)
        return (ledger, url, a, b)
    }

    func makeModel(_ ledger: OfflineLedger) -> (ReceiveModel, StubTransport) {
        // No replies: any upload fails the test.
        let stub = StubTransport([])
        let model = ReceiveModel(merchantWire: merchantWire, signer: merchant, ledger: ledger,
                                 settlementClient: APIFixtures.client(stub, retry: .never), deployment: F.deployment,
                                 serverPublicKey: F.serverKey, internetState: { InternetState.none }, now: { F.now })
        return (model, stub)
    }

    @Test("a planted second note on the same serial: both refused as damaged, nothing signed, both stay reserved")
    func plantedDuplicateSerial() async throws {
        let (ledger, _, a, b) = try ledgerWithDuplicateSerial()
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 1_500_000)
        let (model, stub) = makeModel(ledger)
        #expect(model.unsettledPayments.count == 2)
        for row in model.unsettledPayments { #expect(!model.canSettle(row)) }

        for note in [a, b] {
            await model.settleUnsettled(noteId: note.noteId)
            #expect(model.issue?.name == "damaged_record")
            #expect(model.phase == .ready)
            await model.accept(text: PaymentTransport.encode(.note, note.wire))
            #expect(model.issue?.name == "damaged_record")
            #expect(model.phase == .ready)
        }
        #expect(model.payment == nil)
        #expect(merchant.count == 0, "a merchant ACK was signed for a note with a competing reservation")
        #expect(stub.requests.isEmpty)
        #expect(try ledger.entries().count == 2)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 1_500_000, "both stay reserved")
    }

    @Test("the loader flags both entries on a shared serial, and only a unique pending reservation counts as sole")
    func loaderFlagsSharedSerial() throws {
        let (ledger, url, a, b) = try ledgerWithDuplicateSerial()
        let entries = try ledger.entries()
        #expect(entries.count == 2)
        #expect(entries.allSatisfy { $0.sharesSerial })
        #expect(try !ledger.holdsSoleReservation(noteId: a.noteId))
        #expect(try !ledger.holdsSoleReservation(noteId: b.noteId))
        let certificate = try AllowanceCertificate.verify(wire: allowanceWire, deployment: F.deployment,
                                                          serverPublicKey: F.serverKey)
        // A later write keeps both entries and never stores the flag.
        let other = try F.note(payer: payer, payee: merchant.keyHash, amount: 1, serial: 4)
        try ledger.accept(note: other, certificate: certificate, now: nowSeconds)
        #expect(try ledger.entries().count == 3)
        #expect(try ledger.entries().filter { $0.sharesSerial }.count == 2)
        #expect(try !String(contentsOf: url, encoding: .utf8).contains("sharesSerial"))

        let clean = OfflineLedger(url: F.tempURL("ledger.json"))
        try clean.accept(note: a, certificate: certificate, now: nowSeconds)
        #expect(try !clean.entries().contains { $0.sharesSerial })
        #expect(try clean.holdsSoleReservation(noteId: a.noteId))
        #expect(try !clean.holdsSoleReservation(noteId: b.noteId), "no entry for this note id")
        try clean.resolve(noteId: a.noteId, as: .settled)
        #expect(try !clean.holdsSoleReservation(noteId: a.noteId), "no longer pending")
    }
}

@Suite("queued Bluetooth texts expire by their first arrival time (review 3 round 3, finding 3)")
@MainActor
struct InboxQueuedExpiryTests {
    let payer = SoftwareP256Signer()

    @Test("a text queued behind a blocked consumer past maxAge is dropped and counted, never handed to the new screen")
    func queuedTextExpiresAtTakeover() async throws {
        let clock = TestClock()
        let inbox = PaymentInbox(maxAge: 300, now: { clock.now })
        let merchant = GatedSigner()
        let merchantWire = F.merchantWire(merchant: merchant.keyHash)
        func makeModel() -> ReceiveModel {
            ReceiveModel(merchantWire: merchantWire, signer: merchant, ledger: OfflineLedger(url: F.tempURL("ledger.json")),
                         settlementClient: nil, deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox,
                         now: { F.now })
        }
        let old = makeModel()
        old.startInbox()
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        inbox.deliver(PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        inbox.deliver(PaymentTransport.encode(.note, note.wire))
        try await merchant.waitUntilStarted()

        // Queued behind the blocked consumer, then left there past the age limit.
        inbox.deliver(PaymentTransport.encode(.allowance, F.allowanceWire(payer: SoftwareP256Signer().keyHash, id: 501)))
        #expect(inbox.droppedWhileDetached == 0)
        clock.now += 301

        let fresh = makeModel()
        fresh.startInbox()
        await fresh.inboxDrained()
        #expect(fresh.allowances[501] == nil, "an expired text was handed to the new screen")
        #expect(fresh.lastAllowance == nil)
        #expect(inbox.droppedWhileDetached == 1)
        #expect(fresh.inboxDropped == 1)

        merchant.open()
        await old.inboxDrained()
        #expect(old.allowances[501] == nil)
        #expect(inbox.droppedWhileDetached == 1, "counted once")
    }
}

@Suite("inbox order is arrival order, not timestamp order (review 3 round 3, finding 4)")
@MainActor
struct InboxArrivalOrderTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    func allowanceText(_ id: UInt64) -> String {
        PaymentTransport.encode(.allowance, F.allowanceWire(payer: SoftwareP256Signer().keyHash, id: id))
    }

    @Test("an older held text and a newer queued one with the same timestamp keep their order through a takeover")
    func equalTimestampsThroughTakeover() async throws {
        let clock = TestClock()  // never moves: every text has the same timestamp
        let inbox = PaymentInbox(maxAge: 300, now: { clock.now })
        let merchantWire = F.merchantWire(merchant: merchant.keyHash)
        func makeModel() -> ReceiveModel {
            ReceiveModel(merchantWire: merchantWire, signer: merchant, ledger: OfflineLedger(url: F.tempURL("ledger.json")),
                         settlementClient: nil, deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox,
                         now: { F.now })
        }
        let first = makeModel()
        first.startInbox()
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        inbox.deliver(PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        inbox.deliver(PaymentTransport.encode(.note, note.wire))
        await first.inboxDrained()
        #expect(first.phase == .received)

        // A arrives during the payment and is held; B arrives next and is still queued when a
        // rebuilt screen takes over.
        let a = allowanceText(501)
        let b = allowanceText(502)
        inbox.deliver(a)
        await first.inboxDrained()
        #expect(inbox.held == [a])
        inbox.deliver(b)
        let fresh = makeModel()
        fresh.startInbox()
        #expect(inbox.queuedTexts == [a, b], "the takeover put the newer text first")

        await fresh.inboxDrained()
        await first.inboxDrained()
        #expect(fresh.lastAllowance?.allowanceId == 502, "the older text was checked after the newer one")
        #expect(fresh.allowances[501] != nil)
    }

    @Test("when the phone's clock moves backwards, held order and capacity eviction still follow arrival")
    func clockMovesBackwards() {
        let clock = TestClock()
        let inbox = PaymentInbox(maxAge: 300, now: { clock.now })
        inbox.deliver("A")
        clock.now -= 10
        inbox.deliver("B")
        #expect(inbox.held == ["A", "B"], "a later text went ahead of an earlier one")

        // Full: the first arrival goes first, whatever its timestamp.
        let more = (0..<15).map { "C\($0)" }
        for text in more { inbox.deliver(text) }
        #expect(inbox.droppedWhileDetached == 1)
        #expect(inbox.held == ["B"] + more, "eviction dropped a text other than the first arrival")
    }
}

@Suite("an expired note with no saved receipt is shown as blocked, and stays reserved (review 3 round 3, finding 5)")
@MainActor
struct ExpiredWithoutReceiptTests {
    let payer = SoftwareP256Signer()
    let merchant = CountingSigner()
    let merchantWire: Data
    let allowanceWire: Data
    let nowSeconds = Int64(F.now.timeIntervalSince1970)

    init() {
        merchantWire = F.merchantWire(merchant: merchant.keyHash)
        allowanceWire = F.allowanceWire(payer: payer.keyHash)
    }

    func makeModel(_ ledger: OfflineLedger) -> (ReceiveModel, StubTransport) {
        let stub = StubTransport([])
        let model = ReceiveModel(merchantWire: merchantWire, signer: merchant, ledger: ledger,
                                 settlementClient: APIFixtures.client(stub, retry: .never), deployment: F.deployment,
                                 serverPublicKey: F.serverKey, now: { F.now })
        return (model, stub)
    }

    func certificate() throws -> AllowanceCertificate {
        try AllowanceCertificate.verify(wire: allowanceWire, deployment: F.deployment, serverPublicKey: F.serverKey)
    }

    @Test("no ACK and past its expiry: blocked, says why, offers no settle, and the amount stays reserved")
    func blockedRow() async throws {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0, expiry: nowSeconds - 60)
        try ledger.accept(note: note, certificate: try certificate(), now: nowSeconds - 600, allowanceWire: allowanceWire)
        let (model, stub) = makeModel(ledger)
        let row = try #require(model.unsettledPayments.first)
        #expect(model.state(of: row) == .expiredWithoutReceipt)
        #expect(model.state(of: row).isBlocked)
        #expect(!model.canSettle(row))
        let text = ReceiveModel.unsettledRowText(row, state: .expiredWithoutReceipt)
        #expect(text.contains("No signed receipt was kept for it"))
        #expect(text.contains("a new one cannot be signed because the note expired"))
        #expect(text.contains("Its amount stays reserved"))
        #expect(!text.contains("signs its receipt first"))
        let summary = ReceiveModel.unsettledSummary(count: 1, total: 1_000_000, unlisted: 0, unreadable: false, blocked: 1)
        #expect(summary.contains("1 of them cannot be settled from this phone"))
        #expect(!summary.contains("Each keeps its signed receipt"))

        // Even if asked, nothing is signed or sent, and nothing is released.
        await model.settleUnsettled(noteId: note.noteId)
        #expect(model.issue?.kind == .payment(.expired))
        #expect(merchant.count == 0)
        #expect(stub.requests.isEmpty)
        #expect(try ledger.entries().first?.state == .pending)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 1_000_000)
    }

    @Test("past its expiry but with its own signed ACK from before then: still settleable")
    func ackedExpiredIsSettleable() throws {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let expiry = nowSeconds - 60
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0, expiry: expiry)
        try ledger.accept(note: note, certificate: try certificate(), now: expiry - 120, allowanceWire: allowanceWire)
        try ledger.attachAck(noteId: note.noteId,
                             ackWire: try Ack.sign(note: note, receivedAt: expiry - 120, with: merchant.inner).wire)
        let (model, _) = makeModel(ledger)
        let row = try #require(model.unsettledPayments.first)
        #expect(model.state(of: row) == .settleable)
        #expect(!ReceiveModel.unsettledRowText(row, state: .settleable).contains("cannot"))
    }
}
