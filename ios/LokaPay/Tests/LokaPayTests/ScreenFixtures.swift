import CryptoKit
import Foundation
import Testing
@testable import LokaPay

/// TEST-ONLY fixtures for the payment screens. Certificates for fresh keys are signed with the
/// vector server key (`BindingTests.server`, derived from a public label), so they verify against
/// `Vectors.serverKey` and the vector deployment. None of this ships.
enum ScreenFixtures {
    static let deployment = Vectors.deployment
    static let serverKey = Vectors.serverKey
    static let now = Date(timeIntervalSince1970: 1_800_000_000)
    static let expiry: Int64 = 1_900_000_000
    static let allowanceId: UInt64 = 77

    /// Signs with the vector server key, or with `other` (a stranger) to build a forged structure.
    static func sign(_ body: Data, _ other: Curve25519.Signing.PrivateKey?) -> Data {
        try! (other ?? BindingTests.server).signature(for: body)
    }

    static func allowanceWire(payer: Data, id: UInt64 = allowanceId, cap: UInt64 = 5_000_000,
                              offlineLimit: UInt64 = 3_000_000, expiry: Int64 = expiry, earmarks: [Data] = [],
                              signedBy other: Curve25519.Signing.PrivateKey? = nil) -> Data {
        let list = try! Earmarks.encode(earmarks)
        var w = ByteWriter()
        w.ascii(AllowanceCertificate.prefix, count: 16)
        w.bytes(deployment.programId, count: 32)
        w.u8(deployment.clusterId)
        w.bytes(deployment.mint, count: 32)
        w.u64(id)
        w.bytes(payer, count: 32)
        w.u64(cap)
        w.u64(offlineLimit)
        w.i64(expiry)
        w.bytes(Earmarks.hash(list), count: 32)
        w.u64(0)
        return w.data + sign(w.data, other) + list
    }

    static func merchantWire(merchant: Data, name: String = "Test Stall",
                             signedBy other: Curve25519.Signing.PrivateKey? = nil) -> Data {
        let nameBytes = Data(name.utf8)
        var w = ByteWriter()
        w.ascii(MerchantCertificate.prefix, count: 16)
        w.bytes(deployment.programId, count: 32)
        w.u8(deployment.clusterId)
        w.bytes(deployment.mint, count: 32)
        w.bytes(merchant, count: 32)
        w.u16(UInt16(nameBytes.count))
        w.bytes(nameBytes, count: nameBytes.count)
        return w.data + sign(w.data, other)
    }

    /// A CONF for `noteId`: status 1 settled, 2 failed on chain.
    static func confWire(noteId: Data, status: UInt8, errorCode: UInt16 = 0,
                         blockTime: Int64 = 1_800_000_065, uploadedAt: Int64 = 1_800_000_060,
                         signedBy other: Curve25519.Signing.PrivateKey? = nil) -> Data {
        var w = ByteWriter()
        w.ascii(Confirmation.prefix, count: 16)
        w.bytes(noteId, count: 32)
        w.bytes(Data(repeating: 7, count: 64), count: 64)
        w.u64(412_000_000)
        w.i64(blockTime)
        w.i64(uploadedAt)
        w.u8(status)
        w.u16(errorCode)
        return w.data + sign(w.data, other)
    }

    /// An HTTP 200 notes body whose JSON `status` can disagree with the signed CONF.
    static func decisionBody(conf: Data, noteId: Data, jsonStatus: String, error: String? = nil) -> Data {
        APIFixtures.json([
            "noteId": noteId.hex, "status": jsonStatus, "error": error.map { $0 as Any } ?? NSNull(),
            "errorCode": 0, "conf": Base64URL.encode(conf), "replayed": false,
        ])
    }

    static func tempURL(_ name: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent(name)
    }

    static func note(payer: PaymentSigner, payee: Data, amount: UInt64, serial: UInt8,
                     allowanceId: UInt64 = allowanceId, expiry: Int64 = expiry) throws -> SignedNote {
        try SignedNote.sign(NoteV1(deployment: deployment, allowanceId: allowanceId, payeeKeyHash: payee,
                                   amount: amount, serial: serial, expiry: expiry), with: payer)
    }
}

/// Records how many serials were still free each time it signed, to prove the reservation happened first.
final class RecordingSigner: PaymentSigner, @unchecked Sendable {
    let inner: SoftwareP256Signer
    let serials: SerialReservations
    let allowanceId: UInt64
    private let lock = NSLock()
    private var seen: [Int] = []

    init(inner: SoftwareP256Signer, serials: SerialReservations, allowanceId: UInt64) {
        self.inner = inner
        self.serials = serials
        self.allowanceId = allowanceId
    }

    var remainingAtSign: [Int] { lock.withLock { seen } }
    var compressedPublicKey: Data { inner.compressedPublicKey }

    func sign(_ message: Data) throws -> Data {
        let remaining = try serials.remaining(allowanceId: allowanceId)
        lock.withLock { seen.append(remaining) }
        return try inner.sign(message)
    }
}

/// Fails the way a cancelled Face ID prompt does (an LAError-domain NSError).
struct CancelledSigner: PaymentSigner {
    let inner: SoftwareP256Signer
    var compressedPublicKey: Data { inner.compressedPublicKey }

    func sign(_ message: Data) throws -> Data {
        throw NSError(domain: "com.apple.LocalAuthentication", code: -2,
                      userInfo: [NSLocalizedDescriptionKey: "Authentication canceled."])
    }
}
