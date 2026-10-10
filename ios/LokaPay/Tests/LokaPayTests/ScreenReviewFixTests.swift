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
