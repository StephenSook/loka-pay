import Foundation

/// Durable serial reservation (PLAN.md Shared Contracts: "the phone durably reserves the next
/// serial before signing"). `reserve` writes the advanced counter to disk BEFORE it returns a
/// serial, so a crash after signing can never hand the same serial to a different note.
/// The only deliberate reuse is the labelled cheat control, which signs a serial it already used.
public final class SerialReservations: @unchecked Sendable {
    private let url: URL
    private let lock = NSLock()

    /// `url` is a JSON file owned by this store (for example in Application Support).
    public init(url: URL) {
        self.url = url
    }

    /// Returns the next unused serial for `allowanceId` (0 to 255) after persisting the
    /// reservation. Throws `serialsExhausted` once all 256 are used: open a new allowance.
    public func reserve(allowanceId: UInt64) throws -> UInt8 {
        lock.lock()
        defer { lock.unlock() }
        var table = try load()
        let key = String(allowanceId)
        let next = table[key] ?? 0
        guard next <= 255 else { throw PaymentError.serialsExhausted }
        table[key] = next + 1
        try save(table)
        return UInt8(next)
    }

    /// Serials not yet reserved for `allowanceId`.
    public func remaining(allowanceId: UInt64) throws -> Int {
        lock.lock()
        defer { lock.unlock() }
        return 256 - (try load()[String(allowanceId)] ?? 0)
    }

    private func load() throws -> [String: Int] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        do {
            return try JSONDecoder().decode([String: Int].self, from: Data(contentsOf: url))
        } catch {
            // A corrupt file must never silently reset counters to 0 (that would reuse serials).
            throw PaymentError.storage
        }
    }

    private func save(_ table: [String: Int]) throws {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(table).write(to: url, options: [.atomic])
        } catch {
            throw PaymentError.storage
        }
    }
}
