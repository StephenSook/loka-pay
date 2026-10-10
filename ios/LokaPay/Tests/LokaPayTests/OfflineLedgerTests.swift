import Foundation
import Testing
@testable import LokaPay

@Suite("offline-limit ledger (2.20)")
struct OfflineLedgerTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    func certificate(limit: UInt64) -> AllowanceCertificate {
        AllowanceCertificate(allowanceId: 77, payerKeyHash: payer.keyHash, cap: 5_000_000, offlineLimit: limit,
                             expiry: 1_893_456_000, earmarks: [], bond: 0)
    }

    func note(serial: UInt8, amount: UInt64, allowance: UInt64 = 77) throws -> SignedNote {
        try SignedNote.sign(NoteV1(deployment: Vectors.deployment, allowanceId: allowance, payeeKeyHash: merchant.keyHash,
                                   amount: amount, serial: serial, expiry: 1_893_456_000), with: payer)
    }

    func freshURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("ledger.json")
    }

    @Test("accepts up to the offline limit, then refuses and changes nothing")
    func limit() throws {
        let ledger = OfflineLedger(url: freshURL())
        let cert = certificate(limit: 2_000_000)
        try ledger.accept(note: note(serial: 0, amount: 1_250_000), certificate: cert, now: 1)
        try ledger.accept(note: note(serial: 1, amount: 750_000), certificate: cert, now: 2)
        #expect(try ledger.unsettledTotal(allowanceId: 77) == 2_000_000)
        #expect(throws: PaymentError.offlineLimit) {
            try ledger.accept(note: note(serial: 2, amount: 1), certificate: cert, now: 3)
        }
        #expect(try ledger.entries().count == 2)
    }

    @Test("a serial is accepted once per allowance, even after it settles")
    func serialSeen() throws {
        let ledger = OfflineLedger(url: freshURL())
        let cert = certificate(limit: 5_000_000)
        let first = try note(serial: 4, amount: 100)
        try ledger.accept(note: first, certificate: cert, now: 1)
        #expect(throws: PaymentError.serialSeen) {
            try ledger.accept(note: note(serial: 4, amount: 200), certificate: cert, now: 2)
        }
        try ledger.resolve(noteId: first.noteId, as: .settled)
        #expect(throws: PaymentError.serialSeen) {
            try ledger.accept(note: note(serial: 4, amount: 200), certificate: cert, now: 3)
        }
    }

    @Test("settled and refused notes free capacity; pending ones survive a relaunch")
    func resolveAndRelaunch() throws {
        let url = freshURL()
        let cert = certificate(limit: 1_000_000)
        let a = try note(serial: 0, amount: 600_000)
        let b = try note(serial: 1, amount: 400_000)
        try OfflineLedger(url: url).accept(note: a, certificate: cert, now: 10)
        try OfflineLedger(url: url).accept(note: b, certificate: cert, now: 20)
        let reopened = OfflineLedger(url: url)
        #expect(try reopened.unsettledTotal(allowanceId: 77) == 1_000_000)
        #expect(try reopened.pending().map(\.serial) == [0, 1])
        #expect(try reopened.pending().first?.wireHex == a.wire.hex)
        try reopened.resolve(noteId: a.noteId, as: .settled)
        try reopened.resolve(noteId: b.noteId, as: .refused)
        #expect(try reopened.unsettledTotal(allowanceId: 77) == 0)
        try reopened.accept(note: note(serial: 2, amount: 1_000_000), certificate: cert, now: 30)
    }

    @Test("a note for another allowance is refused, and a corrupt ledger never reads as empty")
    func refusals() throws {
        let url = freshURL()
        let ledger = OfflineLedger(url: url)
        #expect(throws: PaymentError.allowanceMismatch) {
            try ledger.accept(note: note(serial: 0, amount: 1, allowance: 78), certificate: certificate(limit: 10), now: 1)
        }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: url)
        #expect(throws: PaymentError.storage) { try ledger.unsettledTotal(allowanceId: 77) }
    }
}
