import CryptoKit
import Foundation
import Testing
@testable import LokaPay

/// Shared vectors: protocol/vectors/payment-v1.json, read from the repo (no copy to drift).
enum Vectors {
    static let root: [String: Any] = {
        // ios/LokaPay/Tests/LokaPayTests/VectorTests.swift -> repo root is five levels up.
        let repo = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = repo.appendingPathComponent("protocol/vectors/payment-v1.json")
        let data = try! Data(contentsOf: url)
        return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    }()

    static func list(_ key: String) -> [[String: Any]] { root[key] as! [[String: Any]] }
    static var constants: [String: Any] { root["constants"] as! [String: Any] }
    static var keys: [String: Any] { root["keys"] as! [String: Any] }

    static func hex(_ any: Any?) -> Data { Data(hex: any as! String)! }
    static func u64(_ any: Any?) -> UInt64 { UInt64(any as! String)! }
    static func i64(_ any: Any?) -> Int64 { Int64(any as! String)! }

    static var deployment: Deployment {
        Deployment(programId: hex(constants["programIdHex"]), clusterId: 0, mint: hex(constants["mintHex"]))
    }

    static var serverKey: Data { hex((keys["serverEd25519"] as! [String: Any])["publicKeyHex"]) }
}

@Suite("NOTE_V1 vectors")
struct NoteVectorTests {
    @Test("every valid note re-encodes byte-exact and validates")
    func validNotes() throws {
        let notes = Vectors.list("notes")
        #expect(notes.count >= 4)
        for n in notes {
            let f = n["fields"] as! [String: Any]
            let note = NoteV1(deployment: Vectors.deployment,
                              allowanceId: Vectors.u64(f["allowanceId"]),
                              payeeKeyHash: Vectors.hex(f["payeeKeyHashHex"]),
                              amount: Vectors.u64(f["amount"]),
                              serial: UInt8(f["serial"] as! Int),
                              expiry: Vectors.i64(f["expiry"]))
            #expect(note.encoded() == Vectors.hex(n["noteHex"]), "\(n["name"]!)")
            #expect(note.encoded().count == 141)
            #expect(note.noteId == Vectors.hex(n["noteIdHex"]))
            #expect(try NoteV1.decode(Vectors.hex(n["noteHex"])) == note)

            let signed = try SignedNote.validate(wire: Vectors.hex(n["wireHex"]), deployment: Vectors.deployment)
            #expect(signed.note == note)
            #expect(signed.wire == Vectors.hex(n["wireHex"]))
            #expect(PaymentTransport.encode(.note, signed.wire) == n["transport"] as! String)
        }
    }

    @Test("every invalid note fails with the spec's error name, in order")
    func invalidNotes() {
        let cases = Vectors.list("invalidNotes")
        #expect(cases.count >= 14)
        for c in cases {
            let expected = c["error"] as! String
            do {
                _ = try SignedNote.validate(wire: Vectors.hex(c["wireHex"]), deployment: Vectors.deployment)
                Issue.record("\(c["name"]!) validated but should fail with \(expected)")
            } catch let e as PaymentError {
                #expect(e.rawValue == expected, "\(c["name"]!): got \(e.rawValue), want \(expected)")
            } catch {
                Issue.record("\(c["name"]!): unexpected error \(error)")
            }
        }
    }

    @Test("a mainnet note is refused by a devnet deployment")
    func clusterMismatch() throws {
        var wire = Vectors.hex(Vectors.list("notes")[0]["wireHex"])
        wire[48] = 1
        #expect(throws: PaymentError.cluster) { try SignedNote.validate(wire: wire, deployment: Vectors.deployment) }
    }
}

@Suite("low-S")
struct LowSTests {
    @Test("the high-S twin normalizes to the vector's low-S signature")
    func twins() {
        for n in Vectors.list("notes") {
            let low = Vectors.hex(n["signatureHex"])
            let high = Vectors.hex(n["highSTwinSignatureHex"])
            #expect(P256Rules.isLowS(low))
            #expect(!P256Rules.isLowS(high))
            #expect(P256Rules.normalizeLowS(high) == low)
            #expect(P256Rules.normalizeLowS(low) == low)
        }
    }

