import CryptoKit
import Foundation
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
        #expect(model.readyStep == .waitingForBoth)

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
        #expect(model.readyStep == .waitingForBoth)

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
