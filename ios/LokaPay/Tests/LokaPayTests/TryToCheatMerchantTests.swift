import Foundation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// A CONF with a chosen transaction signature (all zeros means none came with it).
private func confWire(noteId: Data, status: UInt8, errorCode: UInt16, tx: Data) -> Data {
    var w = ByteWriter()
    w.ascii(Confirmation.prefix, count: 16)
    w.bytes(noteId, count: 32)
    w.bytes(tx, count: 64)
    w.u64(412_000_000)
    w.i64(1_800_000_065)
    w.i64(1_800_000_060)
    w.u8(status)
    w.u16(errorCode)
    return w.data + F.sign(w.data, nil)
}

@Suite("Try to cheat: merchant B accepts offline, Solana refuses (2.13)")
@MainActor
struct TryToCheatMerchantTests {
    let payer = SoftwareP256Signer()
    let merchantA = SoftwareP256Signer()
    let merchantB = SoftwareP256Signer()

    /// The cheat pair: the original note to merchant A and the same serial signed again for B.
    func pair() throws -> (original: SignedNote, cheat: SignedNote) {
        let original = try F.note(payer: payer, payee: merchantA.keyHash, amount: 1_250_000, serial: 0)
        var body = original.note
        body.payeeKeyHash = merchantB.keyHash
        return (original, try SignedNote.sign(body, with: payer))
    }