    @Test("software signatures are always low-S and verify, including flipped ones")
    func signAndVerifyMany() throws {
        var flipped = 0
        for i in 0..<200 {
            let key = P256.Signing.PrivateKey()
            let signer = SoftwareP256Signer(privateKey: key)
            let message = Data("message \(i)".utf8)
            let raw = try key.signature(for: message).rawRepresentation
            if !P256Rules.isLowS(raw) { flipped += 1 }
            let sig = try signer.sign(message)
            #expect(P256Rules.isLowS(sig))
            try P256Rules.verify(signature: sig, message: message, compressedPublicKey: signer.compressedPublicKey)
        }
        // About half of raw CryptoKit signatures are high-S; prove the flip path ran.
        #expect(flipped > 20, "only \(flipped) of 200 raw signatures were high-S")
    }

    @Test("a note signed here validates with the shared rules")
    func signNote() throws {
        let payer = SoftwareP256Signer()
        let merchant = SoftwareP256Signer()
        let note = NoteV1(deployment: Vectors.deployment, allowanceId: 7, payeeKeyHash: merchant.keyHash,
                          amount: 1_000_000, serial: 3, expiry: 1_893_456_000)
        let signed = try SignedNote.sign(note, with: payer)
        #expect(try SignedNote.validate(wire: signed.wire, deployment: Vectors.deployment) == signed)
    }
}

@Suite("other structures")
struct StructureTests {
    let note0 = try! SignedNote.validate(wire: Vectors.hex(Vectors.list("notes")[0]["wireHex"]), deployment: Vectors.deployment)

    @Test("ack vector verifies and re-encodes")
    func ack() throws {
        let a = Vectors.list("acks")[0]
        let f = a["fields"] as! [String: Any]
        #expect(Ack.encode(noteId: note0.noteId, receivedAt: Vectors.i64(f["receivedAt"])) == Vectors.hex(a["ackHex"]))
        let ack = try Ack.verify(wire: Vectors.hex(a["wireHex"]), for: note0)
        #expect(ack.wire == Vectors.hex(a["wireHex"]))
        #expect(PaymentTransport.encode(.ack, ack.wire) == a["transport"] as! String)
    }

    @Test("an ack from a key that is not the payee is refused")
    func ackWrongMerchant() throws {
        let other = SoftwareP256Signer()
        #expect(throws: PaymentError.payeeMismatch) { try Ack.sign(note: note0, receivedAt: 1, with: other) }
    }

    @Test("confirmation vectors verify with the server key")
    func confirmations() throws {
        for c in Vectors.list("confs") {
            let conf = try Confirmation.verify(wire: Vectors.hex(c["wireHex"]), serverPublicKey: Vectors.serverKey)
            let f = c["fields"] as! [String: Any]
            #expect(conf.status.rawValue == UInt8(f["statusCode"] as! Int))
            #expect(conf.slot == Vectors.u64(f["slot"]))
            #expect(conf.blockTime == Vectors.i64(f["blockTime"]))
            #expect(conf.errorCode == UInt16(f["errorCode"] as! Int))
            #expect(conf.noteId == note0.noteId)
        }
        var tampered = Vectors.hex(Vectors.list("confs")[0]["wireHex"])
        tampered[128] = 2
        #expect(throws: PaymentError.badSignature) { try Confirmation.verify(wire: tampered, serverPublicKey: Vectors.serverKey) }
    }

    @Test("earmark lists encode canonically")
    func earmarks() throws {
        for e in Vectors.list("earmarks") {
            let list = Vectors.hex(e["listHex"])
            #expect(Earmarks.hash(list) == Vectors.hex(e["hashHex"]))
            let hashes = try Earmarks.decode(list)
            #expect(try Earmarks.encode(hashes.reversed()) == list)
        }
        let h = Vectors.hex(Vectors.keys.merchantAHash)
        #expect(throws: PaymentError.earmarkList) { try Earmarks.encode([h, h]) }
    }

