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
