import CryptoKit
import Foundation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// TEST-ONLY: an ALLOW wire for any program, cluster and mint, signed with the vector server key
/// (a public test label, never a real key) unless `other` signs it.
private func allowWire(payer: Data, id: UInt64, cap: UInt64 = 1_000_000, offlineLimit: UInt64 = 1_000_000,
                       expiry: Int64 = F.expiry, earmarks: [Data] = [], programId: Data = F.deployment.programId,
                       clusterId: UInt8 = F.deployment.clusterId, mint: Data = F.deployment.mint,
                       signedBy other: Curve25519.Signing.PrivateKey? = nil) -> Data {
    let list = try! Earmarks.encode(earmarks)
    var w = ByteWriter()
    w.ascii(AllowanceCertificate.prefix, count: 16)
    w.bytes(programId, count: 32)
    w.u8(clusterId)
    w.bytes(mint, count: 32)
    w.u64(id)
    w.bytes(payer, count: 32)
    w.u64(cap)
    w.u64(offlineLimit)
    w.i64(expiry)
    w.bytes(Earmarks.hash(list), count: 32)
    w.u64(0)
    return w.data + F.sign(w.data, other) + list
}

private func code(_ wire: Data) -> String { PaymentTransport.encode(.allowance, wire) }

@Suite("Pay: show the allowance id and import a sender's allowance (Script B)")
@MainActor
struct AllowanceImportTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()
    /// The registration allowance (id 77), built once: CryptoKit's Ed25519 signatures are randomized.
    let setupWire: Data
    let folder: URL

    init() {
        setupWire = F.allowanceWire(payer: payer.keyHash)
        folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    var serials: SerialReservations { SerialReservations(url: folder.appendingPathComponent("serials.json")) }
    var storeURL: URL { folder.appendingPathComponent(ImportedAllowances.fileName) }

    func makeModel(now: Date = F.now) -> PayModel {
        PayModel(allowanceWire: setupWire, signer: payer, serials: serials, deployment: F.deployment,
                 serverPublicKey: F.serverKey, locale: Locale(identifier: "en_US_POSIX"), now: { now })
    }

    var merchantText: String { PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchant.keyHash)) }

    // MARK: Import

    @Test("a valid ALLOW for this key imports, is stored next to the serials, and Pay uses it; the setup one stays")
    func importsAndSelects() async throws {
        let model = makeModel()
        #expect(model.allowance?.certificate.allowanceId == F.allowanceId)
        let wire = allowWire(payer: payer.keyHash, id: 9_001, cap: 1_000_000, earmarks: [merchant.keyHash])
        model.importAllowance(text: code(wire))
        #expect(model.issue == nil)
        #expect(model.allowances.map(\.certificate.allowanceId) == [F.allowanceId, 9_001])
        #expect(model.allowances[0].wire == setupWire)
        #expect(model.allowances[0].importedAt == nil)
        #expect(model.allowance?.certificate.allowanceId == 9_001)
        #expect(model.allowance?.importedAt == Int64(F.now.timeIntervalSince1970))
        #expect(model.importNote?.contains("Added allowance #9001") == true)
        #expect(model.importNote?.contains("$1.00 sandbox") == true)
        #expect(try ImportedAllowances(url: storeURL).load().map(\.wire) == [wire])

        // It pays its earmarked merchant, with its own id and cap, from serial 0.
        model.acceptMerchant(text: merchantText)
        #expect(model.phase == .enterAmount)
        model.amountText = "1.50"
        #expect(model.amountCheck == .failure(.overCap))
        model.amountText = "0.75"
        await model.pay()
        let note = try #require(model.payment?.note)
        #expect(note.note.allowanceId == 9_001)
        #expect(note.note.serial == 0)
        #expect(note.note.expiry == F.expiry)
        // Code 1 handed to the merchant is the imported certificate, exactly as scanned.
        #expect(try PaymentTransport.decode(try #require(model.payment?.allowanceText))?.payload == wire)
        // The setup allowance's id is still the one a sender needs.
        #expect(model.setupAllowanceId == F.allowanceId)
        #expect(model.allowanceIdCodeText == "LOKA-ALLOWANCE:77")
    }

    @Test("each refusal is named, stores nothing and leaves the allowance Pay uses unchanged")
    func refusals() throws {
        let other = SoftwareP256Signer()
        let rogue = Curve25519.Signing.PrivateKey()
        let good = allowWire(payer: payer.keyHash, id: 500)
        let cases: [(String, MoneyIssueKind)] = [
            (code(allowWire(payer: payer.keyHash, id: 500, signedBy: rogue)), .importRefused(.badSignature)),
            (code(allowWire(payer: other.keyHash, id: 500)), .importRefused(.otherKey)),
            (code(allowWire(payer: payer.keyHash, id: 500, programId: Data(repeating: 9, count: 32))),
             .importRefused(.wrongProgram)),
            (code(allowWire(payer: payer.keyHash, id: 500, clusterId: 1)), .importRefused(.wrongCluster)),
            (code(allowWire(payer: payer.keyHash, id: 500, mint: Data(repeating: 8, count: 32))),
             .importRefused(.wrongMint)),
            (code(allowWire(payer: payer.keyHash, id: 500, expiry: Int64(F.now.timeIntervalSince1970) - 1)),
             .importRefused(.expired)),
            (code(Data(good.prefix(200))), .importRefused(.malformed)),
            (code(good + Data([0])), .importRefused(.malformed)),
            (code(Data(good.prefix(249)) + Data([0x00, 0x01]) + Data(repeating: 3, count: 32)), .importRefused(.malformed)),
            ("L1|P|1|A|not=base64", .importRefused(.malformed)),
            ("LOKA-ALLOWANCE:500", .importRefused(.malformed)),
            ("hello", .importRefused(.malformed)),
            (merchantText, .wrongKind(expected: [.allowance], got: .merchant)),
        ]
        for (text, kind) in cases {
            let model = makeModel()
            model.importAllowance(text: text)
            #expect(model.issue?.kind == kind, "\(kind)")
            #expect(model.allowances.count == 1)
            #expect(model.allowance?.certificate.allowanceId == F.allowanceId)
            #expect(model.importNote == nil)
            #expect(model.phase == .scanMerchant)
        }
        #expect(!FileManager.default.fileExists(atPath: storeURL.path))
        #expect(MoneyIssueKind.importRefused(.otherKey).name == "import_other_key")
        #expect(MoneyIssueKind.importRefused(.badSignature).refusedBy == .thisPhone)
    }

    @Test("the same certificate again is not a second allowance; a different one for a held id is refused")
    func duplicatesAndConflicts() throws {
        let model = makeModel()
        // This phone's own code 1 (the setup allowance) scanned back.
        model.importAllowance(text: code(setupWire))
        #expect(model.issue == nil)
        #expect(model.allowances.count == 1)
        #expect(model.importNote?.contains("already on this phone") == true)
        #expect(!FileManager.default.fileExists(atPath: storeURL.path))

        let wire = allowWire(payer: payer.keyHash, id: 600)
        model.importAllowance(text: code(wire))
        model.selectAllowance(id: F.allowanceId)
        model.importAllowance(text: code(wire))
        #expect(model.allowance?.certificate.allowanceId == 600)
        #expect(try ImportedAllowances(url: storeURL).load().count == 1)

        // Same ids, different terms: refused, nothing replaced.
        model.importAllowance(text: code(allowWire(payer: payer.keyHash, id: 600, cap: 2_000_000)))
        #expect(model.issue?.kind == .importRefused(.conflict))
        model.importAllowance(text: code(F.allowanceWire(payer: payer.keyHash, cap: 9_000_000)))
        #expect(model.issue?.kind == .importRefused(.conflict))
        #expect(try ImportedAllowances(url: storeURL).load().map(\.wire) == [wire])
        #expect(model.allowances.map(\.wire) == [setupWire, wire])
    }

    @Test("no import or switch while a signed note is on screen")
    func lockedWhileNoteShown() async throws {
        let model = makeModel()
        model.acceptMerchant(text: merchantText)
        model.amountText = "1"
        await model.pay()
        #expect(model.phase == .showNote)
        #expect(!model.canChangeAllowance)
        model.importAllowance(text: code(allowWire(payer: payer.keyHash, id: 700)))
        #expect(model.allowances.count == 1)
        #expect(!FileManager.default.fileExists(atPath: storeURL.path))
    }

    // MARK: Persistence

    @Test("imported allowances survive a relaunch; the newest unexpired one is the default")
    func persistsAcrossReload() throws {
        let first = makeModel()
        let older = allowWire(payer: payer.keyHash, id: 801, expiry: F.expiry)
        let newer = allowWire(payer: payer.keyHash, id: 802, expiry: 1_800_000_500)
        first.importAllowance(text: code(older))
        first.importAllowance(text: code(newer))
        #expect(first.allowance?.certificate.allowanceId == 802)

        let reloaded = makeModel()
        #expect(reloaded.issue == nil)
        #expect(reloaded.allowances.map(\.certificate.allowanceId) == [F.allowanceId, 801, 802])
        #expect(reloaded.allowances.map(\.wire) == [setupWire, older, newer])
        #expect(reloaded.allowance?.certificate.allowanceId == 802)
        #expect(reloaded.setupAllowanceId == F.allowanceId)

        // After 802 expires it is no longer offered, and 801 (still valid) is the default.
        let later = makeModel(now: Date(timeIntervalSince1970: 1_800_001_000))
        #expect(later.allowances.map(\.certificate.allowanceId) == [F.allowanceId, 801])
        #expect(later.allowance?.certificate.allowanceId == 801)
        // The store keeps everything; only the offer changes.
        #expect(try ImportedAllowances(url: storeURL).load().count == 2)
    }

    @Test("a stored wire for another key or signed by a stranger is never offered after a reload")
    func reloadReverifies() throws {
        let store = ImportedAllowances(url: storeURL)
        let rogue = Curve25519.Signing.PrivateKey()
        try store.add(allowWire(payer: SoftwareP256Signer().keyHash, id: 901), importedAt: 1)
        try store.add(allowWire(payer: payer.keyHash, id: 902, signedBy: rogue), importedAt: 2)
        try store.add(allowWire(payer: payer.keyHash, id: 903, clusterId: 1), importedAt: 3)
        let model = makeModel()
        #expect(model.allowances.map(\.certificate.allowanceId) == [F.allowanceId])
        #expect(model.allowance?.certificate.allowanceId == F.allowanceId)
        #expect(model.phase == .scanMerchant)
    }

    @Test("an unreadable store is reported, Pay keeps the setup allowance, and an import never overwrites it")
    func corruptStore() throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let junk = Data("{not json".utf8)
        try junk.write(to: storeURL)
        let model = makeModel()
        #expect(model.phase == .scanMerchant)
        #expect(model.issue?.kind == .importRefused(.storeUnreadable))
        #expect(model.allowance?.certificate.allowanceId == F.allowanceId)
        model.importAllowance(text: code(allowWire(payer: payer.keyHash, id: 1_001)))
        #expect(model.issue?.kind == .importRefused(.storage))
        #expect(model.allowances.count == 1)
        #expect(try Data(contentsOf: storeURL) == junk)
    }

    // MARK: Allowance id code

    @Test("the allowance id code round-trips and refuses anything not canonical")
    func allowanceIdCode() {
        for id: UInt64 in [0, 7, 77, 1_234_567_890, UInt64.max] {
            #expect(AllowanceIdCode.decode(AllowanceIdCode.encode(id)) == id)
        }
        #expect(AllowanceIdCode.encode(18_446_744_073_709_551_615) == "LOKA-ALLOWANCE:18446744073709551615")
        #expect(AllowanceIdCode.decode(" LOKA-ALLOWANCE:42\n") == 42)
        for bad in ["LOKA-ALLOWANCE:", "LOKA-ALLOWANCE:01", "LOKA-ALLOWANCE:-1", "LOKA-ALLOWANCE:+1",
                    "LOKA-ALLOWANCE:18446744073709551616", "loka-allowance:5", "LOKA-ALLOWANCE: 5",
                    "LOKA-ALLOWANCE:5x", "LOKA-ALLOWANCE:\u{0665}", "LOKA-ALLOWANCE:1,000", "42",
                    "L1|P|1|A|AAAA"] {
            #expect(AllowanceIdCode.decode(bad) == nil, "\(bad)")
        }
    }

    @Test("Pay shows the setup allowance's id code, not the allowance it switched to")
    func showsSetupId() {
        let model = makeModel()
        #expect(model.allowanceIdCodeText == AllowanceIdCode.encode(F.allowanceId))
        model.importAllowance(text: code(allowWire(payer: payer.keyHash, id: 4_242)))
        #expect(model.allowance?.certificate.allowanceId == 4_242)
        #expect(model.allowanceIdCodeText == "LOKA-ALLOWANCE:77")
        #expect(AllowanceIdCode.decode(model.allowanceIdCodeText ?? "") == F.allowanceId)
    }

    // MARK: Serials and selection

    @Test("serials stay per allowance id: an imported allowance starts at 0 and never moves the setup counter")
    func serialsPerAllowance() async throws {
        let model = makeModel()
        model.acceptMerchant(text: merchantText)
        for amount in ["1", "1"] {
            model.amountText = amount
            await model.pay()
            model.newPayment()
        }
        model.importAllowance(text: code(allowWire(payer: payer.keyHash, id: 3_003)))
        #expect(model.notesSigned == 0)
        model.amountText = "0.50"
        await model.pay()
        #expect(model.payment?.note.note.allowanceId == 3_003)
        #expect(model.payment?.note.note.serial == 0)
        model.newPayment()
        model.selectAllowance(id: F.allowanceId)
        #expect(model.notesSigned == 2)
        model.amountText = "0.25"
        await model.pay()
        #expect(model.payment?.note.note.allowanceId == F.allowanceId)
        #expect(model.payment?.note.note.serial == 2)
        #expect(try serials.remaining(allowanceId: F.allowanceId) == 253)
        #expect(try serials.remaining(allowanceId: 3_003) == 255)
    }

    @Test("switching to an allowance that cannot pay the chosen merchant goes back to the merchant scan")
    func selectionAndEarmarks() throws {
        let model = makeModel()
        model.acceptMerchant(text: merchantText)
        #expect(model.phase == .enterAmount)
        model.amountText = "1"
        let elsewhere = SoftwareP256Signer().keyHash
        model.importAllowance(text: code(allowWire(payer: payer.keyHash, id: 5_005, earmarks: [elsewhere])))
        #expect(model.allowance?.certificate.allowanceId == 5_005)
        #expect(model.phase == .scanMerchant)
        #expect(model.merchant == nil)
        #expect(model.amountText == "")
        // Its earmark list names the merchant it allows: by name once verified here, else by key hash.
        let line = PayModel.earmarkLine(try #require(model.allowance?.certificate), names: model.knownMerchantNames)
        #expect(line == "Only for: key " + String(elsewhere.hex.prefix(8)) + "...")
        model.acceptMerchant(text: merchantText)
        #expect(model.issue?.kind == .payment(.notEarmarked))
        model.selectAllowance(id: F.allowanceId)
        model.acceptMerchant(text: merchantText)
        #expect(model.phase == .enterAmount)
        let named = try AllowanceCertificate.verify(
            wire: allowWire(payer: payer.keyHash, id: 1, earmarks: [merchant.keyHash, elsewhere]),
            deployment: F.deployment, serverPublicKey: F.serverKey)
        let both = PayModel.earmarkLine(named, names: model.knownMerchantNames)
        #expect(both.hasPrefix("Only for: "))
        #expect(both.contains("Test Stall"))
        #expect(both.contains("key " + String(elsewhere.hex.prefix(8)) + "..."))
        #expect(PayModel.earmarkLine(F.setupCertificate(payer: payer.keyHash), names: [:]) == "Any merchant")
        model.selectAllowance(id: 123_456)
        #expect(model.allowance?.certificate.allowanceId == F.allowanceId)
    }

    @Test("the default skips an import with no serial left")
    func defaultSkipsExhausted() throws {
        let setup = try PayerAllowance(wire: setupWire, deployment: F.deployment, serverPublicKey: F.serverKey)
        let a = try PayerAllowance(wire: allowWire(payer: payer.keyHash, id: 1), deployment: F.deployment,
                                   serverPublicKey: F.serverKey, importedAt: 10)
        let b = try PayerAllowance(wire: allowWire(payer: payer.keyHash, id: 2), deployment: F.deployment,
                                   serverPublicKey: F.serverKey, importedAt: 20)
        #expect(PayModel.defaultChoice([setup, a, b], serialsLeft: { _ in 256 }) == b)
        #expect(PayModel.defaultChoice([setup, a, b], serialsLeft: { $0 == 2 ? 0 : 256 }) == a)
        #expect(PayModel.defaultChoice([setup, a, b], serialsLeft: { _ in nil }) == setup)
        #expect(PayModel.defaultChoice([setup], serialsLeft: { _ in 256 }) == setup)
    }
}

private extension ScreenFixtures {
    static func setupCertificate(payer: Data) -> AllowanceCertificate {
        try! AllowanceCertificate.verify(wire: allowanceWire(payer: payer), deployment: deployment, serverPublicKey: serverKey)
    }
}
