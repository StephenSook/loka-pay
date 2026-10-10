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
