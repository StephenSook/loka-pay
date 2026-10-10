import CryptoKit
import Foundation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// Holds `sign` until the test opens it, the way a Face ID prompt holds the ACK. Never hangs the
/// suite: after 10 s it gives up and throws.
final class GatedSigner: PaymentSigner, @unchecked Sendable {
    let inner = SoftwareP256Signer()
    private let gate = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var started = false

    var compressedPublicKey: Data { inner.compressedPublicKey }
    /// True once `sign` has been called and is waiting (or has waited) at the gate.
    var hasStarted: Bool { lock.withLock { started } }

    func open() { gate.signal() }

    func sign(_ message: Data) throws -> Data {
        lock.withLock { started = true }
        guard gate.wait(timeout: .now() + 10) == .success else { throw CancellationError() }
        return try inner.sign(message)
    }

    /// Waits (up to about 2 s) until `sign` is waiting at the gate.
    func waitUntilStarted() async throws {
        for _ in 0..<1000 where !hasStarted { try await Task.sleep(nanoseconds: 2_000_000) }
        #expect(hasStarted, "the ACK signature never started")
    }
}

/// Review round 3 on the Receive screen (Codex adversarial review). Each suite names its finding.
@Suite("Bluetooth work waits in one bounded queue (review 3, finding 4)")
@MainActor
struct InboxBoundedQueueTests {
    let payer = SoftwareP256Signer()

    @Test("while the ACK signature waits, deliveries past capacity are dropped and counted, never queued without bound")
    func boundedWhileSigning() async throws {
        let merchant = GatedSigner()
        let inbox = PaymentInbox()
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: ledger, settlementClient: nil, deployment: F.deployment,
                                 serverPublicKey: F.serverKey, inbox: inbox, now: { F.now })
        model.startInbox()
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        inbox.deliver(PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        inbox.deliver(PaymentTransport.encode(.note, note.wire))
        try await merchant.waitUntilStarted()
        #expect(model.phase == .received)
        #expect(model.isWorking)

        // Four more valid codes than the inbox can keep arrive while the signature is pending.
        let extra = 4
        let texts = (0..<(PaymentInbox.capacity + extra)).map { i in
            PaymentTransport.encode(.allowance, F.allowanceWire(payer: SoftwareP256Signer().keyHash, id: 1000 + UInt64(i)))
        }
        for text in texts { inbox.deliver(text) }
        // Counted at once, while the consumer is still waiting on the signature.
        #expect(inbox.droppedWhileDetached == extra)
        #expect(model.inboxDropped == extra)
        #expect(inbox.held.isEmpty, "queued texts are not held yet")

        merchant.open()
        await model.inboxDrained()
        #expect(model.payment?.ack != nil)
        // The queue held exactly capacity texts: the newest ones, each now waiting for Next payment.
        #expect(inbox.held == Array(texts.suffix(PaymentInbox.capacity)))
        #expect(inbox.droppedWhileDetached == extra)
        #expect(try ledger.entries().count == 1)
    }

    @Test("junk is counted on arrival and takes no queue place")
    func junkTakesNoPlace() async throws {
        let merchant = GatedSigner()
        let inbox = PaymentInbox()
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                                 deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox, now: { F.now })
        model.startInbox()
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        inbox.deliver(PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        inbox.deliver(PaymentTransport.encode(.note, note.wire))
        try await merchant.waitUntilStarted()

        let real = PaymentTransport.encode(.allowance, F.allowanceWire(payer: SoftwareP256Signer().keyHash, id: 88))
        inbox.deliver(real)
        for i in 0..<(PaymentInbox.capacity * 2) { inbox.deliver("junk \(i)") }
        #expect(model.inboxUnreadable == PaymentInbox.capacity * 2)
        #expect(inbox.droppedWhileDetached == 0)

        merchant.open()
        await model.inboxDrained()
        #expect(inbox.held == [real])
    }
}

