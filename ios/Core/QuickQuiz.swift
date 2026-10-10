import Foundation

struct GameEvent: Equatable {
    var kind: String; var id: String; var session: String; var pack: String
    var expires: Int64; var revision = 0; var value = "-"; var ref = "-"
    func encode() throws -> String {
        let text = "L1|G|1|\(kind)|\(id)|\(session)|\(pack)|\(expires)|\(revision)|\(value)|\(ref)"
        _ = try Self.decode(text); return text
    }
    static func uuid(_ s: String) throws { guard UUID(uuidString: s)?.uuidString.lowercased() == s else { throw QuizError.invalid } }
    static func identity(_ s: String) throws { guard s.count == 64, s.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { throw QuizError.invalid } }
    static func decode(_ text: String) throws -> GameEvent {
        guard text.utf8.count <= 1024, text.utf8.allSatisfy({ (32...126).contains($0) }) else { throw QuizError.invalid }
        let p = text.components(separatedBy: "|")
        guard p.count == 11, Array(p.prefix(3)) == ["L1", "G", "1"], ["C","K","I","J","S","M","U","A","R","E"].contains(p[3]) else { throw QuizError.invalid }
        try uuid(p[4]); try uuid(p[5]); try identity(p[6]); if p[10] != "-" { try uuid(p[10]) }
        guard let at = Int64(p[7]), at >= 0, String(at) == p[7], let rev = Int(p[8]), (0...10).contains(rev), String(rev) == p[8], p[9].count <= 450 else { throw QuizError.invalid }
        return GameEvent(kind: p[3], id: p[4], session: p[5], pack: p[6], expires: at, revision: rev, value: p[9], ref: p[10])
    }
}
enum QuizError: Error { case invalid }
struct QuizMove: Equatable { var choice: Int; var id: String }
struct QuizSession {
    var id: String; var host: String; var guest: String; var expires: Int64; var phase: String; var moves: [QuizMove] = []
    var gameId: String { "quick_quiz" }
    var gameVersion: Int { 1 }
    var rulesVersion: Int { 1 }
    var revision: Int { moves.count }
    var turn: String { revision % 2 == 0 ? host : guest }
    func scores(_ answers: [Int]) -> [Int] { [0,1].map { player in moves.enumerated().filter { $0.offset % 2 == player && $0.element.choice == answers[$0.offset] }.count } }
}
/// Serialized by the existing app owner. Durable commits precede network effects.
final class QuickQuiz {
    static func canQueue(_ queuedPackets: Int) -> Bool { (0..<96).contains(queuedPackets) }
    struct Pending { var peer: String; var event: GameEvent; var packet = "-" }
    let own: String; let pack: String
    private let answers: [Int]; private let clock: () -> Int64
    private let save: (String) throws -> Void; private let send: (String,String) throws -> String; private let discard: (String) -> Void
    private(set) var session: QuizSession?
    private var outbox: [String:Pending] = [:]
    private var recent: [String:Int64] = [:]; private var ackAt: [String:Int64] = [:]
    private var draft: (revision: Int, move: QuizMove)?
    private var lastPeer: Int64 = 0; private var recovering = false
    private(set) var notice = "Choose a friend to play"
    var pendingCount: Int { outbox.count }
    var paused: Bool { recovering || clock() - lastPeer > 90000 }
    var canAnswer: Bool {
        guard let s = session else { return false }
        return s.phase == "active" && s.revision < answers.count && s.turn == own && !paused && draft == nil && !outbox.values.contains { ["M","U","S","J"].contains($0.event.kind) }
    }
    init(own: String, pack: String, answers: [Int], clock: @escaping () -> Int64, save: @escaping (String) throws -> Void, send: @escaping (String,String) throws -> String, discard: @escaping (String) -> Void) throws {
        try GameEvent.identity(own); try GameEvent.identity(pack)
        guard answers.count == 10, answers.allSatisfy({ (0...3).contains($0) }) else { throw QuizError.invalid }
        self.own = own; self.pack = pack; self.answers = answers; self.clock = clock; self.save = save; self.send = send; self.discard = discard
    }
    private func event(_ kind: String, _ value: String = "-", _ ref: String = "-", revision: Int? = nil) -> GameEvent {
        GameEvent(kind: kind, id: UUID().uuidString.lowercased(), session: session!.id, pack: pack, expires: clock() + 120000, revision: revision ?? session!.revision, value: value, ref: ref)
    }
    private func peer() -> String { session!.host == own ? session!.guest : session!.host }
    private func enqueue(_ e: GameEvent) throws { guard outbox.count < 8 else { throw QuizError.invalid }; outbox[e.id] = Pending(peer: peer(), event: e) }
    private func remove(_ id: String) -> String? { let p = outbox.removeValue(forKey: id)?.packet; return p == "-" ? nil : p }
    private func body(_ s: QuizSession) -> String { s.phase + ";" + (s.moves.isEmpty ? "-" : s.moves.map { "\($0.choice):\($0.id)" }.joined(separator: ",")) }
    private func moves(_ raw: String) throws -> [QuizMove] {
        if raw == "-" { return [] }
        let log = try raw.components(separatedBy: ",").map { item -> QuizMove in
            let p = item.components(separatedBy: ":")
            guard p.count == 2, let c = Int(p[0]), (0...3).contains(c), String(c) == p[0] else { throw QuizError.invalid }
            try GameEvent.uuid(p[1]); return QuizMove(choice: c, id: p[1])
        }
        guard log.count <= 10, Set(log.map(\.id)).count == log.count else { throw QuizError.invalid }; return log
    }
    private func snapshot() throws { try enqueue(event("S", body(session!))) }
    private func transaction(_ block: () throws -> Void) throws {
        let before = try export(), previousNotice = notice, beforeLast = lastPeer, beforeRecovery = recovering
        do { try block(); try save(export()) }
        catch { try restore(before); lastPeer = beforeLast; recovering = beforeRecovery; notice = previousNotice; throw error }
    }
    func invite(_ friend: String) throws {
        try GameEvent.identity(friend)
        guard friend != own, session == nil || session!.phase == "ended" || session!.expires <= clock() else { throw QuizError.invalid }
        let stale = outbox.values.map(\.packet)
        try transaction {
            outbox.removeAll(); draft = nil; session = QuizSession(id: UUID().uuidString.lowercased(), host: own, guest: friend, expires: clock() + 86400000, phase: "inviting")
            recovering = false; lastPeer = clock(); try enqueue(event("C")); notice = "Inviting…"
        }
        stale.filter { $0 != "-" }.forEach(discard); flush()
    }
    func accept() throws {
        guard let s = session, s.phase == "invited", s.guest == own, s.expires > clock() else { throw QuizError.invalid }
        try transaction { session!.phase = "joining"; session!.expires = clock() + 86400000; try enqueue(event("J")); notice = "Waiting for your friend" }; flush()
    }
    func answer(_ choice: Int) throws {
        guard canAnswer, (0...3).contains(choice) else { throw QuizError.invalid }
        try transaction {
            let action = UUID().uuidString.lowercased()
            if session!.host == own { session!.moves.append(QuizMove(choice: choice, id: action)); try enqueue(event("U", String(choice), action)); notice = "Waiting for your friend" }
            else { draft = (session!.revision, QuizMove(choice: choice, id: action)); try enqueue(event("M", String(choice), action)); notice = "Waiting for confirmation" }
        }; flush()
    }
    func resume() throws {
        guard let s = session, ["active","joining"].contains(s.phase), s.expires > clock() else { throw QuizError.invalid }
        try transaction { recovering = true; if s.host == own { try snapshot() } else { try enqueue(event("R")) }; notice = "Reconnecting…" }; flush()
    }
    func end() throws {
        guard session != nil else { throw QuizError.invalid }
        let stale = outbox.values.map(\.packet)
        try transaction { outbox.removeAll(); draft = nil; session!.phase = "ended"; try enqueue(event("E")); notice = "Game ended" }
        stale.filter { $0 != "-" }.forEach(discard); flush()
    }
    func receive(_ sender: String, _ text: String) throws {
        try GameEvent.identity(sender); guard sender != own else { throw QuizError.invalid }
        let e = try GameEvent.decode(text), now = clock()
        guard e.pack == pack, e.expires > now, e.expires <= now + 150000 else { throw QuizError.invalid }
        if e.kind == "C" {
            guard e.revision == 0, e.value == "-", e.ref == "-" else { throw QuizError.invalid }
            respond(sender, e, "K"); return
        }
        if e.kind == "I", session?.id != e.session {
            guard e.revision == 0, e.value == "-", e.ref == "-", session == nil || session!.phase == "ended" || session!.expires <= now,
                  (recent[e.id] ?? 0) <= now, recent.filter({ $0.value > now }).count < 64 else { throw QuizError.invalid }
            let stale = outbox.values.map(\.packet)
            try transaction { outbox.removeAll(); draft = nil; recent = recent.filter { $0.value > now }; session = QuizSession(id: e.session, host: sender, guest: own, expires: e.expires, phase: "invited"); recent[e.id] = e.expires; lastPeer = now; notice = "Game invitation" }
            stale.filter { $0 != "-" }.forEach(discard); respond(sender, e, "A"); return
        }
        guard let s = session, e.session == s.id, sender == peer(), s.expires > now else { throw QuizError.invalid }
        if ["I","J","K"].contains(e.kind), e.revision != 0 || e.value != "-" { throw QuizError.invalid }
        if ["I","J","R","E","S"].contains(e.kind), e.ref != "-" { throw QuizError.invalid }
        if ["A","R","E"].contains(e.kind), e.value != "-" { throw QuizError.invalid }
        if e.kind == "A", e.ref == "-" { throw QuizError.invalid }

        var discarded: [String] = []; var ack = !["A","K"].contains(e.kind)
        try transaction {
            lastPeer = now
            switch e.kind {
            case "K":
                guard s.host == own, s.phase == "inviting", e.value == "-", outbox[e.ref]?.event.kind == "C" else { throw QuizError.invalid }
                if let p = remove(e.ref) { discarded.append(p) }; try enqueue(event("I")); session!.phase = "waiting"; session!.expires = now + 120000; notice = "Waiting for your friend"
            case "I": guard s.host == sender, ["invited","joining","active","ended"].contains(s.phase) else { throw QuizError.invalid }
            case "J":
                guard s.host == own, ["waiting","active"].contains(s.phase), e.value == "-" else { throw QuizError.invalid }
                if s.phase == "waiting" { session!.phase = "active"; session!.expires = now + 86400000; try snapshot() }
            case "A":
                if let p = outbox[e.ref] { guard !["M", "C"].contains(p.event.kind), e.revision >= p.event.revision else { throw QuizError.invalid }; if let id = remove(e.ref) { discarded.append(id) }; if p.event.kind == "S" {
                    recovering = false
                    for id in outbox.values.filter({ $0.event.kind == "I" || $0.event.kind == "U" && $0.event.revision <= e.revision }).map({ $0.event.id }) { if let packet = remove(id) { discarded.append(packet) } }
                } }
            case "M":
                guard s.host == own, s.phase == "active", e.ref != "-", let choice = Int(e.value), (0...3).contains(choice), String(choice) == e.value else { throw QuizError.invalid }
                if let at = s.moves.firstIndex(where: { $0.id == e.ref }) {
                    guard at % 2 == 1, at == e.revision, s.moves[at].choice == choice else { throw QuizError.invalid }
                    if !outbox.values.contains(where: { $0.event.kind == "S" }) { try snapshot() }
                } else {
                    guard e.revision == s.revision, s.turn == sender, s.revision < 10, !outbox.values.contains(where: { ["S","U"].contains($0.event.kind) }) else { throw QuizError.invalid }
                    session!.moves.append(QuizMove(choice: choice, id: e.ref)); try enqueue(event("U", String(choice), e.ref))
                }; ack = false
            case "U":
                guard sender == s.host, s.phase == "active", e.ref != "-", let choice = Int(e.value), (0...3).contains(choice), String(choice) == e.value, e.revision > 0 else { throw QuizError.invalid }
                let move = QuizMove(choice: choice, id: e.ref)
                if e.revision <= s.revision { guard s.moves[e.revision - 1] == move else { throw QuizError.invalid } }
                else if e.revision != s.revision + 1 { if !outbox.values.contains(where: { $0.event.kind == "R" }) { try enqueue(event("R")) }; recovering = true; ack = false }
                else {
                    guard !s.moves.contains(where: { $0.id == e.ref }) else { throw QuizError.invalid }
                    if s.turn == own { guard draft?.revision == s.revision, draft?.move == move else { throw QuizError.invalid } }
                    session!.moves.append(move); if draft?.move.id == e.ref { draft = nil }
                    for id in outbox.values.filter({ $0.event.kind == "M" && $0.event.ref == e.ref }).map({ $0.event.id }) { if let p = remove(id) { discarded.append(p) } }
                    recovering = false
                }
            case "S":
                guard sender == s.host, ["joining","active","ended"].contains(s.phase) else { throw QuizError.invalid }
                let fields = e.value.components(separatedBy: ";")
                guard fields.count == 2, ["active","ended"].contains(fields[0]) else { throw QuizError.invalid }
                let log = try moves(fields[1]); guard log.count == e.revision else { throw QuizError.invalid }
                if log.count < s.revision { guard Array(s.moves.prefix(log.count)) == log else { throw QuizError.invalid } }
                else {
                    guard Array(log.prefix(s.revision)) == s.moves, !(s.phase == "ended" && fields[0] != "ended") else { throw QuizError.invalid }
                    if let d = draft, log.count > d.revision { guard log[d.revision] == d.move else { throw QuizError.invalid } }
                    session!.phase = fields[0]; session!.moves = log
                    if s.phase == "joining" { session!.expires = now + 86400000 }
                    for id in Array(outbox.keys) {
                        if let p = outbox[id], ["J","R"].contains(p.event.kind) || log.contains(where: { $0.id == p.event.ref }), let packet = remove(id) { discarded.append(packet) }
                    }
                    if let d = draft {
                        if log.count > d.revision || fields[0] == "ended" { draft = nil }
                        else if !outbox.values.contains(where: { $0.event.kind == "M" }) { try enqueue(event("M", String(d.move.choice), d.move.id, revision: d.revision)) }
                    }
                    recovering = false
                }
            case "R":
                guard s.host == own, ["active","ended"].contains(s.phase), e.value == "-" else { throw QuizError.invalid }
                if !outbox.values.contains(where: { $0.event.kind == "S" }) { try snapshot() }
            case "E":
                guard e.value == "-" else { throw QuizError.invalid }; session!.phase = "ended"; draft = nil
                for id in Array(outbox.keys) { if let p = remove(id) { discarded.append(p) } }; recovering = false
            default: throw QuizError.invalid
            }
            if ack { recent = recent.filter { $0.value > now }; guard recent[e.id] != nil || recent.count < 64 else { throw QuizError.invalid }; recent[e.id] = e.expires }
            notice = session!.phase == "ended" ? "Game ended" : session!.revision == 10 ? "Quiz complete" : recovering ? "Reconnecting…" : session!.phase == "active" && session!.turn == own ? "Your turn" : "Waiting for your friend"
        }
        discarded.forEach(discard); if ack { respond(sender, e, "A") }; flush()
    }
    private func respond(_ sender: String, _ e: GameEvent, _ kind: String) {
        let key = sender + ":" + e.id
        if let at = ackAt[key], clock() - at < 15000 { return }
        if ackAt.count >= 64 { ackAt.removeAll() }
        let response = GameEvent(kind: kind, id: UUID().uuidString.lowercased(), session: e.session, pack: pack, expires: clock() + 120000, revision: session?.id == e.session ? session!.revision : 0, ref: e.id)
        do { let packet = try send(sender, response.encode()); discard(packet); ackAt[key] = clock() } catch { }
    }
    func tick() throws {
        let expired = outbox.values.filter { $0.event.expires <= clock() }
        if !expired.isEmpty || (session.map { $0.expires <= clock() && $0.phase != "ended" } ?? false) {
            try transaction {
                for p in expired { outbox.removeValue(forKey: p.event.id) }; recovering = true; notice = "Reconnecting…"
                if session!.expires <= clock() || ["inviting", "waiting", "invited"].contains(session!.phase) { session!.phase = "ended"; notice = "Game or invitation expired" }
            }; expired.map(\.packet).filter { $0 != "-" }.forEach(discard)
        }; flush()
    }
    private func flush() {
        guard let item = outbox.values.filter({ $0.packet == "-" && $0.event.expires > clock() }).sorted(by: { $0.event.expires == $1.event.expires ? $0.event.id < $1.event.id : $0.event.expires < $1.event.expires }).first else { return }
        do {
            let packet = try send(item.peer, item.event.encode()); outbox[item.event.id]?.packet = packet
            do { try save(export()) } catch { outbox[item.event.id]?.packet = "-"; discard(packet); throw error }
        } catch { notice = "Waiting for a local connection" }
    }
    func export() throws -> String {
        let header = session.map { "Q1|\(pack)\n\($0.id)|\($0.host)|\($0.guest)|\($0.expires)|\(body($0))" } ?? "Q1|\(pack)\n-"
        let pending = try outbox.values.sorted { $0.event.id < $1.event.id }.map { "P|\($0.peer)|\($0.packet)|\(try $0.event.encode())" }
        let draftLines = draft.map { ["V|\($0.revision)|\($0.move.choice)|\($0.move.id)"] } ?? []
        let raw = ([header] + draftLines + pending + recent.keys.sorted().map { "D|\($0)|\(recent[$0]!)" }).joined(separator: "\n")
        guard raw.utf8.count <= 16384 else { throw QuizError.invalid }; return raw
    }
    func restore(_ raw: String) throws {
        guard raw.utf8.count <= 16384 else { throw QuizError.invalid }
        let lines = raw.components(separatedBy: "\n")
        guard (2...75).contains(lines.count), lines[0] == "Q1|\(pack)" else { throw QuizError.invalid }
        var next: QuizSession?
        if lines[1] != "-" {
            let p = lines[1].components(separatedBy: "|")
            guard p.count == 5 else { throw QuizError.invalid }; try GameEvent.uuid(p[0]); try GameEvent.identity(p[1]); try GameEvent.identity(p[2])
            let b = p[4].components(separatedBy: ";")
            guard [p[1],p[2]].contains(own), p[1] != p[2], let at = Int64(p[3]), b.count == 2, ["inviting","waiting","invited","joining","active","ended"].contains(b[0]) else { throw QuizError.invalid }
            next = QuizSession(id: p[0], host: p[1], guest: p[2], expires: at, phase: b[0], moves: try moves(b[1]))
        }
        var pending: [String:Pending] = [:]; var seen: [String:Int64] = [:]; var nextDraft: (revision: Int, move: QuizMove)?
        for line in lines.dropFirst(2) {
            if line.hasPrefix("V|") {
                let p = line.components(separatedBy: "|")
                guard p.count == 4, nextDraft == nil, let rev = Int(p[1]), let choice = Int(p[2]), (0...9).contains(rev), (0...3).contains(choice), next?.guest == own, rev == next?.revision, rev % 2 == 1 else { throw QuizError.invalid }
                try GameEvent.uuid(p[3]); nextDraft = (rev, QuizMove(choice: choice, id: p[3]))
            } else if line.hasPrefix("P|") {
                let p = line.split(separator: "|", maxSplits: 3, omittingEmptySubsequences: false).map(String.init)
                guard p.count == 4, let s = next else { throw QuizError.invalid }; try GameEvent.identity(p[1]); if p[2] != "-" { try GameEvent.uuid(p[2]) }
                let e = try GameEvent.decode(p[3]); guard e.pack == pack, e.session == s.id, p[1] == (s.host == own ? s.guest : s.host), pending[e.id] == nil else { throw QuizError.invalid }
                pending[e.id] = Pending(peer: p[1], event: e, packet: p[2])
            } else {
                let p = line.components(separatedBy: "|"); guard p.count == 3, p[0] == "D", let at = Int64(p[2]), seen[p[1]] == nil else { throw QuizError.invalid }
                try GameEvent.uuid(p[1]); seen[p[1]] = at
            }
        }
        guard pending.count <= 8, seen.count <= 64 else { throw QuizError.invalid }
        session = next; draft = nextDraft; outbox = pending; recent = seen; recovering = next.map { ["joining","active"].contains($0.phase) } ?? false; lastPeer = 0; notice = next == nil ? "Choose a friend to play" : "Reconnecting…"
    }
}
