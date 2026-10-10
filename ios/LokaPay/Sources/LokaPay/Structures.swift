import CryptoKit
import Foundation

/// ACK_V1 (56 bytes), merchant-signed; wire 153 bytes (protocol/PAYMENT-V1.md section 4.2).
public struct Ack: Equatable, Sendable {
    public static let prefix = "LOKA-PAY-ACKN-V1"
    public static let wireSize = 153

    public let noteId: Data
    public let receivedAt: Int64
    public let signature: Data
    public let merchantPublicKey: Data

    public static func encode(noteId: Data, receivedAt: Int64) -> Data {
        var w = ByteWriter()
        w.ascii(prefix, count: 16)
        w.bytes(noteId, count: 32)
        w.i64(receivedAt)
        return w.data
    }

    public var wire: Data { Self.encode(noteId: noteId, receivedAt: receivedAt) + signature + merchantPublicKey }

    public static func sign(note: SignedNote, receivedAt: Int64, with merchant: PaymentSigner) throws -> Ack {
        guard merchant.keyHash == note.note.payeeKeyHash else { throw PaymentError.payeeMismatch }
        let body = encode(noteId: note.noteId, receivedAt: receivedAt)
        return Ack(noteId: note.noteId, receivedAt: receivedAt, signature: try merchant.sign(body),
                   merchantPublicKey: merchant.compressedPublicKey)
    }

    /// Verifies an ack wire against the note it acknowledges (key hash must be the payee).
    public static func verify(wire: Data, for note: SignedNote) throws -> Ack {
        guard wire.count == wireSize else { throw PaymentError.length }
        var r = ByteReader(wire)
        let body = try r.read(56)
        let sig = try r.read(64)
        let key = try r.read(33)
        var b = ByteReader(body)
        guard try b.read(16) == Data(prefix.utf8) else { throw PaymentError.prefix }
        let noteId = try b.read(32)
        let receivedAt = try b.i64()
        guard noteId == note.noteId, P256Rules.keyHash(key) == note.note.payeeKeyHash else {
            throw PaymentError.payeeMismatch
        }
        try P256Rules.verify(signature: sig, message: body, compressedPublicKey: key)
        return Ack(noteId: noteId, receivedAt: receivedAt, signature: sig, merchantPublicKey: key)
    }
}

/// CONF_V1 (131 bytes), server-signed with Ed25519; wire 195 bytes (section 4.3).
public struct Confirmation: Equatable, Sendable {
    public static let prefix = "LOKA-PAY-CONF-V1"
    public static let wireSize = 195

    public enum Status: UInt8, Sendable {
        case settled = 1
        case failedOnChain = 2
        case refusedOffChain = 3
    }

    public let noteId: Data
    public let txSignature: Data
    public let slot: UInt64
    public let blockTime: Int64
    public let status: Status
    public let errorCode: UInt16

    public static func verify(wire: Data, serverPublicKey: Data) throws -> Confirmation {
        guard wire.count == wireSize else { throw PaymentError.length }
        let body = Data(wire.prefix(131))
        try Ed25519Rules.verify(signature: Data(wire.suffix(64)), message: body, publicKey: serverPublicKey)
        var r = ByteReader(body)
        guard try r.read(16) == Data(prefix.utf8) else { throw PaymentError.prefix }
        let noteId = try r.read(32)
        let tx = try r.read(64)
        let slot = try r.u64()
        let blockTime = try r.i64()
        guard let status = Status(rawValue: try r.u8()) else { throw PaymentError.length }
        let errorCode = try r.u16()
        return Confirmation(noteId: noteId, txSignature: tx, slot: slot, blockTime: blockTime,
                            status: status, errorCode: errorCode)
    }
}

/// Earmark list: u16 count || sorted unique 32-byte merchant key hashes (section 4.4).
public enum Earmarks {
    public static func encode(_ keyHashes: [Data]) throws -> Data {
        let sorted = keyHashes.sorted { P256Rules.compare($0, $1) < 0 }
        guard sorted.count <= 16, sorted.allSatisfy({ $0.count == 32 }) else { throw PaymentError.earmarkList }
        for i in sorted.indices.dropFirst() where sorted[i] == sorted[i - 1] { throw PaymentError.earmarkList }
        var w = ByteWriter()
        w.u16(UInt16(sorted.count))
        for h in sorted { w.bytes(h, count: 32) }
        return w.data
    }

    public static func hash(_ list: Data) -> Data { Data(SHA256.hash(data: list)) }

    /// Parses and checks canonical form (sorted, unique, at most 16).
    public static func decode(_ list: Data) throws -> [Data] {
        var r = ByteReader(list)
        let n = Int(try r.u16())
        guard n <= 16, r.remaining == n * 32 else { throw PaymentError.earmarkList }
        let hashes = try (0..<n).map { _ in try r.read(32) }
        guard try encode(hashes) == list else { throw PaymentError.earmarkList }
        return hashes
    }
}

/// ALLOW_V1 (185 bytes), the allowance certificate, server-signed (section 4.5).
public struct AllowanceCertificate: Equatable, Sendable {
    public static let prefix = "LOKA-PAY-ALLW-V1"
    public static let size = 185

    public let allowanceId: UInt64
    public let payerKeyHash: Data
    public let cap: UInt64
    public let offlineLimit: UInt64
    public let expiry: Int64
    public let earmarks: [Data]
    public let bond: UInt64

    /// True when the allowance can pay `merchantKeyHash` (empty list = any merchant).
    public func allows(merchantKeyHash: Data) -> Bool { earmarks.isEmpty || earmarks.contains(merchantKeyHash) }

