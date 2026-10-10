import CryptoKit
import Foundation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// The LOW findings from the payment screen review (3.71). Each suite names the finding it covers.
@Suite("a Bluetooth text keeps its first arrival time when it goes back to the inbox (low finding 1)")
@MainActor
struct InboxArrivalTimeTests {
    let payer1 = SoftwareP256Signer()
    let payer2 = SoftwareP256Signer()
    let payer3 = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    func allowanceText(_ payer: SoftwareP256Signer, id: UInt64) -> String {
        PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash, id: id))
    }

    func noteText(_ payer: SoftwareP256Signer, id: UInt64) throws -> String {
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0, allowanceId: id)
        return PaymentTransport.encode(.note, note.wire)
    }

    @Test("a text cycled through two payments past the age limit is dropped and counted, never handed over")
    func cycledTextExpires() async throws {
        let clock = TestClock()
        let inbox = PaymentInbox(maxAge: 300, now: { clock.now })
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                                 deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox, now: { F.now })
        model.startInbox()

        // t = 0: payer 1 pays. Payer 2's codes and payer 3's allowance arrive during that payment.
        inbox.deliver(allowanceText(payer1, id: 11))
        inbox.deliver(try noteText(payer1, id: 11))
        await model.inboxDrained()
        #expect(model.phase == .received)
        let stale = allowanceText(payer3, id: 33)
        inbox.deliver(allowanceText(payer2, id: 22))
        inbox.deliver(try noteText(payer2, id: 22))
        inbox.deliver(stale)
        await model.inboxDrained()
        #expect(inbox.held.count == 3)

        // t = 200: Next payment. Payer 2 pays from the held codes; payer 3's allowance goes back.
        clock.now += 200
        model.nextPayment()
        await model.inboxDrained()
        #expect(model.phase == .received)
        #expect(model.payment?.certificate.allowanceId == 22)
        #expect(inbox.held == [stale])
        let dropsBefore = inbox.droppedWhileDetached

        // t = 350: 350 s after it first arrived, past the 300 s limit. It must not count from t = 200.
        clock.now += 150
        model.nextPayment()
        await model.inboxDrained()
        #expect(inbox.held.isEmpty)
        #expect(model.allowances[33] == nil, "the stale allowance was handed over")
        #expect(model.lastAllowance == nil)
        #expect(inbox.droppedWhileDetached == dropsBefore + 1)
    }

    @Test("a text held with an old arrival time is dropped at once, not kept until the next hold")
    func oldArrivalDroppedOnHold() {
        let clock = TestClock()
        let inbox = PaymentInbox(maxAge: 300, now: { clock.now })
        inbox.hold("old", arrivedAt: clock.now.addingTimeInterval(-301))
        #expect(inbox.held.isEmpty)
        #expect(inbox.droppedWhileDetached == 1)
        inbox.hold("fresh", arrivedAt: clock.now.addingTimeInterval(-299))
        #expect(inbox.held == ["fresh"])
    }
}

