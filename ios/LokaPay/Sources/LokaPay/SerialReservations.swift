import Foundation

/// Durable serial reservation (PLAN.md Shared Contracts: "the phone durably reserves the next
/// serial before signing"). `reserve` writes the advanced counter to disk BEFORE it returns a
/// serial, so a crash after signing can never hand the same serial to a different note.
/// The only deliberate reuse is the labelled cheat control, which signs a serial it already used.
public final class SerialReservations: @unchecked Sendable {
    private let url: URL
    private let lock: NSLock

    /// `url` is a JSON file owned by this store (for example in Application Support). Every
    /// instance on the same file shares one lock, so concurrent reservations never collide.
    public init(url: URL) {
        self.url = FileLocks.canonical(url)
        self.lock = FileLocks.lock(for: url)
    }

    /// Returns the next unused serial for `allowanceId` (0 to 255) after persisting the
    /// reservation. Throws `serialsExhausted` once all 256 are used: open a new allowance.
    public func reserve(allowanceId: UInt64) throws -> UInt8 {
        lock.lock()
        defer { lock.unlock() }
        var table = try load()
        let key = String(allowanceId)
        let next = table[key] ?? 0
        guard next != 256 else { throw PaymentError.serialsExhausted }
        guard (0...255).contains(next) else { throw PaymentError.storage }
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
            let table = try JSONDecoder().decode([String: Int].self, from: Data(contentsOf: url))
            // A counter outside 0...256 is corruption: never use it, never "fix" it to 0.
            guard table.values.allSatisfy({ (0...256).contains($0) }),
                  table.keys.allSatisfy({ UInt64($0) != nil }) else { throw PaymentError.storage }
            return table
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
