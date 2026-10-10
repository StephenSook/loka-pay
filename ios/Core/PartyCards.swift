import Foundation
import CryptoKit

struct PartyCard { var id: String; var game: String; var text: String; var intensity: String; var modes: Set<String>; var min: Int; var max: Int; var consent: Bool; var tags:Set<String> = ["clean"]; var adult = false; var alcohol = false; var gameName=""; var instructions:[String:String]=[:];var packs:Set<String>=["classic"];var stage=1;var namedText="" }
struct PartySettings: Equatable { var game: String; var mode: String; var intensity = "clean"; var consent = false; var drinking = false }
struct PartyMove: Equatable { var kind: String; var id: String }
struct PartySession {
    var id: String; var members: [String]; var settings: PartySettings; var expires: Int64; var phase: String; var accepted: Set<String>; var moves: [PartyMove] = []
    var host: String { members[0] }; var revision: Int { moves.count }; var turn: String { members[revision % members.count] }
}
struct PartyEvent {
    var kind: String; var id: String; var session: String; var pack: String; var expires: Int64
    var revision = 0; var value = "-"; var ref = "-"
    func encode() throws -> String { let text = "L1|G|2|\(kind)|\(id)|\(session)|\(pack)|\(expires)|\(revision)|\(value)|\(ref)"; _ = try Self.decode(text); return text }
    static func permitted(_ sender:String,_ text:String,_ pack:String,_ session:PartySession?,_ now:Int64) -> Bool {
        guard let e=try? decode(text) else { return false }
        return e.pack==pack && e.expires>now && e.expires<=now+150000 && (["C","K","I","A"].contains(e.kind) || (session.map{$0.id==e.session && $0.members.contains(sender) && $0.expires>now} ?? false))
    }
    static func decode(_ text: String) throws -> PartyEvent {
        guard text.utf8.count <= 2048, text.utf8.allSatisfy({ (32...126).contains($0) }) else { throw QuizError.invalid }
        let p = text.components(separatedBy: "|")
        guard p.count == 11, Array(p.prefix(3)) == ["L1","G","2"], ["C","K","I","J","S","M","U","A","R","E"].contains(p[3]) else { throw QuizError.invalid }
        try GameEvent.uuid(p[4]); try GameEvent.uuid(p[5]); try GameEvent.identity(p[6]); if p[10] != "-" { try GameEvent.uuid(p[10]) }
        guard let expires = Int64(p[7]), expires >= 0, String(expires) == p[7], let rev = Int(p[8]), (0...24).contains(rev), String(rev) == p[8] else { throw QuizError.invalid }
        return PartyEvent(kind: p[3], id: p[4], session: p[5], pack: p[6], expires: expires, revision: rev, value: p[9], ref: p[10])
    }
}
/// Serialized by the existing app owner. Four-device cap is a policy, not measured capacity.
final class PartyCards {
    struct Pending { var peer: String; var event: PartyEvent; var packet = "-" }
    let own: String; let pack: String; private let cards: [PartyCard]; private let clock: () -> Int64
    private let save: (String) throws -> Void; private let send: (String,String) throws -> String; private let discard: (String) -> Void
    private(set) var session: PartySession?; private(set) var notice = "Choose your vibe"
    private var pending: [String:Pending] = [:]; private var order: [String] = []
    private var invitations: [String:Int64] = [:]
    private var ackAt: [String:Int64] = [:]; private var draft: (revision: Int, move: PartyMove)?
    private var lastHost: Int64 = 0; private var recovering = false; private var removed: [String] = []
    var paused: Bool { recovering || clock() - lastHost > 90000 }
    var canAct: Bool { guard let s = session else { return false }; return s.phase == "active" && s.turn == own && !paused && draft == nil && !pending.values.contains { ["M","U","S","J"].contains($0.event.kind) } }
    func packetPermissions() -> [String:String] { Dictionary(uniqueKeysWithValues: pending.values.filter { $0.packet != "-" }.map { ($0.packet,$0.peer) }) }
    var peers: Set<String> { Set((session?.members ?? []).filter { $0 != own }) }
    init(own: String, pack: String, cards: [PartyCard], clock: @escaping () -> Int64, save: @escaping (String) throws -> Void, send: @escaping (String,String) throws -> String, discard: @escaping (String) -> Void) throws {
        try GameEvent.identity(own); try GameEvent.identity(pack); guard (1...300).contains(cards.count), Set(cards.map(\.id)).count == cards.count else { throw QuizError.invalid }
        self.own = own; self.pack = pack; self.cards = cards; self.clock = clock; self.save = save; self.send = send; self.discard = discard
    }
    func eligible(_ settings: PartySettings, _ count: Int) -> [PartyCard] {
        cards.filter { $0.game == settings.game && $0.modes.contains(settings.mode) && ($0.min...$0.max).contains(count) && (settings.intensity == "all" || $0.intensity == settings.intensity) && (settings.consent || !$0.consent) && (!$0.alcohol || settings.drinking) && (!$0.adult || settings.intensity != "clean") }.sorted { $0.id < $1.id }
    }
    func remaining(_ provided: PartySession? = nil) -> [PartyCard] {
        let s = provided ?? session!; var deck = eligible(s.settings, s.members.count)
        for move in s.moves {
            if deck.isEmpty { return [] }; deck.removeFirst()
            if move.kind == "shuffle", !deck.isEmpty, let number = UInt32(move.id.prefix(8), radix: 16) { let n = Int(number) % deck.count; deck = Array(deck.dropFirst(n)) + Array(deck.prefix(n)) }
        }
        return s.revision >= 24 ? [] : deck
    }
    var current: PartyCard? { session.flatMap { remaining($0).first } }
    private func event(_ kind: String, _ value: String = "-", _ ref: String = "-", revision: Int? = nil) -> PartyEvent { PartyEvent(kind: kind, id: UUID().uuidString.lowercased(), session: session!.id, pack: pack, expires: clock()+120000, revision: revision ?? session!.revision, value: value, ref: ref) }
    private func key(_ peer: String, _ id: String) -> String { peer + ":" + id }
    private func enqueue(_ peer: String, _ event: PartyEvent) throws { guard pending.count < 12 else { throw QuizError.invalid }; let k = key(peer,event.id); guard pending[k] == nil else { throw QuizError.invalid }; pending[k] = Pending(peer: peer,event: event); order.append(k) }
    private func remove(_ peer: String, _ id: String) { let k = key(peer,id); if let p = pending.removeValue(forKey:k), p.packet != "-" { removed.append(p.packet) }; order.removeAll { $0 == k } }
    private func broadcast(_ kind: String, _ value: String = "-", _ ref: String = "-") throws { let e = event(kind,value,ref); for p in peers.sorted() { try enqueue(p,e) } }
    private func body(_ s: PartySession) -> String { [s.settings.game,s.settings.mode,s.settings.intensity,s.settings.consent ? "1" : "0",s.settings.drinking ? "1" : "0",s.members.joined(separator:","),s.accepted.sorted().joined(separator:","),s.phase,s.moves.isEmpty ? "-" : s.moves.map { $0.kind + "." + $0.id }.joined(separator:",")].joined(separator:";") }
    private func parse(_ id: String, _ expires: Int64, _ value: String) throws -> PartySession {
        let p = value.components(separatedBy:";")
        guard p.count == 9, p[0].range(of:"^[a-z_]{1,40}$", options:.regularExpression) != nil, ["couples","friends","group"].contains(p[1]), ["clean","flirty","dirty","all"].contains(p[2]), ["0","1"].contains(p[3]), ["0","1"].contains(p[4]) else { throw QuizError.invalid }
        let members = p[5].components(separatedBy:","); for m in members { try GameEvent.identity(m) }
        guard (2...4).contains(members.count), Set(members).count == members.count, members.contains(own), p[1] == "group" ? members.count >= 3 : members.count == 2 else { throw QuizError.invalid }
        let accepted = Set(p[6].components(separatedBy:","))
        guard !accepted.isEmpty, accepted.isSubset(of:Set(members)), accepted.contains(members[0]) else { throw QuizError.invalid }
        let moves = try p[8] == "-" ? [] : p[8].components(separatedBy:",").map { raw -> PartyMove in
            let m = raw.components(separatedBy:"."); guard m.count == 2, ["done","skip","sip","shuffle"].contains(m[0]) else { throw QuizError.invalid }; try GameEvent.uuid(m[1]); return PartyMove(kind:m[0],id:m[1])
        }
        guard moves.count <= 24, Set(moves.map(\.id)).count == moves.count, ["lobby","invited","joining","active","complete","ended"].contains(p[7]) else { throw QuizError.invalid }
        let s = PartySession(id:id,members:members,settings:PartySettings(game:p[0],mode:p[1],intensity:p[2],consent:p[3]=="1",drinking:p[4]=="1"),expires:expires,phase:p[7],accepted:accepted,moves:moves)
        let deck = eligible(s.settings,members.count)
        guard !deck.isEmpty, moves.count <= min(24,deck.count), s.settings.drinking || !moves.contains(where:{$0.kind=="sip"}), !["active","complete"].contains(s.phase) || accepted.count == members.count else { throw QuizError.invalid }
        guard s.phase != "active" || moves.count < min(24,deck.count), s.phase != "complete" || moves.count == min(24,deck.count) else { throw QuizError.invalid }
        return s
    }
    private func transaction(_ action: () throws -> Void) throws {
        let before = try export(), oldNotice = notice, oldLast = lastHost, oldRecovery = recovering; removed = []
        do { try action(); try save(export()) } catch { try restore(before); notice = oldNotice; lastHost = oldLast; recovering = oldRecovery; removed = []; throw error }
        removed.forEach(discard); removed = []
    }
    func invite(_ players: [String], _ settings: PartySettings) throws {
        guard session == nil || ["ended","complete"].contains(session!.phase) || session!.expires <= clock() else { throw QuizError.invalid }
        let s = PartySession(id:UUID().uuidString.lowercased(),members:[own]+players,settings:settings,expires:clock()+120000,phase:"lobby",accepted:[own])
        _ = try parse(s.id,s.expires,body(s))
        try transaction { removed = pending.values.filter{$0.packet != "-"}.map(\.packet); pending = [:]; order = []; draft = nil; session = s; recovering = false; lastHost = clock(); try broadcast("C"); notice = "Inviting…" }; flush()
    }
    func accept() throws { guard let s = session, s.phase == "invited", own != s.host, s.expires > clock() else { throw QuizError.invalid }; try transaction { session!.phase = "joining"; try enqueue(s.host,event("J",revision:0)); notice = "Waiting for the other players" }; flush() }
    func act(_ kind: String) throws {
        guard canAct, ["done","skip","sip","shuffle"].contains(kind), kind != "sip" || session!.settings.drinking else { throw QuizError.invalid }
        try transaction { let move = PartyMove(kind:kind,id:UUID().uuidString.lowercased()); if session!.host == own { try commit(move) } else { draft = (session!.revision,move); try enqueue(session!.host,event("M",kind,move.id)); notice = "Waiting for confirmation" } }; flush()
    }
    private func commit(_ move: PartyMove) throws { guard !remaining().isEmpty else { throw QuizError.invalid }; session!.moves.append(move); if remaining().isEmpty { session!.phase = "complete" }; try broadcast("U",move.kind,move.id); notice = session!.phase == "complete" ? "Round complete" : "Waiting for the other players" }
    func resume() throws { guard let s = session, ["active","joining","complete"].contains(s.phase), s.expires > clock() else { throw QuizError.invalid }; try transaction { recovering = true; if s.host == own { try snapshot() } else { try enqueue(s.host,event("R")) }; notice = "Reconnecting…" }; flush() }
    func end() throws { guard session != nil else { throw QuizError.invalid }; try transaction { removed = pending.values.filter{$0.packet != "-"}.map(\.packet); pending = [:]; order = []; draft = nil; session!.phase = "ended"; if session!.host == own { try broadcast("E") } else { try enqueue(session!.host,event("E")) }; notice = "Game ended" }; flush() }
    private func snapshot() throws { for peer in peers.sorted() where !pending.values.contains(where:{$0.peer==peer && $0.event.kind=="S"}) { try enqueue(peer,event("S",body(session!))) } }
    private func reply(_ peer: String, _ e: PartyEvent, _ kind: String) {
        let stamp = clock(), k = key(peer,e.id); if stamp - (ackAt[k] ?? 0) < 15000 { return }
        ackAt = ackAt.filter{stamp-$0.value<120000}; if ackAt.count >= 64 { return }; ackAt[k] = stamp
        _ = try? send(peer,PartyEvent(kind:kind,id:UUID().uuidString.lowercased(),session:e.session,pack:pack,expires:stamp+120000,revision:session?.revision ?? 0,value:"-",ref:e.id).encode())
    }
    func receive(_ sender: String, _ text: String) throws {
        try GameEvent.identity(sender); guard sender != own else { throw QuizError.invalid }; let e = try PartyEvent.decode(text), now = clock()
        guard e.pack == pack, e.expires > now, e.expires <= now+150000 else { throw QuizError.invalid }
        if e.kind == "C" { guard e.revision == 0, e.value == "-", e.ref == "-" else { throw QuizError.invalid }; reply(sender,e,"K"); return }
        if e.kind == "I", session?.id != e.session {
            guard e.revision == 0, e.ref == "-", session == nil || ["ended","complete"].contains(session!.phase) || session!.expires <= now else { throw QuizError.invalid }
            let next = try parse(e.session,e.expires,e.value); guard next.host == sender, next.phase == "lobby", next.moves.isEmpty, next.accepted == [sender] else { throw QuizError.invalid }
            try transaction { invitations = invitations.filter { $0.value > now }; guard invitations[e.session] == nil, invitations.count < 16 else { throw QuizError.invalid }; invitations[e.session] = e.expires; removed = pending.values.filter{$0.packet != "-"}.map(\.packet); pending = [:]; order = []; draft = nil; session = next; session!.phase = "invited"; lastHost = now; recovering = false; notice = "Party cards invitation" }; reply(sender,e,"A"); return
        }
        guard let s = session, e.session == s.id, peers.contains(sender), s.expires > now else { throw QuizError.invalid }
        if ["A","J","K","R","E"].contains(e.kind), e.value != "-" { throw QuizError.invalid }
        if ["I","J","S","R","E"].contains(e.kind), e.ref != "-" { throw QuizError.invalid }
        if ["A","K"].contains(e.kind), e.ref == "-" { throw QuizError.invalid }
        var ack = !["A","K","M"].contains(e.kind)
        try transaction {
            if sender == s.host || s.host == own { lastHost = now }
            switch e.kind {
            case "K":
                guard s.host == own, s.phase == "lobby", e.revision == 0, pending[key(sender,e.ref)]?.event.kind == "C" else { throw QuizError.invalid }; remove(sender,e.ref); try enqueue(sender,event("I",body(s),revision:0))
            case "I":
                guard sender == s.host, ["invited","joining","active","complete"].contains(s.phase), e.revision == 0, try parse(e.session,e.expires,e.value).members == s.members else { throw QuizError.invalid }
            case "J":
                guard s.host == own, ["lobby","active"].contains(s.phase), e.revision == 0 else { throw QuizError.invalid }; session!.accepted.insert(sender)
                for id in pending.values.filter({$0.peer==sender && $0.event.kind=="I"}).map({$0.event.id}) { remove(sender,id) }
                if session!.accepted.count == s.members.count, s.phase == "lobby" { session!.phase = "active"; session!.expires = now+86400000; try snapshot() }
            case "A":
                if let p = pending[key(sender,e.ref)] {
                    guard !["C","M"].contains(p.event.kind), e.revision >= p.event.revision else { throw QuizError.invalid }; remove(sender,e.ref)
                    if p.event.kind == "S" {
                        for id in pending.values.filter({$0.peer==sender && $0.event.kind=="U" && $0.event.revision<=e.revision}).map({$0.event.id}) { remove(sender,id) }
                        if !pending.values.contains(where:{$0.event.kind=="S"}) { recovering = false }
                    }
                }
            case "M":
                guard s.host == own, ["active","complete"].contains(s.phase), e.ref != "-", ["done","skip","sip","shuffle"].contains(e.value), e.value != "sip" || s.settings.drinking else { throw QuizError.invalid }
                if let at = s.moves.firstIndex(where:{$0.id==e.ref}) { guard at==e.revision, s.members[at%s.members.count]==sender, s.moves[at].kind==e.value else { throw QuizError.invalid }; try snapshot() }
                else { guard s.phase=="active", s.turn==sender, e.revision==s.revision, !pending.values.contains(where:{["U","S"].contains($0.event.kind)}) else { throw QuizError.invalid }; try commit(PartyMove(kind:e.value,id:e.ref)) }
            case "U":
                guard sender==s.host, ["active","complete"].contains(s.phase), e.ref != "-", ["done","skip","sip","shuffle"].contains(e.value), e.value != "sip" || s.settings.drinking, e.revision>0 else { throw QuizError.invalid }
                let move = PartyMove(kind:e.value,id:e.ref)
                if e.revision<=s.revision { guard s.moves[e.revision-1]==move else { throw QuizError.invalid } }
                else if e.revision != s.revision+1 { if !pending.values.contains(where:{$0.event.kind=="R"}) { try enqueue(s.host,event("R")) }; recovering=true; ack=false }
                else {
                    guard !s.moves.contains(where:{$0.id==move.id}), !remaining(s).isEmpty, s.turn != own || (draft?.revision == s.revision && draft?.move == move) else { throw QuizError.invalid }; session!.moves.append(move); if remaining().isEmpty { session!.phase="complete" }
                    if let d=draft { guard d.revision != s.revision || d.move==move else { throw QuizError.invalid }; if d.move==move { draft=nil; for id in pending.values.filter({$0.event.kind=="M"}).map({$0.event.id}) { remove(sender,id) } } }
                }
            case "S":
                guard sender==s.host, ["joining","active","complete"].contains(s.phase) else { throw QuizError.invalid }; let next=try parse(s.id,now+86400000,e.value)
                guard ["active","complete"].contains(next.phase), next.members==s.members, next.settings==s.settings, next.revision==e.revision, Array(next.moves.prefix(s.revision))==s.moves else { throw QuizError.invalid }
                if next.revision>=s.revision {
                    for i in s.revision..<next.revision where s.members[i%s.members.count]==own { guard draft?.revision==i, draft?.move==next.moves[i] else { throw QuizError.invalid } }
                    session=next;recovering=false; for id in pending.values.filter({["J","R"].contains($0.event.kind)}).map({$0.event.id}) { remove(sender,id) }
                    if let d=draft, next.revision>d.revision { guard next.moves[d.revision]==d.move else { throw QuizError.invalid }; draft=nil; for id in pending.values.filter({$0.event.kind=="M"}).map({$0.event.id}) { remove(sender,id) } }
                }
            case "R": guard s.host==own, ["active","complete"].contains(s.phase) else { throw QuizError.invalid }; try snapshot()
            case "E": guard e.revision<=s.revision, sender==s.host || s.host==own else { throw QuizError.invalid }; if s.phase != "ended" { removed=pending.values.filter{$0.packet != "-"}.map(\.packet);pending=[:];order=[];draft=nil;session!.phase="ended";if s.host==own { try broadcast("E") } }
            default: throw QuizError.invalid
            }
            notice = session!.phase=="ended" ? "Game ended" : session!.phase=="complete" ? "Round complete" : session!.phase=="active" ? (session!.turn==own ? "Your turn" : "Waiting for the other players") : notice
        }
        if ack { reply(sender,e,"A") };flush()
    }
    func tick() throws {
        let now=clock(), stale=pending.values.filter{$0.event.expires<=now}
        if !stale.isEmpty || (session != nil && session!.expires<=now && session!.phase != "ended") {
            try transaction { for p in stale { remove(p.peer,p.event.id);if ["M","U","S"].contains(p.event.kind) { recovering=true } };if session!.expires<=now { session!.phase="ended";draft=nil;notice="Invitation or session expired" } }
        }
        if let s=session, let d=draft, !recovering, !pending.values.contains(where:{$0.event.kind=="M"}), s.revision==d.revision, s.turn==own { try transaction { try enqueue(s.host,event("M",d.move.kind,d.move.id,revision:d.revision)) } };flush()
    }
    private func flush() {
        guard let k=order.first(where:{pending[$0]?.packet=="-"}), let p=pending[k] else { return }
        do { let id=try send(p.peer,p.event.encode());pending[k]!.packet=id;do { try save(export()) } catch { pending[k]!.packet="-";discard(id);throw error } } catch { }
    }
    func export() throws -> String {
        func enc(_ raw:String)->String { Data(raw.utf8).base64EncodedString() }
        var lines=["PC2|"+pack,session.map{"\($0.id)|\($0.expires)|\(enc(body($0)))"} ?? "-",draft.map{"\($0.revision)|\($0.move.kind)|\($0.move.id)"} ?? "-",invitations.isEmpty ? "-" : invitations.keys.sorted().map { "\($0).\(invitations[$0]!)" }.joined(separator:",")]
        for k in order { if let p=pending[k] { lines.append("\(p.peer)|\(try enc(p.event.encode()))|\(p.packet)") } }
        let raw=lines.joined(separator:"\n");guard raw.utf8.count<=16384 else { throw QuizError.invalid };return raw
    }
    func restore(_ raw:String) throws {
        let lines=raw.components(separatedBy:"\n");guard raw.utf8.count<=16384, (4...16).contains(lines.count), lines[0]=="PC2|"+pack else { throw QuizError.invalid }
        func dec(_ raw:String)throws->String { guard let d=Data(base64Encoded:raw), let s=String(data:d,encoding:.utf8) else { throw QuizError.invalid };return s }
        var next:PartySession?
        if lines[1] != "-" { let p=lines[1].components(separatedBy:"|");guard p.count==3, let expires=Int64(p[1]) else { throw QuizError.invalid };try GameEvent.uuid(p[0]);next=try parse(p[0],expires,dec(p[2])) }
        var nextDraft:(revision:Int,move:PartyMove)?
        if lines[2] != "-" { let p=lines[2].components(separatedBy:"|");guard p.count==3, let rev=Int(p[0]), ["done","skip","sip","shuffle"].contains(p[1]) else { throw QuizError.invalid };try GameEvent.uuid(p[2]);nextDraft=(rev,PartyMove(kind:p[1],id:p[2])) }
        var nextInvitations: [String:Int64] = [:]
        if lines[3] != "-" { for raw in lines[3].components(separatedBy:",") { let p=raw.components(separatedBy:"."); guard p.count==2, let expires=Int64(p[1]), nextInvitations[p[0]]==nil, nextInvitations.count<16 else { throw QuizError.invalid }; try GameEvent.uuid(p[0]); nextInvitations[p[0]]=expires } }
        var nextPending:[String:Pending]=[:], nextOrder:[String]=[]
        for line in lines.dropFirst(4) { let p=line.components(separatedBy:"|");guard p.count==3 else { throw QuizError.invalid };try GameEvent.identity(p[0]);let e=try PartyEvent.decode(dec(p[1]));guard let next, next.members.contains(p[0]),p[0] != own,e.session==next.id,e.pack==pack else { throw QuizError.invalid };if p[2] != "-" { try GameEvent.uuid(p[2]) };let k=key(p[0],e.id);guard nextPending[k]==nil else { throw QuizError.invalid };nextPending[k]=Pending(peer:p[0],event:e,packet:p[2]);nextOrder.append(k) }
        if let d=nextDraft { guard let next,own != next.host,d.revision==next.revision,next.turn==own else { throw QuizError.invalid } }
        session=next;invitations=nextInvitations;pending=nextPending;order=nextOrder;draft=nextDraft;recovering=next.map{["active","joining","complete"].contains($0.phase)} ?? false;lastHost=0;notice=recovering ? "Reconnecting…" : next != nil ? "Waiting for the other players" : "Choose your vibe"
    }
}