    /// Merchant B's Receive model with the payer's allowance scanned.
    func merchantBModel(_ replies: [StubReply]) async -> (ReceiveModel, OfflineLedger) {
        let ledger = OfflineLedger(url: F.tempURL("ledger.json"))
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchantB.keyHash, name: "Stall B"), signer: merchantB,
                                 ledger: ledger, settlementClient: APIFixtures.client(StubTransport(replies), retry: .never),
                                 deployment: F.deployment, serverPublicKey: F.serverKey, now: { F.now })
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        return (model, ledger)
    }

    @Test("merchant B accepts the genuine cheat note offline; a verified SerialUsed CONF shows Failed (already spent) with the explorer link")
    func alreadySpent() async throws {
        let (_, cheat) = try pair()
        let conf = F.confWire(noteId: cheat.noteId, status: 2, errorCode: LokaVaultError.serialUsed)
        let body = F.decisionBody(conf: conf, noteId: cheat.noteId, jsonStatus: "failed", error: "SerialUsed")
        let (model, ledger) = await merchantBModel([StubReply(status: 200, body: body)])

        await model.accept(text: PaymentTransport.encode(.note, cheat.wire))
        #expect(model.issue == nil)
        #expect(model.phase == .received)
        #expect(model.payment?.ack != nil)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 1_250_000)

        await model.settle()
        #expect(model.phase == .settled)
        let settlement = try #require(model.settlement)
        #expect(settlement.status == .failed)
        #expect(settlement.reasonUnsigned == "SerialUsed")
        let facts = settlement.facts(clusterId: F.deployment.clusterId)
        #expect(facts.errorCode == 6011)
        #expect(facts.errorName == "SerialUsed")
        #expect(facts.statusDetail == "already spent")
        #expect(facts.errorCodeText == "6011 (SerialUsed)")
        #expect(MoneyStatusChip.word(settlement.status, detail: facts.statusDetail) == "Failed (already spent)")
        #expect(MoneyStatusChip.accessibilityLabel(settlement.status, detail: facts.statusDetail)
                == "Status: failed, already spent. Sandbox.")
        let line = try #require(facts.chainLine)
        #expect(line.contains("program error SerialUsed, code 6011"))
        #expect(line.contains("server-signed confirmation"))
        #expect(!settlement.receiptCaption.contains("Settled"))

        // The link is the failed transaction from the signed CONF (64 bytes of 7 in the fixture).
        let explorer = try #require(facts.explorer).absoluteString
        #expect(explorer.hasPrefix("https://explorer.solana.com/tx/"))
        #expect(explorer.hasSuffix("?cluster=devnet"))
        let signature = String(explorer.dropFirst("https://explorer.solana.com/tx/".count).dropLast("?cluster=devnet".count))
        #expect(Base58.decode(signature, maxBytes: 64) == Data(repeating: 7, count: 64))

        // The chain decided: the note is released from merchant B's offline ledger as refused.
        #expect(try ledger.entries().first?.state == .refused)
        #expect(try ledger.unsettledTotal(allowanceId: F.allowanceId) == 0)
    }

    @Test("without SerialUsed in the signed CONF the screen never says already spent, whatever the JSON says")
    func noUnsignedClaim() async throws {
        let (_, cheat) = try pair()
        let honest = "Failed on chain. The transaction was refused; open it on the explorer to see why."
        let cases: [(UInt16, String?, (ReceiptFacts) -> Bool)] = [
            (0, "SerialUsed", { $0.chainLine == honest && $0.errorCodeText == nil && $0.errorName == nil }),
            (6013, nil, { $0.errorName == "Expired" && $0.chainLine?.contains("program error Expired (code 6013") == true }),
            (42, nil, { $0.errorName == nil && $0.chainLine?.contains("not one of the program's named errors") == true }),
        ]
        for (code, jsonError, check) in cases {
            let conf = F.confWire(noteId: cheat.noteId, status: 2, errorCode: code)
            let body = F.decisionBody(conf: conf, noteId: cheat.noteId, jsonStatus: "failed", error: jsonError)
            let (model, _) = await merchantBModel([StubReply(status: 200, body: body)])
            await model.accept(text: PaymentTransport.encode(.note, cheat.wire))
            await model.settle()
            let settlement = try #require(model.settlement, "code \(code)")
            #expect(settlement.status == .failed)
            let facts = settlement.facts(clusterId: 0)
            #expect(facts.statusDetail == nil, "code \(code)")
            #expect(MoneyStatusChip.word(.failed, detail: facts.statusDetail) == "Failed", "code \(code)")
            #expect(facts.chainLine?.contains("already spent") == false, "code \(code)")
            #expect(facts.explorer != nil)
            #expect(check(facts), "code \(code): \(facts.chainLine ?? "nil")")
        }
    }

    @Test("a failed CONF with no transaction signature says there is no explorer link")
    func noExplorerLink() async throws {
        let (_, cheat) = try pair()
        let conf = confWire(noteId: cheat.noteId, status: 2, errorCode: LokaVaultError.serialUsed, tx: Data(count: 64))
        let (model, _) = await merchantBModel([StubReply(status: 200, body: F.decisionBody(conf: conf, noteId: cheat.noteId,
                                                                                           jsonStatus: "failed"))])
        await model.accept(text: PaymentTransport.encode(.note, cheat.wire))
        await model.settle()
        let facts = try #require(model.settlement).facts(clusterId: 0)
        #expect(facts.explorer == nil)
        #expect(facts.statusDetail == "already spent")
        #expect(facts.chainLine?.contains("no explorer link") == true)
        #expect(facts.chainLine?.contains("opens on the explorer") == false)
    }
}

@Suite("program error names match programs/idl/loka_vault.json (2.13)")
struct ProgramErrorTableTests {
    @Test("the table is the IDL's errors list, and 6011 is SerialUsed")
    func matchesIDL() throws {
        // ios/LokaPay/Tests/LokaPayTests/TryToCheatMerchantTests.swift -> repo root is five levels up.
        let repo = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: repo.appendingPathComponent("programs/idl/loka_vault.json"))
        let root = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let errors = try #require(root["errors"] as? [[String: Any]])
        // A floor, so an empty or unread list cannot pass: the IDL lists 23 errors today.
        #expect(errors.count >= 23)
        var fromIDL: [UInt16: String] = [:]
        for error in errors {
            let number = try #require(error["code"] as? Int)
            let code = try #require(UInt16(exactly: number))
            let name = try #require(error["name"] as? String)
            fromIDL[code] = name
        }
        #expect(fromIDL.count == errors.count)
        #expect(fromIDL == LokaVaultError.names)
        #expect(fromIDL[LokaVaultError.serialUsed] == "SerialUsed")
        #expect(LokaVaultError.name(code: 6011) == "SerialUsed")
        #expect(LokaVaultError.name(code: 0) == nil)
    }
}