@Suite("queued Bluetooth work never runs after Receive disappears (review 3, finding 3)")
@MainActor
struct InboxOwnershipTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    func makeModel(_ inbox: PaymentInbox, ledger: OfflineLedger) -> ReceiveModel {
        ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant, ledger: ledger,
                     settlementClient: nil, deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox,
                     now: { F.now })
    }

    /// An allowance and a note for this merchant, each built once (Ed25519 signatures are randomized).
    func codes() throws -> (allowance: String, note: String) {
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        return (PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)),
                PaymentTransport.encode(.note, note.wire))
    }

    @Test("stopInbox before the queued task runs: nothing reserved, and the texts are back with their arrival times")
    func stopBeforeQueuedWork() async throws {
        let clock = TestClock()
        let inbox = PaymentInbox(maxAge: 300, now: { clock.now })
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let model = makeModel(inbox, ledger: ledger)
        let (allowance, note) = try codes()
        model.startInbox()
        inbox.deliver(allowance)
        inbox.deliver(note)
        // The screen disappears before the queued work gets its turn.
        model.stopInbox()
        await model.inboxDrained()
        #expect(model.phase == .ready)
        #expect(model.payment == nil)
        #expect(model.lastAllowance == nil)
        #expect(model.allowances.isEmpty)
        #expect(try ledger.entries().isEmpty, "a note was reserved for a screen that was not shown")
        #expect(inbox.held == [allowance, note])
        #expect(inbox.droppedWhileDetached == 0)

        // They kept their first arrival time: past the age limit counted from it, a returning
        // screen gets nothing.
        clock.now += 301
        model.startInbox()
        await model.inboxDrained()
        #expect(inbox.held.isEmpty)
        #expect(inbox.droppedWhileDetached == 2)
        #expect(model.lastAllowance == nil)
        #expect(try ledger.entries().isEmpty)
    }

    @Test("the returned texts are checked when the screen shows again within the age limit")
    func returnedTextsAreTakenLater() async throws {
        let clock = TestClock()
        let inbox = PaymentInbox(maxAge: 300, now: { clock.now })
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let model = makeModel(inbox, ledger: ledger)
        let (allowance, note) = try codes()
        model.startInbox()
        inbox.deliver(allowance)
        inbox.deliver(note)
        model.stopInbox()
        await model.inboxDrained()
        #expect(try ledger.entries().isEmpty)

        clock.now += 60
        model.startInbox()
        await model.inboxDrained()
        #expect(model.phase == .received)
        #expect(model.payment?.ack != nil)
        #expect(try ledger.entries().count == 1)
        #expect(inbox.held.isEmpty)
    }

    @Test("work queued by a screen that lost the inbox to a newer one goes to the newer one")
    func takeoverHandsQueuedWorkOver() async throws {
        let inbox = PaymentInbox()
        let old = makeModel(inbox, ledger: OfflineLedger(url: F.tempURL("ledger.json")))
        let freshLedger = OfflineLedger(url: F.tempURL("ledger.json"))
        let fresh = makeModel(inbox, ledger: freshLedger)
        let (allowance, note) = try codes()
        old.startInbox()
        inbox.deliver(allowance)
        inbox.deliver(note)
        // A rebuilt screen attaches before the old one's queued work ran (no onDisappear yet).
        fresh.startInbox()
        await old.inboxDrained()
        await fresh.inboxDrained()
        #expect(old.payment == nil)
        #expect(old.lastAllowance == nil)
        #expect(fresh.phase == .received)
        #expect(try freshLedger.entries().count == 1)
    }
}

