import Foundation

enum EncounterHistoryError: Error { case invalid }

/// Shadow-only history of authenticated connected identities.
/// Never grants carrier authority or changes routing; caller serializes access.
final class EncounterHistory {
    struct Record: Codable, Equatable { let identity: String; let encounters: Int; let lastEncounter: Int64; let estimate: Double }
    private struct Session { let since: Int64; var counted = false }
    private let capacity: Int
    private var records: [String: Record] = [:]
    private var active: [String: Session] = [:]
    private var lastObservation: Int64?
    init(capacity: Int = 64) { precondition((1...256).contains(capacity)); self.capacity = capacity }
    func clear() { records.removeAll(); active.removeAll(); lastObservation = nil }
    func saved(now: Int64) -> [Record] {
        records.values.filter { now >= $0.lastEncounter && now - $0.lastEncounter < 86_400_000 }.sorted { $0.identity < $1.identity }
    }
    func restore(_ saved: [Record], now: Int64) throws {
        guard now >= 0, saved.count <= capacity, Set(saved.map(\.identity)).count == saved.count,
              saved.allSatisfy({ $0.identity.utf8.count == 64 && $0.identity.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } && (1...1_000_000).contains($0.encounters) && $0.lastEncounter >= 0 && $0.estimate.isFinite && (0...1).contains($0.estimate) }) else { throw EncounterHistoryError.invalid }
        let valid = saved.filter { now >= $0.lastEncounter && now - $0.lastEncounter < 86_400_000 }
        clear(); for record in valid { records[record.identity] = record }; lastObservation = now
    }
    func observe(_ identities: Set<String>, now: Int64) {
        precondition(now >= 0)
        if let last = lastObservation {
            if now < last { clear() }
            else if now - last > 30_000 { active.removeAll() }
        }
        lastObservation = now
        records = records.filter { now - $0.value.lastEncounter < 86_400_000 }
        let peers = Set(identities.filter { $0.utf8.count == 64 && $0.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }.sorted().prefix(capacity))
        active = active.filter { peers.contains($0.key) }
        for id in peers.sorted() {
            var session = active[id] ?? Session(since: now)
            active[id] = session
            guard !session.counted, now - session.since >= 5_000 else { continue }
            session.counted = true; active[id] = session
            let old = records[id]
            if let old, now - old.lastEncounter < 60_000 { continue }
            if old == nil && records.count >= capacity, let victim = records.values.min(by: {
                $0.lastEncounter == $1.lastEncounter ? $0.identity < $1.identity : $0.lastEncounter < $1.lastEncounter
            }) { records.removeValue(forKey: victim.identity) }
            let previous = old.map { decay($0, now: now) } ?? 0
            records[id] = Record(identity: id, encounters: min((old?.encounters ?? 0) + 1, 1_000_000), lastEncounter: now, estimate: previous + (1 - previous) * 0.75)
        }
    }
    func snapshot(now: Int64) -> [Record] {
        records.values.filter { now >= $0.lastEncounter && now - $0.lastEncounter < 86_400_000 }
            .map { Record(identity: $0.identity, encounters: $0.encounters, lastEncounter: $0.lastEncounter, estimate: decay($0, now: now)) }
            .sorted { $0.identity < $1.identity }
    }
    private func decay(_ record: Record, now: Int64) -> Double {
        record.estimate * pow(0.98, Double(max(0, now - record.lastEncounter)) / 60_000)
    }
}

/// Development diagnostics only; process-scoped aliases cannot identify a person.
final class EncounterTrace {
    struct Sample: Codable { let time: Int64; let peers: [Int] }
    struct Snapshot: Codable { let version: Int; let scope: String; let samples: [Sample]; let dropped: Int }
    private var scope = UUID().uuidString
    private var start: Int64?
    private var last: Int64?
    private var aliases: [String: Int] = [:]
    private var samples: [Sample] = []
    private var dropped = 0
    func clear() {
        scope = UUID().uuidString; start = nil; last = nil
        aliases.removeAll(); samples.removeAll(); dropped = 0
    }
    func observe(_ identities: Set<String>, now: Int64) {
        precondition(now >= 0)
        if let last, now < last { clear() }
        if start == nil { start = now }; last = now
        let peers = Array(identities.filter { $0.utf8.count == 64 && $0.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }.sorted().prefix(64))
        guard samples.count < 512, aliases.count + peers.filter({ aliases[$0] == nil }).count <= 256 else {
            dropped = min(dropped, Int.max - 1) + 1; return
        }
        let ids = peers.map { id -> Int in
            if let alias = aliases[id] { return alias }
            let alias = aliases.count + 1; aliases[id] = alias; return alias
        }.sorted()
        samples.append(Sample(time: now - start!, peers: ids))
    }
    func snapshot() -> Snapshot { Snapshot(version: 1, scope: scope, samples: samples, dropped: dropped) }
}
