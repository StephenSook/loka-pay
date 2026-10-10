import Foundation

/// The text behind the Pay screen's allowance id code (Script B, docs/ALLOWANCE-ID-QR.md):
/// `LOKA-ALLOWANCE:<id>`, the id as a canonical decimal `u64` like API-V1's allowance ids. A sender
/// types the id or scans this code on zerobars.us/send; the server then opens a new allowance for the
/// same payer key. The code is a lookup key only: it carries no money and nothing in it is signed.
public enum AllowanceIdCode {
    public static let prefix = "LOKA-ALLOWANCE:"

    public static func encode(_ allowanceId: UInt64) -> String { prefix + String(allowanceId) }

    /// The id, or nil unless the text is exactly the prefix and a canonical decimal `u64` (ASCII
    /// digits only, no sign, no leading zero except "0" itself). Surrounding whitespace is ignored.
    public static func decode(_ text: String) -> UInt64? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix(prefix) else { return nil }
        let digits = trimmed.dropFirst(prefix.count)
        guard (1...20).contains(digits.utf8.count), digits.utf8.allSatisfy({ (0x30...0x39).contains($0) }),
              digits == "0" || digits.first != "0", let id = UInt64(digits) else { return nil }
        return id
    }
}

/// Why a scanned allowance certificate was not added (Script B import). Each case is named for logs
/// and tests; in every case nothing was stored and the allowance Pay uses did not change.
public enum AllowanceImportRefusal: String, Error, Equatable, Sendable {
    /// The Ed25519 signature does not verify with the pinned server key.
    case badSignature = "import_bad_signature"
    /// Signed by the server, but for another phone's payment key.
    case otherKey = "import_other_key"
    case wrongProgram = "import_wrong_program"
    case wrongCluster = "import_wrong_cluster"
    case wrongMint = "import_wrong_mint"
    /// Its expiry is already past on this phone's clock.
    case expired = "import_expired"
    /// Not a well-formed `L1|P|1|A|...` allowance code.
    case malformed = "import_malformed"
    /// This phone already holds a different certificate for the same allowance id.
    case conflict = "import_conflict"
    /// The verified certificate could not be saved.
    case storage = "import_storage"
    /// The saved imported allowances could not be read; none of them is offered.
    case storeUnreadable = "import_store_unreadable"

    /// Maps a certificate check failure to its import refusal.
    init(verifying error: Error) {
        switch error as? PaymentError {
        case .badSignature?: self = .badSignature
        case .wrongProgram?: self = .wrongProgram
        case .cluster?: self = .wrongCluster
        case .wrongMint?: self = .wrongMint
        default: self = .malformed
        }
    }

    public var message: String {
        switch self {
        case .badSignature:
            return "This allowance code is not signed by the settlement server's pinned key, so it was not added."
        case .otherKey:
            return "This allowance is for another phone's payment key, so it was not added. The sender needs this "
                + "phone's allowance id."
        case .wrongProgram: return "This allowance is for a different LOKA program, so it was not added."
        case .wrongCluster: return "This allowance is for a different Solana cluster, so it was not added."
        case .wrongMint: return "This allowance is for a different token, so it was not added."
        case .expired: return "This allowance has already expired, so it was not added."
        case .malformed:
            return "That is not a well-formed LOKA allowance code (L1|P|1|A|...), so nothing was added."
        case .conflict:
            return "This phone already holds a different certificate for that allowance id, so this one was not added."
        case .storage: return "This phone could not save the allowance, so it was not added. Scan it again."
        case .storeUnreadable:
            return "This phone could not read the allowances it imported earlier, so they are not offered and no new "
                + "one can be saved. Pay uses the allowance from setup."
        }
    }
}

/// Allowance certificates this phone imported by scanning a sender's `L1|P|1|A|...` code (Script B).
/// One JSON file holds each wire exactly as scanned with the phone-clock time it was imported. The
/// store never interprets a wire: the Pay screen verifies every one with the pinned server key and
/// this phone's key on every load, so the file is never trusted. Wires are only ever added, never
/// replaced or removed, and a file that cannot be read is an error, never treated as empty, so a
/// later import can never overwrite what is stored.
public final class ImportedAllowances: @unchecked Sendable {
    public struct Stored: Equatable, Sendable {
        public let wire: Data
        /// Phone-clock unix seconds when it was imported (orders the "newest import" default).
        public let importedAt: Int64
    }

    public static let fileName = "imported-allowances.json"

    private struct File: Codable {
        var version: Int
        var allowances: [Row]
    }

    private struct Row: Codable {
        /// base64url, no padding (the transport encoding).
        var wire: String
        var importedAt: Int64
    }

    private let url: URL

    /// `url` is a JSON file owned by this store. Every instance on the same file shares one lock
    /// (FileLocks), like SerialReservations.
    public init(url: URL) {
        self.url = url
    }

    /// The file next to `serials`' file: imported allowances are bound to the same payment key as
    /// the serial counters, so they live (and are lost on a reinstall) in the same folder.
    public convenience init(nextTo serials: SerialReservations) {
        self.init(url: serials.fileURL.deletingLastPathComponent().appendingPathComponent(Self.fileName))
    }

    /// Every stored wire, oldest import first. Throws `storage` when the file exists and cannot be
    /// read or does not parse.
    public func load() throws -> [Stored] {
        let (lock, file) = try FileLocks.resolve(url)
        lock.lock()
        defer { lock.unlock() }
        return try read(file)
    }

    /// Appends `wire`. Returns false, changing nothing, when the identical bytes are already stored.
    /// Throws `storage` when the file cannot be read (nothing is written then) or saved.
    @discardableResult
    public func add(_ wire: Data, importedAt: Int64) throws -> Bool {
        let (lock, file) = try FileLocks.resolve(url)
        lock.lock()
        defer { lock.unlock() }
        var rows = try read(file)
        if rows.contains(where: { $0.wire == wire }) { return false }
        rows.append(Stored(wire: Data(wire), importedAt: importedAt))
        let encoded = File(version: 1, allowances: rows.map { Row(wire: Base64URL.encode($0.wire), importedAt: $0.importedAt) })
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            var options: Data.WritingOptions = [.atomic]
            #if os(iOS)
            // The same protection as the app's stored certificates: readable after the first unlock.
            options.insert(.completeFileProtectionUntilFirstUserAuthentication)
            #endif
            try JSONEncoder().encode(encoded).write(to: file, options: options)
        } catch {
            throw PaymentError.storage
        }
        return true
    }

    private func read(_ file: URL) throws -> [Stored] {
        guard FileManager.default.fileExists(atPath: file.path) else { return [] }
        do {
            let decoded = try JSONDecoder().decode(File.self, from: Data(contentsOf: file))
            guard decoded.version == 1 else { throw PaymentError.storage }
            return try decoded.allowances.map { Stored(wire: try Base64URL.decode($0.wire), importedAt: $0.importedAt) }
        } catch {
            throw PaymentError.storage
        }
    }
}