@Suite("a lost answer leaves the outcome unknown and offers Check again (review 3, finding 2)")
@MainActor
struct OutcomeUnknownTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    /// A Receive model holding one accepted, acknowledged note, with a settlement stub that never retries.
    func received(_ replies: [StubReply]) async throws -> (ReceiveModel, SignedNote, OfflineLedger, StubTransport) {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let stub = StubTransport(replies)
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: ledger, settlementClient: APIFixtures.client(stub, retry: .never),
                                 deployment: F.deployment, serverPublicKey: F.serverKey, now: { F.now })
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        await model.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(model.payment?.ack != nil)
        return (model, note, ledger, stub)
    }

    func settledReply(_ note: SignedNote) -> StubReply {
        StubReply(status: 200, body: F.decisionBody(conf: F.confWire(noteId: note.noteId, status: 1), noteId: note.noteId,
                                                    jsonStatus: "settled"))
    }

    @Test("a dropped or unverifiable answer says the outcome is unknown; a refusal still says nothing was decided")
    func copy() {
        let unknown: [SettlementError] = [
            .network(.timedOut), .network(.networkConnectionLost), .network(.notConnectedToInternet), .transport("x"),
            .http(status: 502, error: nil, message: nil), .invalidResponse("x"), .verification(.badSignature),
            .confirmationMismatch, .protocolViolation("x"),
        ]
        for error in unknown {
            let message = MoneyIssueKind.settlement(error).message
            #expect(error.leavesOutcomeUnknown, "\(error)")
            #expect(message.contains("the outcome is unknown"), "\(error): \(message)")
            #expect(message.contains("Check again asks the server by note id"), "\(error)")
            #expect(!message.contains("Nothing was decided"), "\(error): \(message)")
        }
        let decidedNothing: [SettlementError] = [
            .refused(check: "bad_signature", message: ""), .chainUnavailable(message: ""), .budgetExhausted(message: ""),
            .unknownNote(message: ""), .badJSON(message: ""), .rateLimited(retryAfter: 2, message: ""),
        ]
        for error in decidedNothing {
            #expect(!error.leavesOutcomeUnknown, "\(error)")
            #expect(!MoneyIssueKind.settlement(error).message.contains("unknown"), "\(error)")
        }
        #expect(MoneyIssueKind.settlement(.refused(check: "bad_ack", message: "")).message
                .contains("Nothing was decided on chain"))
        #expect(!ReceiveModel.outcomeUnknownText.contains("\u{2014}") && !ReceiveModel.outcomeUnknownText.contains("\u{2013}"))
    }

    @Test("after a timeout the note stays reserved and Check again reads GET /v1/notes/{id}, verifying the CONF")
    func checkAgainAfterTimeout() async throws {
        let n = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let (model, note, ledger, stub) = try await received([StubReply(failure: URLError(.timedOut)), settledReply(n)])
        #expect(note.noteId == n.noteId)
        #expect(!model.offersCheckAgain, "nothing to check before any call")
        await model.settle()
        #expect(model.issue?.kind == .settlement(.network(.timedOut)))
        #expect(model.phase == .received)
        #expect(model.pendingSettlement == nil, "no 202 came back")
        #expect(model.settlementOutcomeUnknown)
        #expect(model.offersCheckAgain)
        #expect(try ledger.entries().first?.state == .pending)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 1_000_000)

        await model.checkAgain()
        let request = try #require(stub.requests.last)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/v1/notes/\(note.noteId.hex)")
        #expect(model.phase == .settled)
        #expect(model.settlement?.status == .paid)
        #expect(!model.settlementOutcomeUnknown)
        #expect(try ledger.entries().first?.state == .settled)
    }

    @Test("a CONF from another key on Check again is not trusted: the outcome stays unknown and the note reserved")
    func checkAgainRogueConf() async throws {
        let n = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let rogue = F.confWire(noteId: n.noteId, status: 1, signedBy: Curve25519.Signing.PrivateKey())
        let (model, _, ledger, _) = try await received([
            StubReply(failure: URLError(.networkConnectionLost)),
            StubReply(status: 200, body: F.decisionBody(conf: rogue, noteId: n.noteId, jsonStatus: "settled")),
        ])
        await model.settle()
        await model.checkAgain()
        #expect(model.phase == .received)
        #expect(model.issue?.kind == .settlement(.verification(.badSignature)))
        #expect(model.offersCheckAgain)
        #expect(try ledger.entries().first?.state == .pending)
    }

    @Test("Settle again after a lost answer uploads the original note bytes and the same ACK")
    func reuploadSendsOriginalBytes() async throws {
        let n = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let (model, note, _, stub) = try await received([StubReply(failure: URLError(.networkConnectionLost)),
                                                         settledReply(n)])
        await model.settle()
        #expect(model.offersCheckAgain)
        await model.settle()
        #expect(model.settlement?.status == .paid)
        #expect(stub.requests.count == 2)
        let bodies = stub.requests.map { APIFixtures.bodyObject($0) }
        #expect(bodies[0]["note"] as? String == Base64URL.encode(note.wire))
        #expect(bodies[1]["note"] as? String == Base64URL.encode(note.wire))
        #expect(bodies[0]["ack"] as? String == bodies[1]["ack"] as? String)
        #expect(stub.requests.allSatisfy { $0.httpMethod == "POST" && $0.url?.path == "/v1/notes" })
    }

    @Test("404 unknown_note on Check again means nothing was decided: Check again gives way to Settle")
    func unknownNoteSettlesTheQuestion() async throws {
        let (model, _, ledger, _) = try await received([StubReply(failure: URLError(.timedOut)),
                                                        APIFixtures.errorReply(404, "unknown_note")])
        await model.settle()
        await model.checkAgain()
        #expect(model.issue?.kind == .settlement(.unknownNote(message: "m")))
        #expect(model.issue?.message.contains("Settle it again") == true)
        #expect(!model.offersCheckAgain)
        #expect(try ledger.entries().first?.state == .pending)
    }
}

