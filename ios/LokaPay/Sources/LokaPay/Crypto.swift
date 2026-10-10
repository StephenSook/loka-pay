import CryptoKit
import Foundation

/// P-256 helpers shared by every structure (protocol/PAYMENT-V1.md section 3).
public enum P256Rules {
    /// Curve order n, big-endian.
    static let order = Data(hex: "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551")!
    /// floor(n / 2): a signature is valid only if s <= this (the Solana precompile rule).
    static let halfOrder = Data(hex: "7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8")!

    /// True when the 64-byte r || s signature has s <= n / 2.
    public static func isLowS(_ signature: Data) -> Bool {
        guard signature.count == 64 else { return false }
        return compare(Data(signature.suffix(32)), halfOrder) <= 0
    }

    /// Returns the low-S form of a 64-byte r || s signature: if s > n / 2, s becomes n - s,
    /// written as exactly 32 big-endian bytes. Platform libraries do not promise low-S.
    public static func normalizeLowS(_ signature: Data) -> Data {
        precondition(signature.count == 64, "raw P-256 signature must be 64 bytes")
        let sig = Data(signature)
        let s = Data(sig.suffix(32))
        guard compare(s, halfOrder) > 0 else { return sig }
        return Data(sig.prefix(32)) + subtract(order, s)
    }

    /// sha256 of a 33-byte compressed public key.
    public static func keyHash(_ compressedPublicKey: Data) -> Data {
        Data(SHA256.hash(data: compressedPublicKey))
    }

    /// Verifies a 64-byte signature over the raw message (SHA-256 applied inside, as the
    /// precompile does). Enforces low-S first, because CryptoKit alone accepts high-S.
    public static func verify(signature: Data, message: Data, compressedPublicKey: Data) throws {
        guard compressedPublicKey.count == 33,
              compressedPublicKey.first == 0x02 || compressedPublicKey.first == 0x03,
              let key = try? P256.Signing.PublicKey(compressedRepresentation: compressedPublicKey)
        else { throw PaymentError.badPubkey }
        guard signature.count == 64 else { throw PaymentError.badSignature }
        guard isLowS(signature) else { throw PaymentError.highS }
        guard let sig = try? P256.Signing.ECDSASignature(rawRepresentation: signature),
              key.isValidSignature(sig, for: message)
        else { throw PaymentError.badSignature }
    }

    // Unsigned big-endian comparison of equal-length byte strings.
    static func compare(_ a: Data, _ b: Data) -> Int {
        precondition(a.count == b.count)
        for (x, y) in zip(a, b) where x != y { return x < y ? -1 : 1 }
        return 0
    }

    // a - b for 32-byte big-endian integers with a >= b.
    static func subtract(_ a: Data, _ b: Data) -> Data {
        precondition(a.count == 32 && b.count == 32)
        let x = [UInt8](a), y = [UInt8](b)
        var out = [UInt8](repeating: 0, count: 32)
        var borrow = 0
        for i in stride(from: 31, through: 0, by: -1) {
            var d = Int(x[i]) - Int(y[i]) - borrow
            borrow = 0
            if d < 0 { d += 256; borrow = 1 }
            out[i] = UInt8(d)
        }
        precondition(borrow == 0, "subtract underflow")
        return Data(out)
    }
}

/// Ed25519 verification for server-signed structures (CONF, ALLOW, MERCH).
public enum Ed25519Rules {
    public static func verify(signature: Data, message: Data, publicKey: Data) throws {
        guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey),
              signature.count == 64,
              key.isValidSignature(signature, for: message)
        else { throw PaymentError.badSignature }
    }
}