    @Test("allowance certificates verify, and a swapped earmark list is refused")
    func allowances() throws {
        let all = Vectors.list("allowances")
        for a in all {
            let cert = try AllowanceCertificate.verify(wire: Vectors.hex(a["wireHex"]), deployment: Vectors.deployment,
                                                       serverPublicKey: Vectors.serverKey)
            let f = a["fields"] as! [String: Any]
            #expect(cert.cap == Vectors.u64(f["cap"]))
            #expect(cert.offlineLimit == Vectors.u64(f["offlineLimit"]))
            #expect(cert.payerKeyHash == note0.payerKeyHash)
        }
        let earmarked = try AllowanceCertificate.verify(wire: Vectors.hex(all[1]["wireHex"]), deployment: Vectors.deployment,
                                                        serverPublicKey: Vectors.serverKey)
        #expect(earmarked.allows(merchantKeyHash: Vectors.hex(Vectors.keys.merchantAHash)))
        #expect(!earmarked.allows(merchantKeyHash: Vectors.hex(Vectors.keys.merchantBHash)))
        // Same signed body, but the attached list replaced with an unrestricted one.
        let wire = Vectors.hex(all[1]["wireHex"])
        let swapped = wire.prefix(185 + 64) + Data([0, 0])
        #expect(throws: PaymentError.earmarkMismatch) {
            try AllowanceCertificate.verify(wire: Data(swapped), deployment: Vectors.deployment, serverPublicKey: Vectors.serverKey)
        }
    }

    @Test("merchant certificates verify, including a UTF-8 name")
    func merchants() throws {
        for m in Vectors.list("merchants") {
            let cert = try MerchantCertificate.verify(wire: Vectors.hex(m["wireHex"]), deployment: Vectors.deployment,
                                                      serverPublicKey: Vectors.serverKey)
            let f = m["fields"] as! [String: Any]
            #expect(cert.displayName == f["displayName"] as! String)
        }
    }

    @Test("withdraw and refund bytes match and their signatures verify")
    func merchantInstructions() throws {
        let w = Vectors.list("withdraws")[0]
        let wf = w["fields"] as! [String: Any]
        let wb = MerchantInstructions.withdraw(deployment: Vectors.deployment, merchantKeyHash: Vectors.hex(wf["merchantKeyHashHex"]),
                                               destination: Vectors.hex(wf["destinationHex"]), amount: Vectors.u64(wf["amount"]),
                                               counter: Vectors.u64(wf["counter"]))
        #expect(wb == Vectors.hex(w["withdrawHex"]))
        try P256Rules.verify(signature: Vectors.hex(w["signatureHex"]), message: wb, compressedPublicKey: Vectors.hex(w["merchantPublicKeyHex"]))

        let r = Vectors.list("refunds")[0]
        let rf = r["fields"] as! [String: Any]
        let rb = MerchantInstructions.refund(deployment: Vectors.deployment, noteId: Vectors.hex(rf["noteIdHex"]),
                                             allowanceId: Vectors.u64(rf["allowanceId"]), amount: Vectors.u64(rf["amount"]),
                                             counter: Vectors.u64(rf["counter"]))
        #expect(rb == Vectors.hex(r["refundHex"]))
        try P256Rules.verify(signature: Vectors.hex(r["signatureHex"]), message: rb, compressedPublicKey: Vectors.hex(r["merchantPublicKeyHex"]))
    }

    @Test("marker and receipts round trip")
    func bundles() throws {
        let ack = try Ack.verify(wire: Vectors.hex(Vectors.list("acks")[0]["wireHex"]), for: note0)
        let marker = Vectors.list("markers")[0]
        #expect(Bundles.marker(note: note0, ack: ack) == Vectors.hex(marker["wireHex"]))
        let receipts = Vectors.list("receipts")
        let settled = Vectors.hex(receipts[0]["wireHex"])
        let conf = Vectors.hex(Vectors.list("confs")[0]["wireHex"])
        #expect(Bundles.receipt(note: note0, ack: ack, confirmationWire: conf) == settled)
        #expect(settled.count == 587)
        let parts = try Bundles.splitReceipt(settled)
        #expect(parts.confirmation == conf)
        #expect(Bundles.receipt(note: note0, ack: ack, confirmationWire: nil) == Vectors.hex(receipts[1]["wireHex"]))
        #expect(PaymentTransport.encode(.receipt, settled) == receipts[0]["transport"] as! String)
        var badFlag = settled
        badFlag[238 + 153] = 7
        #expect(throws: PaymentError.receiptFlag) { try Bundles.splitReceipt(badFlag) }
    }
}

