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
