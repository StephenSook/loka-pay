import CryptoKit
import Foundation

/// The merchant's record of notes accepted offline (protocol/PAYMENT-V1.md section 6,
/// merchant checks 6 and 7; task 2.20). `accept` refuses a serial it has already seen for
/// that allowance and any note that would take the allowance's unsettled total past the
/// certificate's offline limit, and it persists the reservation BEFORE returning, so a
/// relaunch can never forget value the merchant is already carrying.
public final class OfflineLedger: @unchecked Sendable {
    public enum State: String, Codable, Sendable {
        /// Accepted offline, not yet confirmed. Counts against the offline limit.
        case pending
        /// Confirmed settled on chain.
        case settled
        /// The chain refused it (for example the serial was already spent elsewhere).
        case refused
    }

    public struct Entry: Codable, Equatable, Sendable {
        public let noteIdHex: String
        public let allowanceId: UInt64
        public let serial: UInt8
        public let amount: UInt64
        public let acceptedAt: Int64
        public var state: State
        /// The 238-byte note wire, kept so a pending note can be uploaded or re-injected.
        public let wireHex: String
    }

    private let url: URL

    /// Every instance on the same file shares one lock (FileLocks), so two ledger objects can
    /// never both approve capacity or overwrite each other's accepted notes. Each operation
    /// resolves the canonical path and fails closed (`storage`) if it cannot.
    public init(url: URL) {
        self.url = url
    }

    /// Records `note` as accepted offline, or throws `serialSeen` / `offlineLimit` and
    /// changes nothing. Call after `SignedNote.validate` and `Acceptance.check`.
    @discardableResult
    public func accept(note: SignedNote, certificate: AllowanceCertificate, now: Int64) throws -> Entry {
        let (lock, file) = try FileLocks.resolve(url)
        lock.lock()
        defer { lock.unlock() }
        var entries = try load(file)
        let allowance = note.note.allowanceId
        guard certificate.allowanceId == allowance else { throw PaymentError.allowanceMismatch }
        guard !entries.contains(where: { $0.allowanceId == allowance && $0.serial == note.note.serial }) else {
            throw PaymentError.serialSeen
        }
        let unsettled = try Self.pendingTotal(entries, allowanceId: allowance)
        let (total, overflow) = unsettled.addingReportingOverflow(note.note.amount)
        guard !overflow, total <= certificate.offlineLimit else { throw PaymentError.offlineLimit }
        let entry = Entry(noteIdHex: note.noteId.hex, allowanceId: allowance, serial: note.note.serial,
                          amount: note.note.amount, acceptedAt: now, state: .pending, wireHex: note.wire.hex)
        entries.append(entry)
        try save(entries, to: file)
        return entry
    }

    /// Moves a pending note to settled or refused. Either way it stops counting against the
    /// offline limit; its serial stays seen.
    public func resolve(noteId: Data, as state: State) throws {
        precondition(state != .pending, "resolve moves a note out of pending")
        let (lock, file) = try FileLocks.resolve(url)
        lock.lock()
        defer { lock.unlock() }
        var entries = try load(file)
        guard let i = entries.firstIndex(where: { $0.noteIdHex == noteId.hex }) else { throw PaymentError.storage }
        entries[i].state = state
        try save(entries, to: file)
    }

    /// Value accepted offline and not yet resolved, for one allowance.
    public func unsettledTotal(allowanceId: UInt64) throws -> UInt64 {
        let (lock, file) = try FileLocks.resolve(url)
        lock.lock()
        defer { lock.unlock() }
        return try Self.pendingTotal(try load(file), allowanceId: allowanceId)
    }

    /// Notes still waiting for settlement, oldest first (to upload or re-inject).
    public func pending() throws -> [Entry] {
        let (lock, file) = try FileLocks.resolve(url)
        lock.lock()
        defer { lock.unlock() }
        return try load(file).filter { $0.state == .pending }.sorted { $0.acceptedAt < $1.acceptedAt }
    }

    public func entries() throws -> [Entry] {
        let (lock, file) = try FileLocks.resolve(url)
        lock.lock()
        defer { lock.unlock() }
        return try load(file)
    }

    private static func pendingTotal(_ entries: [Entry], allowanceId: UInt64) throws -> UInt64 {
        var total: UInt64 = 0
        for e in entries where e.allowanceId == allowanceId && e.state == .pending {
            let (t, overflow) = total.addingReportingOverflow(e.amount)
            guard !overflow else { throw PaymentError.offlineLimit }
            total = t
        }
        return total
    }

    private func load(_ url: URL) throws -> [Entry] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        do {
            let entries = try JSONDecoder().decode([Entry].self, from: Data(contentsOf: url))
            // The retained note wire is the source of truth: every cached field must match it,
            // so a damaged record can never understate carried value or hide a serial.
            for e in entries {
                guard let wire = Data(hex: e.wireHex), wire.count == SignedNote.wireSize else { throw PaymentError.storage }
                let noteBytes = Data(wire.prefix(NoteV1.size))
                let note = try NoteV1.decode(noteBytes)
                guard note.allowanceId == e.allowanceId, note.serial == e.serial, note.amount == e.amount,
                      Data(SHA256.hash(data: noteBytes)).hex == e.noteIdHex else { throw PaymentError.storage }
            }
            return entries
        } catch {
            // A corrupt ledger must never read as empty: that would forget carried value.
            throw PaymentError.storage
        }
    }

    private func save(_ entries: [Entry], to url: URL) throws {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(entries).write(to: url, options: [.atomic])
        } catch {
            throw PaymentError.storage
        }
    }
}
