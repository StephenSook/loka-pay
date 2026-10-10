import CryptoKit
import Foundation

/// The values every signed structure binds (from config/pins.json at runtime).
public struct Deployment: Equatable, Sendable {
    public let programId: Data
    public let clusterId: UInt8
    public let mint: Data

    public init(programId: Data, clusterId: UInt8, mint: Data) {
        precondition(programId.count == 32 && mint.count == 32, "program id and mint are 32 bytes")
        precondition(clusterId <= 1, "cluster id is 0 (devnet) or 1 (mainnet)")
        self.programId = programId
        self.clusterId = clusterId
        self.mint = mint
    }
}

/// NOTE_V1, 141 bytes (protocol/PAYMENT-V1.md section 4.1).
public struct NoteV1: Equatable, Sendable {
    public static let prefix = "LOKA-PAY-NOTE-V1"
    public static let size = 141

    public var programId: Data
    public var clusterId: UInt8
    public var mint: Data
    public var allowanceId: UInt64
    public var payeeKeyHash: Data
    public var amount: UInt64
    public var currency: String
    public var serial: UInt8
    public var expiry: Int64

    public init(deployment: Deployment, allowanceId: UInt64, payeeKeyHash: Data, amount: UInt64,
                serial: UInt8, expiry: Int64, currency: String = "USD") {
        self.programId = deployment.programId
        self.clusterId = deployment.clusterId
        self.mint = deployment.mint
        self.allowanceId = allowanceId
        self.payeeKeyHash = payeeKeyHash
        self.amount = amount
        self.currency = currency
        self.serial = serial
        self.expiry = expiry
    }

    /// The exact bytes the payer signs.
    public func encoded() -> Data {
        var w = ByteWriter()
        w.ascii(Self.prefix, count: 16)
        w.bytes(programId, count: 32)
        w.u8(clusterId)
        w.bytes(mint, count: 32)
        w.u64(allowanceId)
        w.bytes(payeeKeyHash, count: 32)
        w.u64(amount)
        w.ascii(currency, count: 3)
        w.u8(serial)
        w.i64(expiry)
        return w.data
    }

    /// sha256 of the 141 note bytes.
    public var noteId: Data { Data(SHA256.hash(data: encoded())) }

    /// Structural decode of exactly 141 bytes. Field rules are checked by `SignedNote.validate`.
    public static func decode(_ bytes: Data) throws -> NoteV1 {
        guard bytes.count == size else { throw PaymentError.length }
        var r = ByteReader(bytes)
        guard try r.read(16) == Data(prefix.utf8) else { throw PaymentError.prefix }
        let programId = try r.read(32)
        let cluster = try r.u8()
        let mint = try r.read(32)
        let allowanceId = try r.u64()
        let payee = try r.read(32)
        let amount = try r.u64()
        let currencyBytes = try r.read(3)
        let serial = try r.u8()
        let expiry = try r.i64()
        // A non-ASCII currency decodes to "" so the ordered check in validate() reports it.
        let currency = String(data: currencyBytes, encoding: .ascii) ?? ""
        var note = NoteV1(deployment: Deployment(programId: programId, clusterId: 0, mint: mint),
                          allowanceId: allowanceId, payeeKeyHash: payee, amount: amount,
                          serial: serial, expiry: expiry, currency: currency)
        note.clusterId = cluster
        return note
    }
}

/// A note with its signature and the payer's key: the 238-byte note wire.
public struct SignedNote: Equatable, Sendable {
    public static let wireSize = 238

    public let note: NoteV1
    public let noteBytes: Data
    public let signature: Data
    public let payerPublicKey: Data

    public var noteId: Data { Data(SHA256.hash(data: noteBytes)) }
    public var payerKeyHash: Data { P256Rules.keyHash(payerPublicKey) }
    public var wire: Data { noteBytes + signature + payerPublicKey }

    /// Signs a note with any payment signer (Secure Enclave on a phone, software in tests).
    public static func sign(_ note: NoteV1, with signer: PaymentSigner) throws -> SignedNote {
        let bytes = note.encoded()
        let sig = try signer.sign(bytes)
        return SignedNote(note: note, noteBytes: bytes, signature: sig, payerPublicKey: signer.compressedPublicKey)
    }

    /// Runs the checks of protocol/PAYMENT-V1.md section 6 in order and throws the first
    /// failure by name. Time, allowance and offline-limit checks come after this.
    public static func validate(wire: Data, deployment: Deployment) throws -> SignedNote {
        guard wire.count == wireSize else { throw PaymentError.length }
        let w = Data(wire)
        let noteBytes = Data(w.prefix(NoteV1.size))
        guard noteBytes.prefix(16) == Data(NoteV1.prefix.utf8) else { throw PaymentError.prefix }
        let note = try NoteV1.decode(noteBytes)
        guard note.clusterId == deployment.clusterId else { throw PaymentError.cluster }
        guard note.currency == "USD" else { throw PaymentError.currency }
        guard note.amount > 0 else { throw PaymentError.amountZero }
        guard note.programId == deployment.programId else { throw PaymentError.wrongProgram }
        guard note.mint == deployment.mint else { throw PaymentError.wrongMint }
        let signature = w.subdata(in: (w.startIndex + 141)..<(w.startIndex + 205))
        let key = w.subdata(in: (w.startIndex + 205)..<(w.startIndex + 238))
        try P256Rules.verify(signature: signature, message: noteBytes, compressedPublicKey: key)
        return SignedNote(note: note, noteBytes: noteBytes, signature: signature, payerPublicKey: key)
    }
}
