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