/// People sharing the local deck; independent of connected device limits.
struct CardAudience:Equatable,Codable {
    var players=4;var mode="group"
    var valid:Bool {(2...20).contains(players) && (mode=="group" ? players>=3 : ["friends","couples"].contains(mode) && players==2)}
    var label:String {"\(players) players · \(mode=="couples" ? "Couple" : mode=="friends" ? "Friends" : "Group")"}
    func accepts(_ card:PartyCard)->Bool {valid && card.modes.contains(mode) && players>=card.min && players<=card.max}
}
extension PartyCard {
    func playRule(_ mode:String)->String {
        if alcohol && game=="truth_or_drink" {return "Answer the question or take a drink. You can always skip."}
        if alcohol && game=="do_or_drink" {return "Do the dare or take a drink. Anyone involved must agree. You can always skip."}
        return instructions[mode] ?? "Take turns. You can always skip."
    }
}

/// Public prompt deck; applying an invalid or unconfirmed draft cannot change the current card.
struct FilteredCardDeck {
    let cards:[PartyCard]; var seed=UUID().uuidString.lowercased()
    private(set) var filters:Set<String>=["clean"]
    private(set) var audience=CardAudience()
    private(set) var shown:Set<String>=[]
    private(set) var current:PartyCard?
    var pack="all";var stage=1
    private var cycle=0
    private var lastShown:String?
    init(cards:[PartyCard],seed:String=UUID().uuidString.lowercased()){self.cards=cards;self.seed=seed}
    func eligible(_ selected:Set<String>,adult:Bool,drinking:Bool,audience:CardAudience?=nil,pack:String?=nil)->[PartyCard] {
        let context=audience ?? self.audience
        return cards.filter{ ((pack ?? self.pack)=="all" || $0.packs.contains(pack ?? self.pack)) && context.accepts($0) && !$0.tags.isDisjoint(with:selected) && (!$0.adult || (selected.contains("dirty") && adult)) && (!$0.alcohol || (selected.contains("drinking") && drinking)) }
    }
    mutating func apply(_ selected:Set<String>,adult:Bool,drinking:Bool,audience:CardAudience?=nil)throws {
        let context=audience ?? self.audience
        guard context.valid, !selected.isEmpty,selected.isSubset(of:["clean","drinking","dirty"]),(!selected.contains("dirty") || adult),(!selected.contains("drinking") || drinking) else{throw QuizError.invalid}
        filters=selected;self.audience=context;draw(adult:adult,drinking:drinking)
    }
    func peek(adult:Bool,drinking:Bool)->PartyCard? {eligible(filters,adult:adult,drinking:drinking).filter{!shown.contains($0.id)}.min{abs($0.stage-stage)==abs($1.stage-stage) ? rank($0.id)<rank($1.id) : abs($0.stage-stage)<abs($1.stage-stage)}}
    mutating func draw(adult:Bool,drinking:Bool) {
        current=peek(adult:adult,drinking:drinking)
        if let current{shown.insert(current.id);lastShown=current.id}
    }
    mutating func shuffleAgain(adult:Bool,drinking:Bool) {
        let previous=lastShown;cycle+=1;shown=[]
        let available=eligible(filters,adult:adult,drinking:drinking)
        current=available.filter{$0.id != previous || available.count==1}.min{abs($0.stage-stage)==abs($1.stage-stage) ? rank($0.id)<rank($1.id) : abs($0.stage-stage)<abs($1.stage-stage)}
        if let current{shown.insert(current.id);lastShown=current.id}
    }
    func snapshot()->CardDeckState {CardDeckState(seed:seed,filters:filters,audience:audience,shown:shown,current:current?.id,cycle:cycle,pack:pack,stage:stage,last:lastShown)}
    mutating func restore(_ value:CardDeckState,adult:Bool,drinking:Bool)throws {
        guard (1...256).contains(value.seed.count),(0...100000).contains(value.cycle),(0...2).contains(value.stage),CardPacks.labels[value.pack] != nil,value.audience.valid,!value.filters.isEmpty,value.filters.isSubset(of:["clean","drinking","dirty"]),(!value.filters.contains("dirty") || adult),(!value.filters.contains("drinking") || drinking),value.shown.isSubset(of:Set(cards.map(\.id))),(value.last==nil || value.shown.contains(value.last!)) else{throw QuizError.invalid}
        let card=cards.first{$0.id==value.current}
        guard value.current==nil || (card != nil && value.shown.contains(value.current!) && eligible(value.filters,adult:adult,drinking:drinking,audience:value.audience,pack:value.pack).contains{$0.id==value.current}) else{throw QuizError.invalid}
        seed=value.seed;filters=value.filters;audience=value.audience;shown=value.shown;current=card;cycle=value.cycle;pack=value.pack;stage=value.stage;lastShown=value.last ?? card?.id
    }
    private func rank(_ id:String)->String { SHA256.hash(data:Data("\(seed)|\(cycle)|\(id)".utf8)).map{String(format:"%02x",$0)}.joined() }
}
struct CardAge {
    static func eligible(_ year:Int?,minimum:Int,today:Date=Date(),month:Int?=nil,day:Int?=nil)->Bool? {
        let calendar=Calendar(identifier:.gregorian),current=calendar.component(.year,from:today)
        guard let year,year>=1900,year<=current else{return nil}
        if current-year<minimum{return false};if current-year>minimum{return true}
        guard let month,let day,let born=calendar.date(from:DateComponents(year:year,month:month,day:day)),calendar.component(.month,from:born)==month,calendar.component(.day,from:born)==day,let cutoff=calendar.date(byAdding:.year,value:-minimum,to:today) else{return nil}
        return calendar.startOfDay(for:born)<=calendar.startOfDay(for:cutoff)
    }
}

