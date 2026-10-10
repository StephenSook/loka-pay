import CryptoKit
import Foundation
import Testing
@testable import LokaPay

/// Regression tests for the Codex review of the LokaPay package (Fri night).
@Suite("review fixes")
struct ReviewFixTests {
    func freshURL(_ name: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent(name)
    }

    @Test("two store objects on one file never hand out the same serial")
    func sharedLockAcrossInstances() throws {
        let url = freshURL("serials.json")
        let stores = [SerialReservations(url: url), SerialReservations(url: url)]
        let results = NSLock()
        var serials: [UInt8] = []
        var failures = 0
        DispatchQueue.concurrentPerform(iterations: 200) { i in
            do {
                let s = try stores[i % 2].reserve(allowanceId: 9)
                results.lock(); serials.append(s); results.unlock()
            } catch {
                results.lock(); failures += 1; results.unlock()
            }
        }
        #expect(failures == 0)
        #expect(serials.count == 200)
        #expect(Set(serials).count == 200, "a serial was handed out twice")
        #expect(try stores[0].remaining(allowanceId: 9) == 56)
    }

    @Test("a counter outside 0...256 in valid JSON is refused before anything changes")
    func corruptCounters() throws {
        for bad in [#"{"42": -5}"#, #"{"42": 300}"#, #"{"not-a-number": 1}"#] {
            let url = freshURL("serials.json")
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(bad.utf8).write(to: url)
            #expect(throws: PaymentError.storage) { try SerialReservations(url: url).reserve(allowanceId: 42) }
            #expect(try Data(contentsOf: url) == Data(bad.utf8), "the corrupt file must not be rewritten")
        }
        let url = freshURL("serials.json")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"42": 256}"#.utf8).write(to: url)
        #expect(throws: PaymentError.serialsExhausted) { try SerialReservations(url: url).reserve(allowanceId: 42) }
    }

    @Test("earmark hashes of mixed length throw instead of crashing (Greptile)")
    func earmarkLengths() {
        #expect(throws: PaymentError.earmarkList) { try Earmarks.encode([Data(repeating: 1, count: 31), Data(repeating: 2, count: 32)]) }
        #expect(throws: PaymentError.earmarkList) { try Earmarks.encode(Array(repeating: Data(repeating: 3, count: 32), count: 17)) }
    }

    @Test("a server-signed merchant name that is not NFC is refused; the NFC spelling passes")
    func merchantNameMustBeNFC() throws {
        let server = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(SHA256.hash(data: Data("LOKA-PAY-V1 test key server-ed25519".utf8))))
        func wire(_ name: String) throws -> Data {
            let bytes = Data(name.utf8)
            var w = ByteWriter()
            w.ascii(MerchantCertificate.prefix, count: 16)
            w.bytes(Vectors.deployment.programId, count: 32)
            w.u8(Vectors.deployment.clusterId)
            w.bytes(Vectors.deployment.mint, count: 32)
            w.bytes(Data(repeating: 1, count: 32), count: 32)
            w.u16(UInt16(bytes.count))
            var body = w.data
            body.append(bytes)
            return body + (try server.signature(for: body))
        }
        let decomposed = "Nde\u{0300}ye"  // e + combining grave accent
        let composed = "Nd\u{00E8}ye"     // precomposed e with grave
        #expect(decomposed == composed, "Swift treats them as equal, which is why bytes are compared")
        #expect(throws: PaymentError.nameLength) {
            try MerchantCertificate.verify(wire: wire(decomposed), deployment: Vectors.deployment, serverPublicKey: Vectors.serverKey)
        }
        let ok = try MerchantCertificate.verify(wire: wire(composed), deployment: Vectors.deployment, serverPublicKey: Vectors.serverKey)
        #expect(Array(ok.displayName.utf8) == Array(composed.utf8))
    }
}