    /// Verifies `ALLOW_V1 || signature || earmark list` against the deployment and server key.
    public static func verify(wire: Data, deployment: Deployment, serverPublicKey: Data) throws -> AllowanceCertificate {
        guard wire.count >= size + 64 + 2 else { throw PaymentError.length }
        let w = Data(wire)
        let body = Data(w.prefix(size))
        let sig = w.subdata(in: (w.startIndex + size)..<(w.startIndex + size + 64))
        let list = Data(w.suffix(from: w.startIndex + size + 64))
        try Ed25519Rules.verify(signature: sig, message: body, publicKey: serverPublicKey)
        var r = ByteReader(body)
        guard try r.read(16) == Data(prefix.utf8) else { throw PaymentError.prefix }
        guard try r.read(32) == deployment.programId else { throw PaymentError.wrongProgram }
        guard try r.u8() == deployment.clusterId else { throw PaymentError.cluster }
        guard try r.read(32) == deployment.mint else { throw PaymentError.wrongMint }
        let allowanceId = try r.u64()
        let payer = try r.read(32)
        let cap = try r.u64()
        let offline = try r.u64()
        let expiry = try r.i64()
        let earmarkHash = try r.read(32)
        let bond = try r.u64()
        guard Earmarks.hash(list) == earmarkHash else { throw PaymentError.earmarkMismatch }
        return AllowanceCertificate(allowanceId: allowanceId, payerKeyHash: payer, cap: cap, offlineLimit: offline,
                                    expiry: expiry, earmarks: try Earmarks.decode(list), bond: bond)
    }
}

/// MERCH_V1 (115 + name bytes), the merchant certificate, server-signed (section 4.6).
public struct MerchantCertificate: Equatable, Sendable {
    public static let prefix = "LOKA-PAY-MRCH-V1"

    public let merchantKeyHash: Data
    public let displayName: String

    public static func verify(wire: Data, deployment: Deployment, serverPublicKey: Data) throws -> MerchantCertificate {
        guard wire.count >= 115 + 1 + 64 else { throw PaymentError.length }
        let body = Data(wire.prefix(wire.count - 64))
        try Ed25519Rules.verify(signature: Data(wire.suffix(64)), message: body, publicKey: serverPublicKey)
        var r = ByteReader(body)
        guard try r.read(16) == Data(prefix.utf8) else { throw PaymentError.prefix }
        guard try r.read(32) == deployment.programId else { throw PaymentError.wrongProgram }
        guard try r.u8() == deployment.clusterId else { throw PaymentError.cluster }
        guard try r.read(32) == deployment.mint else { throw PaymentError.wrongMint }
        let keyHash = try r.read(32)
        let n = Int(try r.u16())
        guard (1...64).contains(n), r.remaining == n,
              let name = String(data: try r.read(n), encoding: .utf8),
              name == name.precomposedStringWithCanonicalMapping
        else { throw PaymentError.nameLength }
        return MerchantCertificate(merchantKeyHash: keyHash, displayName: name)
    }
}

/// WITHDRAW_V1 (161 bytes) and REFUND_V1 (137 bytes), merchant-signed (sections 4.7, 4.8).
public enum MerchantInstructions {
    public static func withdraw(deployment: Deployment, merchantKeyHash: Data, destination: Data,
                                amount: UInt64, counter: UInt64) -> Data {
        var w = ByteWriter()
        w.ascii("LOKA-PAY-WDRW-V1", count: 16)
        w.bytes(deployment.programId, count: 32)
        w.u8(deployment.clusterId)
        w.bytes(deployment.mint, count: 32)
        w.bytes(merchantKeyHash, count: 32)
        w.bytes(destination, count: 32)
        w.u64(amount)
        w.u64(counter)
        return w.data
    }

    public static func refund(deployment: Deployment, noteId: Data, allowanceId: UInt64,
                              amount: UInt64, counter: UInt64) -> Data {
        var w = ByteWriter()
        w.ascii("LOKA-PAY-RFND-V1", count: 16)
        w.bytes(deployment.programId, count: 32)
        w.u8(deployment.clusterId)
        w.bytes(deployment.mint, count: 32)
        w.bytes(noteId, count: 32)
        w.u64(allowanceId)
        w.u64(amount)
        w.u64(counter)
        return w.data
    }
}

/// Spend marker and receipt bundles (section 4.9). Unsigned wrappers around signed parts.
public enum Bundles {
    /// Marker: note wire (238) || ack wire (153).
    public static func marker(note: SignedNote, ack: Ack) -> Data { note.wire + ack.wire }

    /// Receipt: note wire || ack wire || flag || conf wire when settled.
    public static func receipt(note: SignedNote, ack: Ack, confirmationWire: Data?) -> Data {
        var d = note.wire + ack.wire
        if let conf = confirmationWire {
            d.append(1)
            d.append(conf)
        } else {
            d.append(0)
        }
        return d
    }

    /// Splits a receipt into its parts (the caller verifies each part).
    public static func splitReceipt(_ bytes: Data) throws -> (note: Data, ack: Data, confirmation: Data?) {
        var r = ByteReader(bytes)
        let note = try r.read(SignedNote.wireSize)
        let ack = try r.read(Ack.wireSize)
        switch try r.u8() {
        case 0:
            guard r.remaining == 0 else { throw PaymentError.length }
            return (note, ack, nil)
        case 1:
            guard r.remaining == Confirmation.wireSize else { throw PaymentError.length }
            return (note, ack, try r.read(Confirmation.wireSize))
        default:
            throw PaymentError.receiptFlag
        }
    }
}
