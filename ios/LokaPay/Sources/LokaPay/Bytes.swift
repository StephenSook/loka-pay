import Foundation

/// Errors named exactly as in protocol/PAYMENT-V1.md (section 6 and the structure rules).
public enum PaymentError: String, Error, Equatable, Sendable {
    case length
    case prefix
    case cluster
    case currency
    case amountZero = "amount_zero"
    case wrongProgram = "wrong_program"
    case wrongMint = "wrong_mint"
    case badPubkey = "bad_pubkey"
    case highS = "high_s"
    case badSignature = "bad_signature"
    case base64url
    case transport
    case earmarkMismatch = "earmark_mismatch"
    case earmarkList = "earmark_list"
    case nameLength = "name_length"
    case receiptFlag = "receipt_flag"
    case payeeMismatch = "payee_mismatch"
    case serialsExhausted = "serials_exhausted"
    case confirmationMismatch = "confirmation_mismatch"
    case allowanceMismatch = "allowance_mismatch"
    case payerMismatch = "payer_mismatch"
    case notEarmarked = "not_earmarked"
    case expired
    case storage
}

/// Big-endian writer for the fixed binary layouts.
struct ByteWriter {
    private(set) var data = Data()

    mutating func u8(_ v: UInt8) { data.append(v) }

    mutating func u16(_ v: UInt16) {
        data.append(UInt8(v >> 8))
        data.append(UInt8(v & 0xff))
    }

    mutating func u64(_ v: UInt64) {
        for shift in stride(from: 56, through: 0, by: -8) { data.append(UInt8((v >> UInt64(shift)) & 0xff)) }
    }

    mutating func i64(_ v: Int64) { u64(UInt64(bitPattern: v)) }

    mutating func bytes(_ d: Data, count: Int) {
        precondition(d.count == count, "field must be \(count) bytes, got \(d.count)")
        data.append(d)
    }

    mutating func ascii(_ s: String, count: Int) { bytes(Data(s.utf8), count: count) }
}

/// Big-endian reader that copies every field out, so callers never see slice indices.
struct ByteReader {
    let data: Data
    private(set) var offset = 0

    init(_ data: Data) { self.data = Data(data) }

    var remaining: Int { data.count - offset }

    mutating func read(_ n: Int) throws -> Data {
        guard n >= 0, remaining >= n else { throw PaymentError.length }
        let start = data.startIndex + offset
        offset += n
        return data.subdata(in: start..<(start + n))
    }

    mutating func u8() throws -> UInt8 { try read(1)[0] }

    mutating func u16() throws -> UInt16 {
        let b = try read(2)
        return UInt16(b[0]) << 8 | UInt16(b[1])
    }

    mutating func u64() throws -> UInt64 {
        try read(8).reduce(0) { $0 << 8 | UInt64($1) }
    }

    mutating func i64() throws -> Int64 { Int64(bitPattern: try u64()) }
}

public extension Data {
    /// Lowercase hex, for logs and test vectors.
    var hex: String { map { String(format: "%02x", $0) }.joined() }

    /// Parses lowercase or uppercase hex; returns nil on odd length or a non-hex character.
    init?(hex: String) {
        guard hex.count % 2 == 0 else { return nil }
        var out = Data(capacity: hex.count / 2)
        var i = hex.startIndex
        while i < hex.endIndex {
            let j = hex.index(i, offsetBy: 2)
            guard let b = UInt8(hex[i..<j], radix: 16) else { return nil }
            out.append(b)
            i = j
        }
        self = out
    }
}

/// One lock per canonical file path, shared by every store object in this process, so two
/// instances pointed at the same file serialize their whole read-check-write transaction.
/// Stores call `resolve` at the start of EVERY operation: if the path cannot be canonicalized
/// the operation fails closed (`storage`) instead of locking under a second spelling.
enum FileLocks {
    private static let registryLock = NSLock()
    private static var locks: [String: NSLock] = [:]

    /// The URL that names this file before and after it exists: the parent folder is created
    /// if needed and resolved with realpath(3), then the file name is appended.
    /// (URL.resolvingSymlinksInPath depends on whether the file exists, so it cannot be a lock
    /// identity.) Throws `storage` rather than returning an unresolved fallback.
    static func canonical(_ url: URL) throws -> URL {
        let dir = url.standardizedFileURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            throw PaymentError.storage
        }
        guard let resolved = realpath(dir.path, nil) else { throw PaymentError.storage }
        defer { free(resolved) }
        return URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
            .appendingPathComponent(url.lastPathComponent)
    }

    /// The shared lock and the canonical URL to read and write, for one operation.
    static func resolve(_ url: URL) throws -> (lock: NSLock, url: URL) {
        let canonicalURL = try canonical(url)
        registryLock.lock()
        defer { registryLock.unlock() }
        if let existing = locks[canonicalURL.path] { return (existing, canonicalURL) }
        let created = NSLock()
        locks[canonicalURL.path] = created
        return (created, canonicalURL)
    }
}