/// Formatting/validation only; the input is never persisted in the profile or deck.
struct CardBirthday {
    static func digits(_ input:String)->String {String(input.filter{("0"..."9").contains($0)}.prefix(8))}
    static func format(_ input:String)->String {
        let raw=digits(input)
        return [String(raw.prefix(2)),String(raw.dropFirst(2).prefix(2)),String(raw.dropFirst(4))].filter{!$0.isEmpty}.joined(separator:"/")
    }
    static func eligible(_ input:String,minimum:Int,today:Date=Date())->Bool? {
        let raw=digits(input);guard raw.count==8,let day=Int(raw.prefix(2)),let month=Int(raw.dropFirst(2).prefix(2)),let year=Int(raw.dropFirst(4)),year>=1900 else{return nil}
        let calendar=Calendar(identifier:.gregorian)
        guard let born=calendar.date(from:DateComponents(year:year,month:month,day:day)),calendar.component(.year,from:born)==year,calendar.component(.month,from:born)==month,calendar.component(.day,from:born)==day,born<=today,let cutoff=calendar.date(byAdding:.year,value:-minimum,to:today) else{return nil}
        return calendar.startOfDay(for:born)<=calendar.startOfDay(for:cutoff)
    }
}


enum CardPacks {
    static let options=[("all","All packs"),("classic","Classic mix"),("new_friends","New friends"),("close_friends","Close friends"),("couples","Couples"),("family","Family"),("big_party","Big parties")]
    static let labels=Dictionary(uniqueKeysWithValues:options)
}
struct CardDeckState:Codable {var seed:String;var filters:Set<String>;var audience:CardAudience;var shown:Set<String>;var current:String?;var cycle:Int;var pack:String;var stage:Int;var last:String?}
struct CardSessionFrame:Codable {var deck:CardDeckState;var names:[String];var turn:Int;var completed:Int;var roundTurns:Int;var handoff:Bool;var revealed:Bool;var paused:Bool;var sound:Bool;var roundIndex:Int}
struct LocalCardSave:Codable {var version=1;var updated:Date;var frame:CardSessionFrame;var previous:CardSessionFrame?;var catalog:String}
struct LocalCardSession {
    var deck:FilteredCardDeck
    private(set) var names:[String]=[];private(set) var turn=0;private(set) var completed=0;private(set) var roundTurns=1
    private(set) var handoff=true;private(set) var revealed=false;private(set) var paused=false;private(set) var sound=false
    private(set) var roundIndex=0
    private(set) var previous:CardSessionFrame?
    init(cards:[PartyCard]){deck=FilteredCardDeck(cards:cards)}
    var goal:Int{roundTurns*names.count}
    var finished:Bool{!names.isEmpty && ((goal>0 && completed>=goal) || deck.current==nil)}
    var phase:Int{completed<(goal>0 ? max(1,goal/3) : 2) ? 0 : completed<(goal>0 ? max(2,goal*2/3) : 6) ? 1 : 2}
    var phaseLabel:String{["Warm up","Playful","Deeper"][phase]}
    static func validNames(_ names:[String],count:Int)->Bool{names.count==count && names.allSatisfy{(1...40).contains($0.trimmingCharacters(in:.whitespacesAndNewlines).count)} && Set(names.map{$0.trimmingCharacters(in:.whitespacesAndNewlines).lowercased()}).count==count}
    static func parseNames(_ text:String)->[String]{text.components(separatedBy:CharacterSet(charactersIn:",\n\r")).map{$0.trimmingCharacters(in:.whitespacesAndNewlines)}.filter{!$0.isEmpty}}
    mutating func configure(_ categories:Set<String>,adult:Bool,drinking:Bool,audience:CardAudience,names:[String],pack:String,roundTurns:Int,handoff:Bool,sound:Bool)throws {
        guard audience.valid,Self.validNames(names,count:audience.players),(0...2).contains(roundTurns),CardPacks.labels[pack] != nil,!categories.isEmpty,categories.isSubset(of:["clean","drinking","dirty"]),(!categories.contains("dirty") || adult),(!categories.contains("drinking") || drinking),!deck.eligible(categories,adult:adult,drinking:drinking,audience:audience,pack:pack).isEmpty else{throw QuizError.invalid}
        let keepTurn = !self.names.isEmpty && !finished
        self.names=names.map{$0.trimmingCharacters(in:.whitespacesAndNewlines)};turn=keepTurn ? min(turn,names.count-1) : 0
        completed=0;roundIndex=0;self.roundTurns=roundTurns;self.handoff=handoff;self.sound=sound;paused=false;revealed = !handoff;previous=nil
        deck.pack=pack;deck.stage=phase;try deck.apply(categories,adult:adult,drinking:drinking,audience:audience)
    }
    mutating func reveal(){if !paused && !finished{revealed=true}}
    mutating func advance(adult:Bool,drinking:Bool){guard !paused,!finished,revealed,deck.current != nil else{return};previous=frame();completed+=1;turn=(turn+1)%names.count;revealed = !handoff;deck.stage=phase;if goal==0 || completed<goal{deck.draw(adult:adult,drinking:drinking)}}
    mutating func undo(adult:Bool,drinking:Bool)throws{guard let value=previous else{return};try restore(value,adult:adult,drinking:drinking);previous=nil}
    mutating func newRound(adult:Bool,drinking:Bool){roundIndex+=1;completed=0;previous=nil;paused=false;revealed = !handoff;deck.stage=phase;if deck.current==nil{deck.shuffleAgain(adult:adult,drinking:drinking)}else{deck.draw(adult:adult,drinking:drinking);if deck.current==nil{deck.shuffleAgain(adult:adult,drinking:drinking)}}}
    mutating func end(){self=LocalCardSession(cards:deck.cards)}
    mutating func rename(_ value:[String]){guard Self.validNames(value,count:names.count) else{return};names=value.map{$0.trimmingCharacters(in:.whitespacesAndNewlines)};previous=nil}
    mutating func pause(){paused=true}
    mutating func resume(){paused=false}
    func frame()->CardSessionFrame{CardSessionFrame(deck:deck.snapshot(),names:names,turn:turn,completed:completed,roundTurns:roundTurns,handoff:handoff,revealed:revealed,paused:paused,sound:sound,roundIndex:roundIndex)}
    mutating func restore(_ value:CardSessionFrame,adult:Bool,drinking:Bool,history:CardSessionFrame?=nil)throws {
        guard Self.validNames(value.names,count:value.deck.audience.players),value.names.indices.contains(value.turn),(0...100000).contains(value.completed),(0...2).contains(value.roundTurns),(0...100000).contains(value.roundIndex) else{throw QuizError.invalid}
        try deck.restore(value.deck,adult:adult,drinking:drinking);names=value.names;turn=value.turn;completed=value.completed;roundTurns=value.roundTurns;handoff=value.handoff;revealed=value.revealed;paused=value.paused;sound=value.sound;roundIndex=value.roundIndex;previous=history
    }
    func display(_ card:PartyCard)->PartyCard{guard !card.namedText.isEmpty,names.count>1 else{return card};let offset=(roundIndex*max(1,roundTurns)+completed/names.count)%(names.count-1)+1;var value=card;value.text=card.namedText.replacingOccurrences(of:"{player}",with:names[turn]).replacingOccurrences(of:"{partner}",with:names[(turn+offset)%names.count]);return value}
}

func stalePartyCatalog(_ raw:String,pack:String)->Bool {
    guard raw.utf8.count<=16384,let header=raw.split(separator:"\n",omittingEmptySubsequences:false).first else{return false}
    return header.range(of:"^PC2\\|[0-9a-f]{64}$",options:.regularExpression) != nil && header != "PC2|"+pack
}
