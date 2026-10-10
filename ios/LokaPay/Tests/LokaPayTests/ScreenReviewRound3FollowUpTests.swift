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