@Suite("a held note stays settleable after Next payment and a relaunch (review 3, finding 1)")
@MainActor
struct UnsettledRecoveryTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()
    /// Built once: CryptoKit's Ed25519 signatures are randomized, so a rebuilt wire differs.
    let merchantWire: Data
    let allowanceWire: Data

    init() {
        merchantWire = F.merchantWire(merchant: merchant.keyHash)
        allowanceWire = F.allowanceWire(payer: payer.keyHash)
    }

    var allowanceText: String { PaymentTransport.encode(.allowance, allowanceWire) }

    func makeModel(ledger: OfflineLedger, signer: (any PaymentSigner)? = nil,
                   replies: [StubReply]? = nil) -> (ReceiveModel, StubTransport?) {
        let stub = replies.map { StubTransport($0) }
        let model = ReceiveModel(merchantWire: merchantWire, signer: signer ?? merchant, ledger: ledger,
                                 settlementClient: stub.map { APIFixtures.client($0, retry: .never) },
                                 deployment: F.deployment, serverPublicKey: F.serverKey,
                                 internetState: { InternetState.none }, now: { F.now })
        return (model, stub)
    }

    func note(serial: UInt8 = 0, amount: UInt64 = 1_000_000) throws -> SignedNote {
        try F.note(payer: payer, payee: merchant.keyHash, amount: amount, serial: serial)
    }

    /// Accepts `note` on `model` and returns its signed ACK.
    func accept(_ note: SignedNote, on model: ReceiveModel) async throws -> Ack {
        await model.accept(text: allowanceText)
        await model.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(model.phase == .received)
        return try #require(model.payment?.ack)
    }

    func settledReply(_ note: SignedNote) -> StubReply {
        StubReply(status: 200, body: F.decisionBody(conf: F.confWire(noteId: note.noteId, status: 1), noteId: note.noteId,
                                                    jsonStatus: "settled"))
    }

    @Test("accept, Next payment, Settle from the list: Paid from the verified CONF, and the ledger releases it")
    func settleFromListAfterNextPayment() async throws {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let note = try self.note()
        let (model, stub) = makeModel(ledger: ledger, replies: [settledReply(note)])
        let ack = try await accept(note, on: model)
        #expect(model.unsettledPayments.isEmpty, "the list is read when the screen is ready for a payer")

        model.nextPayment()
        #expect(model.phase == .ready)
        #expect(model.unsettledPayments.count == 1)
        let row = try #require(model.unsettledPayments.first)
        #expect(row.note.wire == note.wire)
        #expect(row.ack == ack)
        #expect(row.certificate?.allowanceId == F.allowanceId)
        #expect(row.receivedWithZeroBars)
        #expect(model.canSettle(row))
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 1_000_000)

        await model.settleUnsettled(noteId: note.noteId)
        #expect(model.phase == .settled)
        #expect(model.settlement?.status == .paid)
        #expect(model.payment?.ack == ack, "the stored ACK, not a new signature")
        #expect(model.payment?.receivedWithZeroBars == true)
        #expect(try ledger.entries().first?.state == .settled)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 0)
        let request = try #require(stub?.requests.first)
        let body = APIFixtures.bodyObject(request)
        #expect(body["note"] as? String == Base64URL.encode(note.wire))
        #expect(body["ack"] as? String == Base64URL.encode(ack.wire))

        model.nextPayment()
        #expect(model.unsettledPayments.isEmpty)
    }

    @Test("accept, relaunch (model and ledger rebuilt from disk), settle: no new signature, no second reservation")
    func settleAfterRelaunch() async throws {
        let url = F.tempURL("ledger.json")
        let note = try self.note()
        let (first, _) = makeModel(ledger: OfflineLedger(url: url))
        let ack = try await accept(note, on: first)

        // The relaunched phone's signer fails if asked to sign (a cancelled Face ID prompt), so Paid
        // below proves the stored ACK was used.
        let ledger = OfflineLedger(url: url)
        let (model, stub) = makeModel(ledger: ledger, signer: CancelledSigner(inner: merchant), replies: [settledReply(note)])
        #expect(model.phase == .ready)
        let row = try #require(model.unsettledPayments.first)
        #expect(row.ack == ack)
        #expect(row.certificate != nil)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 1_000_000)

        await model.settleUnsettled(noteId: note.noteId)
        #expect(model.issue == nil)
        #expect(model.settlement?.status == .paid)
        #expect(try ledger.entries().count == 1)
        #expect(try ledger.entries().first?.state == .settled)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 0)
        let body = APIFixtures.bodyObject(try #require(stub?.requests.first))
        #expect(body["note"] as? String == Base64URL.encode(note.wire))
    }

    @Test("re-scanning a held note restores it to settle without a second reservation, also after a relaunch")
    func rescanRestores() async throws {
        let url = F.tempURL("ledger.json")
        let ledger = OfflineLedger(url: url)
        let note = try self.note(amount: 2_000_000)
        let (model, _) = makeModel(ledger: ledger)
        let ack = try await accept(note, on: model)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 2_000_000)

        model.nextPayment()
        await model.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(model.phase == .received)
        #expect(model.issue == nil)
        #expect(model.payment?.note.wire == note.wire)
        #expect(model.payment?.ack == ack)
        #expect(try ledger.entries().count == 1)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 2_000_000)

        // A relaunched phone that has not seen the allowance yet restores from the stored certificate,
        // with the stored ACK (its signer cannot sign).
        let reopened = OfflineLedger(url: url)
        let (fresh, _) = makeModel(ledger: reopened, signer: CancelledSigner(inner: merchant))
        await fresh.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(fresh.phase == .received)
        #expect(fresh.issue == nil)
        #expect(fresh.waitingNote == nil)
        #expect(fresh.payment?.ack == ack)
        #expect(try reopened.entries().count == 1)
        #expect(try reopened.unsettledTotal(allowanceId: F.allowanceId) == 2_000_000)

        // The re-scans freed nothing: 2.00 held plus 1.50 passes the 3.00 offline limit.
        fresh.nextPayment()
        await fresh.accept(text: allowanceText)
        await fresh.accept(text: PaymentTransport.encode(.note, try self.note(serial: 1, amount: 1_500_000).wire))
        #expect(fresh.issue?.kind == .payment(.offlineLimit))
        #expect(try reopened.unsettledTotal(allowanceId: F.allowanceId) == 2_000_000)
    }

    @Test("re-scanning a note the chain decided says already received; nothing comes back")
    func rescanDecided() async throws {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let note = try self.note()
        let (model, _) = makeModel(ledger: ledger, replies: [settledReply(note)])
        _ = try await accept(note, on: model)
        await model.settle()
        #expect(model.settlement?.status == .paid)
        model.nextPayment()
        #expect(model.unsettledPayments.isEmpty)
        await model.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(model.issue?.kind == .alreadyReceived)
        #expect(model.phase == .ready)
    }

    @Test("a note stored before certificates and ACKs were kept is listed, asks for its allowance, then settles")
    func entryWithoutStoredParts() async throws {
        let url = F.tempURL("ledger.json")
        let ledger = OfflineLedger(url: url)
        let note = try self.note()
        let certificate = try AllowanceCertificate.verify(wire: allowanceWire, deployment: F.deployment,
                                                          serverPublicKey: F.serverKey)
        // The earlier call shape: the record holds the note only.
        try ledger.accept(note: note, certificate: certificate, now: Int64(F.now.timeIntervalSince1970))
        #expect(try !String(contentsOf: url, encoding: .utf8).contains("allowanceWireHex"))
        let (model, stub) = makeModel(ledger: ledger, replies: [settledReply(note)])
        let row = try #require(model.unsettledPayments.first)
        #expect(row.certificate == nil)
        #expect(row.ack == nil)
        #expect(!model.canSettle(row))
        #expect(ReceiveModel.unsettledRowText(row, canSettle: false).contains("Scan its allowance code"))

        await model.settleUnsettled(noteId: note.noteId)
        #expect(model.issue?.kind == .allowanceNeeded)
        #expect(model.phase == .ready)
        #expect(stub?.requests.isEmpty == true)

        await model.accept(text: allowanceText)
        #expect(model.canSettle(row))
        await model.settleUnsettled(noteId: note.noteId)
        #expect(model.settlement?.status == .paid)
        #expect(model.payment?.ack != nil, "the ACK was signed first, since none was stored")
        #expect(try ledger.entries().first?.state == .settled)
    }

    @Test("a ledger that cannot be read is shown as unreadable, never as an empty list")
    func unreadableLedger() throws {
        let url = F.tempURL("ledger.json")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("damaged".utf8).write(to: url)
        let (model, _) = makeModel(ledger: OfflineLedger(url: url))
        #expect(model.unsettledPaymentsUnreadable)
        #expect(model.unsettledPayments.isEmpty)
        #expect(ReceiveModel.unsettledSummary(count: 0, total: 0, unlisted: 0, unreadable: true)
                .hasPrefix("This phone could not read its offline ledger"))
    }

    @Test("the list copy names the count, the total and the allowance, in plain words")
    func listCopy() {
        let summary = ReceiveModel.unsettledSummary(count: 2, total: 1_500_000, unlisted: 1, unreadable: false)
        #expect(summary.hasPrefix("2 notes, $1.50 sandbox, accepted offline and not settled yet."))
        #expect(summary.contains("1 more held note could not be read back"))
        #expect(ReceiveModel.unsettledSummary(count: 1, total: 1_000_000, unlisted: 0, unreadable: false)
                .hasPrefix("1 note, $1.00 sandbox"))
        let row = PreviewFixtures.unsettled(withAck: false)
        let text = ReceiveModel.unsettledRowText(row, canSettle: true)
        #expect(text.hasPrefix("Allowance #" + String(row.note.note.allowanceId) + ", received "))
        #expect(text.contains("Settling signs its receipt first."))
        for line in [summary, text, ReceiveModel.unsettledNextPaymentText] {
            #expect(!line.contains("\u{2014}") && !line.contains("\u{2013}"))
        }
    }
}