@Suite("another payer's waiting note is never dropped by a payment that goes through (low finding 2)")
@MainActor
struct WaitingNoteKeptTests {
    let payerA = SoftwareP256Signer()
    let payerB = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    func makeModel() -> ReceiveModel {
        ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                     ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                     deployment: F.deployment, serverPublicKey: F.serverKey, now: { F.now })
    }

    func text(_ kind: PaymentTransport.Kind, _ wire: Data) -> String { PaymentTransport.encode(kind, wire) }

    /// Payer B's note (allowance 88) waits; then payer A's allowance (77) is scanned.
    func noteBWaitsThenAllowanceA(_ model: ReceiveModel) async throws -> SignedNote {
        let noteB = try F.note(payer: payerB, payee: merchant.keyHash, amount: 700_000, serial: 0, allowanceId: 88)
        await model.accept(text: text(.note, noteB.wire))
        #expect(model.waitingNote == noteB)
        #expect(model.issue?.kind == .allowanceNeeded)
        await model.accept(text: text(.allowance, F.allowanceWire(payer: payerA.keyHash, id: 77)))
        return noteB
    }

    @Test("A's allowance keeps B's 'scan the allowance' step on screen")
    func allowanceKeepsStep() async throws {
        let model = makeModel()
        let noteB = try await noteBWaitsThenAllowanceA(model)
        #expect(model.lastAllowance?.allowanceId == 77)
        #expect(model.waitingNote == noteB)
        #expect(model.readyStep == .noteWaitingForAllowance)
        #expect(model.issue?.kind == .allowanceNeeded)
    }

    @Test("A pays while B's note waits: B's note is kept through Next payment and pays when 88 arrives")
    func paymentKeepsWaitingNote() async throws {
        let model = makeModel()
        let noteB = try await noteBWaitsThenAllowanceA(model)
        let noteA = try F.note(payer: payerA, payee: merchant.keyHash, amount: 1_000_000, serial: 0, allowanceId: 77)
        await model.accept(text: text(.note, noteA.wire))
        #expect(model.phase == .received)
        #expect(model.payment?.note == noteA)
        #expect(model.waitingNote == noteB, "B's note was dropped when A's note went through")

        model.nextPayment()
        #expect(model.phase == .ready)
        #expect(model.waitingNote == noteB)
        #expect(model.readyStep == .noteWaitingForAllowance)
        #expect(model.issue?.kind == .allowanceNeeded)

        await model.accept(text: text(.allowance, F.allowanceWire(payer: payerB.keyHash, id: 88)))
        #expect(model.phase == .received)
        #expect(model.payment?.note == noteB)
        #expect(model.waitingNote == nil)
    }
}

@Suite("Bluetooth drop and ignore counts start again at Next payment (low finding 3)")
@MainActor
struct InboxCountSnapshotTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    var allowanceText: String { PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)) }
    var markerText: String { PaymentTransport.encode(.marker, Data(repeating: 7, count: 238 + 153)) }

    func makeModel(_ inbox: PaymentInbox) -> ReceiveModel {
        ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                     ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                     deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox, now: { F.now })
    }

    /// Takes one payment over Bluetooth, leaving the screen on that payment.
    func pay(_ model: ReceiveModel, _ inbox: PaymentInbox, serial: UInt8) async throws {
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 100_000, serial: serial)
        inbox.deliver(allowanceText)
        inbox.deliver(PaymentTransport.encode(.note, note.wire))
        await model.inboxDrained()
        #expect(model.phase == .received)
    }

    @Test("one payer's drop and ignored marker are not shown to the next payer; new ones are")
    func countsSinceNextPayment() async throws {
        let inbox = PaymentInbox()
        let model = makeModel(inbox)
        model.startInbox()
        try await pay(model, inbox, serial: 0)

        // During the payment: a marker, and one more held code than the inbox can keep.
        let allowance = allowanceText
        inbox.deliver(markerText)
        for _ in 0...PaymentInbox.capacity { inbox.deliver(allowance) }
        await model.inboxDrained()
        #expect(model.inboxDropped == 1)
        #expect(model.inboxIgnored == 1)
        #expect(model.inboxWaiting == PaymentInbox.capacity)
        #expect(model.inboxLine != nil)

        model.nextPayment()
        await model.inboxDrained()
        #expect(model.inboxDropped == 0)
        #expect(model.inboxIgnored == 0)
        #expect(model.inboxLine == nil, "the last payer's drop is still on the next payer's screen")

        // The next payer's own drop and marker are counted from zero.
        try await pay(model, inbox, serial: 1)
        inbox.deliver(markerText)
        for _ in 0...PaymentInbox.capacity { inbox.deliver(allowance) }
        await model.inboxDrained()
        #expect(model.inboxDropped == 1)
        #expect(model.inboxIgnored == 1)
        #expect(inbox.droppedWhileDetached == 2)
    }

    @Test("a held code that expires as Next payment releases it counts for the next payer")
    func expiryAtReleaseCounts() async throws {
        let clock = TestClock()
        let inbox = PaymentInbox(maxAge: 300, now: { clock.now })
        let model = makeModel(inbox)
        model.startInbox()
        try await pay(model, inbox, serial: 0)
        inbox.deliver(allowanceText)
        await model.inboxDrained()
        #expect(model.inboxWaiting == 1)
        clock.now += 301
        model.nextPayment()
        await model.inboxDrained()
        #expect(model.inboxWaiting == 0)
        #expect(model.inboxDropped == 1)
        #expect(model.inboxLine?.hasPrefix("Bluetooth codes dropped before this screen could check them: 1 ") == true)
    }
}