@Suite("transport, money, serials")
struct TransportTests {
    @Test("every transport string in the vectors decodes to its payload")
    func transports() throws {
        for key in ["notes", "acks", "confs", "allowances", "merchants", "markers", "receipts"] {
            for v in Vectors.list(key) {
                let t = v["transport"] as! String
                let decoded = try #require(try PaymentTransport.decode(t))
                #expect(decoded.payload == Vectors.hex(v["wireHex"]))
            }
        }
    }

    @Test("non-payment and other-version content is ignored, malformed payloads throw")
    func ignoresAndRejects() throws {
        #expect(try PaymentTransport.decode("L1|T|abc|aGk") == nil)
        #expect(try PaymentTransport.decode("L1|P|2|N|AAAA") == nil)
        #expect(try PaymentTransport.decode("L1|P|1|Z|AAAA") == nil)
        #expect(throws: PaymentError.base64url) { try PaymentTransport.decode("L1|P|1|N|AAA=") }
        #expect(throws: PaymentError.base64url) { try PaymentTransport.decode("L1|P|1|N|AA+/") }
        // Non-canonical: "AB" has nonzero unused bits ("AA" is canonical for one zero byte).
        #expect(throws: PaymentError.base64url) { try Base64URL.decode("AB") }
        #expect(try Base64URL.decode("AA") == Data([0]))
    }

    @Test("units match the vectors")
    func units() {
        for u in Vectors.list("units") {
            let base = Vectors.u64(u["baseUnits"])
            #expect(Money.baseUnits(u["display"] as! String) == base)
            #expect(Money.display(baseUnits: base) == u["display"] as! String)
        }
        #expect(Money.baseUnits("1.0000001") == nil)
        #expect(Money.baseUnits("-1") == nil)
        #expect(Money.display(baseUnits: 1) == "0.000001")
    }

    @Test("serial reservations survive a restart and stop at 256")
    func serials() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let url = dir.appendingPathComponent("serials.json")
        let store = SerialReservations(url: url)
        #expect(try store.reserve(allowanceId: 42) == 0)
        #expect(try store.reserve(allowanceId: 42) == 1)
        let reopened = SerialReservations(url: url)
        #expect(try reopened.reserve(allowanceId: 42) == 2)
        #expect(try reopened.reserve(allowanceId: 43) == 0)
        for _ in 3...255 { _ = try reopened.reserve(allowanceId: 42) }
        #expect(try reopened.remaining(allowanceId: 42) == 0)
        #expect(throws: PaymentError.serialsExhausted) { try reopened.reserve(allowanceId: 42) }
        try Data("not json".utf8).write(to: url)
        #expect(throws: PaymentError.storage) { try SerialReservations(url: url).reserve(allowanceId: 42) }
    }
}

private extension Dictionary where Key == String, Value == Any {
    var merchantAHash: Any? { (self["merchantA"] as! [String: Any])["keyHashHex"] }
    var merchantBHash: Any? { (self["merchantB"] as! [String: Any])["keyHashHex"] }
}