@Suite("Bluetooth texts that can never be accepted are counted, never held (low finding 4)")
@MainActor
struct InboxJunkTests {
    let payer = SoftwareP256Signer()
    let payerB = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    var allowanceText: String { PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)) }

    /// Eight texts that fail to parse and eight that parse as A or N but fail their own checks.
    func junk() throws -> [String] {
        var tampered = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 9).wire
        tampered[141 + 10] ^= 0x01  // a byte of r
        let parseFailures = [
            "hello", "L1|P|1|N|AAA=", "L1|P|1|N|AA+/", "L1|P|1|A|A A",
            "L1|P|1|N|" + String(repeating: "A", count: ScanParser.maxLength), "L1|T|abc|aGk", "", "L1|P|1|A",
        ]
        let checkFailures = [
            "L1|P|1|N|AAAA", "L1|P|1|A|AAAA", PaymentTransport.encode(.note, tampered),
            PaymentTransport.encode(.note, Data(repeating: 1, count: 238)),
            PaymentTransport.encode(.allowance, Data(repeating: 2, count: 300)),
            // Signed by a stranger, not the pinned server key.
            PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash,
                                                                signedBy: Curve25519.Signing.PrivateKey())),
            PaymentTransport.encode(.note, Data(repeating: 3, count: 10)),
            PaymentTransport.encode(.allowance, Data(repeating: 4, count: 10)),
        ]
        return parseFailures + checkFailures
    }

    @Test("a junk burst during a payment does not push a real held note out of the inbox")
    func junkBurstKeepsRealNote() async throws {
        let inbox = PaymentInbox()
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                                 deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox, now: { F.now })
        model.startInbox()
        let paid = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        inbox.deliver(allowanceText)
        inbox.deliver(PaymentTransport.encode(.note, paid.wire))
        await model.inboxDrained()
        #expect(model.phase == .received)

        // Payer B's real note arrives during the payment, then as many junk texts as the inbox holds.
        let noteB = try F.note(payer: payerB, payee: merchant.keyHash, amount: 600_000, serial: 0, allowanceId: 88)
        let noteBText = PaymentTransport.encode(.note, noteB.wire)
        let burst = try junk()
        #expect(burst.count == PaymentInbox.capacity)
        inbox.deliver(noteBText)
        for text in burst { inbox.deliver(text) }
        await model.inboxDrained()
        #expect(inbox.held == [noteBText])
        #expect(inbox.droppedWhileDetached == 0)
        #expect(model.inboxUnreadable == burst.count)
        #expect(model.issue == nil)
        #expect(model.inboxLine?.contains("not valid payment codes: 16") == true)

        // Next payment: B's note is checked, and no junk shows as Stopped on B's screen.
        model.nextPayment()
        await model.inboxDrained()
        #expect(model.waitingNote == noteB, "the real note was pushed out by junk")
        #expect(model.issue?.kind == .allowanceNeeded)
        #expect(model.inboxUnreadable == 0)
    }

    @Test("the unreadable count has its own sentence in the inbox line")
    func lineWording() {
        #expect(ReceiveModel.inboxLine(dropped: 0, ignored: 0, unreadable: 2, maxAge: 300)
                == "Bluetooth texts that were not valid payment codes: 2 (damaged, or not LOKA codes). "
                + "Ask the payer to send again if one was theirs.")
    }
}
