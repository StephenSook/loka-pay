import Foundation

/// Experimental control content inside a verified, recipient-addressed packet-v0 envelope.
struct ContactConsent: Equatable, Codable {
    static let lifetime: Int64 = 300_000
    let kind: String
    let id: String
    let expires: Int64
    var name = ""
    func encode() throws -> String {
        let text = "LC1|\(kind)|\(id)|\(expires)|\(Data(name.utf8).base64EncodedString())"
        _ = try Self.decode(text); return text
    }
    static func decode(_ text: String) throws -> Self {
        guard text.utf8.count <= 256 else { throw LokaProtocolError.invalid }
        let p = text.components(separatedBy: "|")
        guard p.count == 5, p[0] == "LC1", ["R", "A", "K", "D"].contains(p[1]),
              UUID(uuidString: p[2])?.uuidString.lowercased() == p[2],
              let expires = Int64(p[3]), expires >= 0, String(expires) == p[3],
              let bytes = Data(base64Encoded: p[4]), bytes.count <= 128, bytes.base64EncodedString() == p[4],
              let name = String(data: bytes, encoding: .utf8),
              !name.unicodeScalars.contains(where: { [.control, .format, .lineSeparator, .paragraphSeparator].contains($0.properties.generalCategory) })
        else { throw LokaProtocolError.invalid }
        if ["R", "A"].contains(p[1]) {
            func edgeSpace(_ cp: UInt32) -> Bool { [0x20, 0xa0, 0x1680, 0x202f, 0x205f, 0x3000].contains(cp) || (0x2000...0x200a).contains(cp) }
            guard let first = name.unicodeScalars.first, let last = name.unicodeScalars.last,
                  !edgeSpace(first.value), !edgeSpace(last.value) else { throw LokaProtocolError.invalid }
        } else if !name.isEmpty { throw LokaProtocolError.invalid }
        return Self(kind: p[1], id: p[2], expires: expires, name: name)
    }
}

/// Pure consent experiment. No trust-store mutation, persistence or transport admission.
/// Caller serializes access and verifies the envelope before calling receive.
final class ContactConsentBook {
    enum Phase: String, Codable { case outgoing, incoming, approved, complete, declined }
    struct Entry: Codable {
        let peer: String
        let request: ContactConsent
        let outgoing: Bool
        var phase: Phase
        var peerName: String
        var responseName = ""
    }
    private let own: String
    private var entries: [String: Entry] = [:]
    private var blocked: Set<String> = []
    init(own: String) throws { try Self.checkIdentity(own); self.own = own }
    private static func checkIdentity(_ value: String) throws {
        guard value.utf8.count == 64, value.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { throw LokaProtocolError.invalid }
    }
    private func prune(_ now: Int64) throws {
        guard now >= 0 else { throw LokaProtocolError.invalid }
        entries = entries.filter { $0.value.request.expires > now }
    }
    private func valid(_ peer: String, _ content: ContactConsent, _ now: Int64) throws {
        try Self.checkIdentity(peer)
        guard peer != own, !blocked.contains(peer), content.expires > now,
              content.expires - now <= ContactConsent.lifetime else { throw LokaProtocolError.invalid }
        _ = try content.encode()
    }
    func snapshot(now: Int64) throws -> [Entry] { try prune(now); return Array(entries.values) }
    func begin(peer: String, name: String, now: Int64, id: String = UUID().uuidString.lowercased()) throws -> ContactConsent {
        try prune(now)
        guard now <= Int64.max - ContactConsent.lifetime else { throw LokaProtocolError.invalid }
        let request = ContactConsent(kind: "R", id: id, expires: now + ContactConsent.lifetime, name: name)
        try valid(peer, request, now)
        guard entries.count < 32, entries[id] == nil, !entries.values.contains(where: { $0.peer == peer }) else { throw LokaProtocolError.invalid }
        entries[id] = Entry(peer: peer, request: request, outgoing: true, phase: .outgoing, peerName: "")
        return request
    }
    func receive(peer: String, content: ContactConsent, now: Int64) throws -> ContactConsent? {
        try prune(now); try valid(peer, content, now)
        guard var current = entries[content.id] else {
            guard content.kind == "R", entries.count < 32, entries.values.filter({ !$0.outgoing }).count < 16,
                  !entries.values.contains(where: { $0.peer == peer }) else { throw LokaProtocolError.invalid }
            entries[content.id] = Entry(peer: peer, request: content, outgoing: false, phase: .incoming, peerName: content.name)
            return nil
        }
        guard current.peer == peer, current.request.expires == content.expires else { throw LokaProtocolError.invalid }
        switch content.kind {
        case "R":
            guard !current.outgoing, current.request == content else { throw LokaProtocolError.invalid }
            switch current.phase {
            case .approved, .complete: return ContactConsent(kind: "A", id: content.id, expires: content.expires, name: current.responseName)
            case .declined: return ContactConsent(kind: "D", id: content.id, expires: content.expires)
            default: return nil
            }
        case "A":
            guard current.outgoing, [.outgoing, .complete].contains(current.phase),
                  current.phase != .complete || current.peerName == content.name else { throw LokaProtocolError.invalid }
            current.phase = .complete; current.peerName = content.name; entries[content.id] = current
            return ContactConsent(kind: "K", id: content.id, expires: content.expires)
        case "K":
            guard !current.outgoing, [.approved, .complete].contains(current.phase) else { throw LokaProtocolError.invalid }
            current.phase = .complete
        case "D":
            guard current.outgoing, [.outgoing, .declined].contains(current.phase) else { throw LokaProtocolError.invalid }
            current.phase = .declined
        default: throw LokaProtocolError.invalid
        }
        entries[content.id] = current; return nil
    }
    func decide(id: String, accept: Bool, name: String, now: Int64) throws -> ContactConsent {
        try prune(now)
        guard var current = entries[id], !current.outgoing, current.phase == .incoming else { throw LokaProtocolError.invalid }
        let reply = ContactConsent(kind: accept ? "A" : "D", id: id, expires: current.request.expires, name: accept ? name : "")
        try valid(current.peer, reply, now)
        current.phase = accept ? .approved : .declined; current.responseName = reply.name; entries[id] = current
        return reply
    }
    struct Saved: Codable { let entries: [Entry]; let blocked: Set<String> }
    func saved(now: Int64) throws -> Saved { Saved(entries: try snapshot(now: now), blocked: blocked) }
    func restore(_ saved: Saved, now: Int64) throws {
        guard saved.entries.count <= 32, saved.blocked.count <= 128 else { throw LokaProtocolError.invalid }
        for id in saved.blocked { try Self.checkIdentity(id); guard id != own else { throw LokaProtocolError.invalid } }
        let live = saved.entries.filter { $0.request.expires > now }
        guard Set(live.map(\.peer)).count == live.count, Set(live.map { $0.request.id }).count == live.count,
              live.filter({ !$0.outgoing }).count <= 16 else { throw LokaProtocolError.invalid }
        for e in live {
            try Self.checkIdentity(e.peer); _ = try e.request.encode()
            guard e.peer != own, !saved.blocked.contains(e.peer), e.request.kind == "R", e.request.expires - now <= ContactConsent.lifetime,
                  (e.outgoing ? [.outgoing, .complete, .declined] : [.incoming, .approved, .complete, .declined]).contains(e.phase) else { throw LokaProtocolError.invalid }
            if !e.peerName.isEmpty { _ = try ContactConsent(kind: "R", id: e.request.id, expires: e.request.expires, name: e.peerName).encode() }
            if !e.outgoing {
                guard e.peerName == e.request.name else { throw LokaProtocolError.invalid }
                if [.approved, .complete].contains(e.phase) { _ = try ContactConsent(kind: "A", id: e.request.id, expires: e.request.expires, name: e.responseName).encode() }
            } else if e.phase == .complete && e.peerName.isEmpty { throw LokaProtocolError.invalid }
        }
        entries = Dictionary(uniqueKeysWithValues: live.map { ($0.request.id, $0) }); blocked = saved.blocked
    }
    func replaceCrossedOutgoing(peer: String, incomingID: String, now: Int64) throws -> Bool {
        try prune(now)
        guard let old = entries.values.first(where: { $0.peer == peer && $0.outgoing && $0.phase == .outgoing }), incomingID < old.request.id else { return false }
        entries.removeValue(forKey: old.request.id); return true
    }
    func block(peer: String) throws {
        try Self.checkIdentity(peer)
        guard peer != own, blocked.contains(peer) || blocked.count < 128 else { throw LokaProtocolError.invalid }
        blocked.insert(peer); entries = entries.filter { $0.value.peer != peer }
    }
}


struct NearbyProfile: Identifiable {
    let handle: String; let id: String; let key: Data; let name: String; var carryVersion: Int = 0; var avatarID: String?; var avatarShared = false; var avatarUpdatedAt: Int64 = 0
}
struct NearbySaved: Codable { let book: ContactConsentBook.Saved; let keys: [String: Data] }
/// Caller serializes access. Controls are direct-link only, never passed to the mesh.
final class NearbyPeople {
    private let crypto: LokaCrypto
    private let name: () -> String
    private let visible: () -> Bool
    private let send: (String, Data) throws -> Void
    private let save: (NearbySaved) throws -> Void
    private let authorize: (Data, String) throws -> Void
    private let changed: ([NearbyProfile], [ContactConsentBook.Entry]) -> Void
    private let avatar: () -> String?
    private let clock: () -> Int64
    private let book: ContactConsentBook
    private var links: Set<String> = []
    private var profiles: [String: NearbyProfile] = [:]
    private var challenges: [String: (String, Int64)] = [:]
    private var keys: [String: Data] = [:]
    private var helloAt: [String: Int64] = [:]
    var routeLoad: (String) -> Int = { _ in 0 }
    var routePreference: (String) -> Int = { _ in 0 }
    private func candidates(_ id: String) -> [NearbyProfile] {
        profiles.values.filter { $0.id == id && links.contains($0.handle) }.sorted {
            let a = max(0, routeLoad($0.handle)), b = max(0, routeLoad($1.handle))
            if a != b { return a < b }
            let ar = routePreference($0.handle), br = routePreference($1.handle)
            return ar == br ? $0.handle < $1.handle : ar < br
        }
    }
    private func encryptedPeer(_ id: String, _ content: String, routes: [NearbyProfile]? = nil) throws {
        let routes = routes ?? candidates(id)
        guard let first = routes.first else { return }
        let frame = Data("LP1E".utf8) + (try crypto.encrypt(recipient: first.key, text: content, now: clock()).encode())
        for route in routes { do { try send(route.handle, frame); return } catch { continue } }
    }
    var trusted: (String) -> Bool = { _ in false }
    var typingChanged: (String, Int64) -> Void = { _,_ in }
    private var responsive: [String: Int64] = [:]
    private var sentTyping: [String: (Int64, Bool)] = [:]
    private var receivedTyping: [String: Int64] = [:]
    private var capabilityAt: [String: Int64] = [:]
    private struct AvatarOffer { let key: Data; let nonce: String; var value: String; var at: Int64 }
    private var avatarOffers: [String: AvatarOffer] = [:]
    private var profileNonces: [String: String] = [:]
    private var avatarAt: [String: Int64] = [:]
    private var lastRetry: Int64 = 0
    private var window: Int64 = 0
    private var admitted = 0
    var onFailure: (() -> Void)?
    private var failed = false
    init(crypto: LokaCrypto, name: @escaping () -> String, visible: @escaping () -> Bool,
         send: @escaping (String, Data) throws -> Void, save: @escaping (NearbySaved) throws -> Void,
         authorize: @escaping (Data, String) throws -> Void,
         changed: @escaping ([NearbyProfile], [ContactConsentBook.Entry]) -> Void,
         clock: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
         avatar: @escaping () -> String? = { nil }) throws {
        self.crypto=crypto; self.name=name; self.visible=visible; self.send=send; self.save=save
        self.avatar=avatar; self.authorize=authorize; self.changed=changed; self.clock=clock; book=try ContactConsentBook(own: crypto.deviceID)
    }
    static func controls(_ frame: Data) -> Bool { [Data("LP1H".utf8), Data("LP1E".utf8)].contains(Data(frame.prefix(4))) }
    static func displayName(_ raw: String) -> String {
        let scalars = raw.unicodeScalars.filter { ![.control, .format, .lineSeparator, .paragraphSeparator].contains($0.properties.generalCategory) }
        var name = String(String.UnicodeScalarView(scalars.prefix(40))).trimmingCharacters(in: .whitespacesAndNewlines)
        while name.utf8.count > 128 { name.removeLast() }
        return name.isEmpty ? "LOKA user" : name
    }
    static func displayProfiles(_ values: [NearbyProfile]) -> [NearbyProfile] {
        var result: [NearbyProfile] = []
        for p in values {
            if let index=result.firstIndex(where: { $0.id == p.id }) {
                if p.avatarUpdatedAt > result[index].avatarUpdatedAt { result[index]=p }
            } else { result.append(p) }
        }
        return result
    }
    static func avatarID(_ raw: String?) -> String? {
        guard let raw, (0...41).contains(where: { raw == "avatar_\($0)" }) else { return nil }; return raw
    }
    static func bars(_ value: Int?) -> Int {
        guard let value, (-127 ... -1).contains(value) else { return 0 }
        return value >= -50 ? 6 : value >= -60 ? 5 : value >= -67 ? 4 : value >= -74 ? 3 : value >= -82 ? 2 : 1
    }
    func restore(_ state: NearbySaved?) throws {
        if let state {
            try book.restore(state.book, now: clock()); guard state.keys.count <= 32 else { throw LokaProtocolError.invalid }
            for (id,key) in state.keys { try ContactCode.validate(key); guard ContactCode.fingerprint(key) == id else { throw LokaProtocolError.invalid } }
            keys=state.keys
            guard try book.snapshot(now: clock()).allSatisfy({ keys[$0.peer] != nil }) else { throw LokaProtocolError.invalid }
        }
        try commit(); publish()
    }
    private func publish() { changed(Array(profiles.values).sorted { $0.id < $1.id }, (try? book.snapshot(now: clock())) ?? []) }
    private func commit() throws {
        guard !failed else { throw LokaProtocolError.invalid }
        let saved=try book.saved(now: clock()); let ids=Set(saved.entries.map(\.peer)); keys=keys.filter { ids.contains($0.key) }
        do {
            try save(NearbySaved(book:saved,keys:keys))
            for e in saved.entries where (e.outgoing && e.phase == .complete) || (!e.outgoing && [.approved,.complete].contains(e.phase)) {
                guard let key=keys[e.peer] else { throw LokaProtocolError.invalid }; try authorize(key,e.peerName)
            }
        } catch { failed=true; profiles=[:]; publish(); onFailure?(); throw error }
    }
    private func encrypt(_ handle: String, _ key: Data, _ text: String) throws {
        let frame=try crypto.encrypt(recipient:key,text:text,now:clock()).encode()
        try? send(handle,Data("LP1E".utf8)+frame)
    }
    func link(_ handle: String, up: Bool) {
        guard !failed else { return }
        if !up { links.remove(handle); if let p=profiles[handle] { typingChanged(p.id,0) }; responsive.removeValue(forKey:handle); profiles.removeValue(forKey:handle); challenges.removeValue(forKey:handle); helloAt.removeValue(forKey:handle); capabilityAt.removeValue(forKey:handle); avatarOffers.removeValue(forKey:handle); profileNonces.removeValue(forKey:handle); avatarAt.removeValue(forKey:handle); publish(); return }
        guard links.count < 32 || links.contains(handle) else { return }; links.insert(handle); hello(handle)
    }
    private func hello(_ handle: String) {
        let now=clock(); if let last=helloAt[handle], now-last < 30_000 { return }
        let nonce=UUID().uuidString.lowercased(); challenges[handle]=(nonce,now); helloAt[handle]=now
        try? send(handle,Data("LP1H\(nonce)|\(crypto.identity.publicKey.base64EncodedString())".utf8))
    }
    func receive(_ handle: String, _ frame: Data) {
        guard !failed, links.contains(handle), (5...4096).contains(frame.count), Self.controls(frame) else { return }
        let now=clock(); if now-window >= 10_000 || now < window { window=now; admitted=0 }
        admitted += 1; guard admitted <= 32 else { return }
        do {
            if frame.prefix(4) == Data("LP1H".utf8) {
                guard visible(), let text=String(data:frame.dropFirst(4),encoding:.ascii) else { return }
                let p=text.components(separatedBy:"|")
                guard p.count == 2, UUID(uuidString:p[0])?.uuidString.lowercased() == p[0], let key=Data(base64Encoded:p[1]), key.base64EncodedString() == p[1] else { return }
                try ContactCode.validate(key); let id=ContactCode.fingerprint(key)
                guard id != crypto.deviceID, try !book.saved(now:now).blocked.contains(id) else { return }
                try encrypt(handle,key,"LP1|P|\(p[0])|\(Data(Self.displayName(name()).utf8).base64EncodedString())")
                let value=Self.avatarID(avatar()) ?? "-"
                avatarOffers[handle]=AvatarOffer(key:key,nonce:p[0],value:value,at:now)
                try encrypt(handle,key,"LP1|I|\(p[0])|\(now)|\(value)")
                if profiles[handle] == nil { hello(handle) }; return
            }
            let packet=try LokaPacket.decode(Data(frame.dropFirst(4))); try packet.validate(now:now)
            guard packet.destination == crypto.deviceID, packet.source != crypto.deviceID, try !book.saved(now:now).blocked.contains(packet.source) else { return }
            let known=profiles[handle]
            guard challenges[handle] != nil || known?.id == packet.source else { return }
            let text=try crypto.decrypt(packet)
            if text.hasPrefix("LP1|P|") {
                let p=text.components(separatedBy:"|")
                guard p.count == 4, let challenge=challenges[handle], p[2] == challenge.0, (0...60_000).contains(now-challenge.1),
                      let bytes=Data(base64Encoded:p[3]), bytes.base64EncodedString() == p[3], let name=String(data:bytes,encoding:.utf8) else { return }
                _ = try ContactConsent(kind:"R",id:p[2],expires:now+ContactConsent.lifetime,name:name).encode()
                if now-challenge.1 <= 2_000 { responsive[handle]=now }
                challenges.removeValue(forKey:handle); profileNonces[handle]=p[2]; avatarAt.removeValue(forKey:handle); profiles[handle]=NearbyProfile(handle:handle,id:packet.source,key:packet.senderKey,name:name)
                try encrypt(handle,packet.senderKey,"LP1|V|2"); try encrypt(handle,packet.senderKey,"LP1|V|3"); capabilityAt[handle]=now; publish(); try retry(handle); return
            }
            guard known?.id == packet.source else { return }
            if text.hasPrefix("LP1|I|") {
                let p=text.components(separatedBy:"|")
                guard p.count == 5, p[2] == profileNonces[handle], let at=Int64(p[3]), at >= 0, String(at) == p[3],
                      at >= now-60_000, at <= now+2_000, at > (avatarAt[handle] ?? -1), p[4] == "-" || Self.avatarID(p[4]) != nil else { return }
                avatarAt[handle]=at; profiles[handle]?.avatarID=Self.avatarID(p[4]); profiles[handle]?.avatarShared=true; profiles[handle]?.avatarUpdatedAt=at
                publish(); return
            }
            if text == "LP1|V|2" || text == "LP1|V|3" { profiles[handle]?.carryVersion = max(known?.carryVersion ?? 0, text == "LP1|V|3" ? 3 : 2); publish(); return }
            if text.hasPrefix("LP1|T|") {
                receivedTyping=receivedTyping.filter { now-$0.value <= 8_000 }
                let parts=text.components(separatedBy:"|")
                guard trusted(packet.source), parts.count == 4, ["0","1"].contains(parts[3]), let at=Int64(parts[2]), at >= 0, String(at) == parts[2],
                      at >= now-8_000, at <= now+2_000, at > (receivedTyping[packet.source] ?? -1), receivedTyping.count < 32 || receivedTyping[packet.source] != nil else { return }
                receivedTyping[packet.source]=at
                typingChanged(packet.source,parts[3] == "1" ? min(now+8_000,at+8_000) : 0); return
            }
            if text == "LP1|X" { profiles.removeValue(forKey:handle); publish(); return }
            let consent=try ContactConsent.decode(text)
            guard consent.expires > now, consent.expires-now <= ContactConsent.lifetime,
                  (try (visible() || consent.kind != "R" || book.snapshot(now:now).contains(where: { $0.peer == packet.source }))) else { return }
            let before=try book.saved(now:now)
            let crossed=try consent.kind == "R" && book.replaceCrossedOutgoing(peer:packet.source,incomingID:consent.id,now:now)
            let response: ContactConsent?
            do { response=try book.receive(peer:packet.source,content:consent,now:now) } catch { try book.restore(before,now:now); throw error }
            keys[packet.source]=packet.senderKey
            let reply=try crossed ? book.decide(id:consent.id,accept:true,name:Self.displayName(name()),now:now) : response
            try commit(); publish(); if let reply { try encryptedPeer(packet.source,reply.encode()) }
        } catch { /* Malformed or stale controls do not enter messaging. */ }
    }
    /// Best effort direct-link activity; never persist, relay, or send draft text.
    func typing(_ id: String, active: Bool) {
        guard !failed, trusted(id) else { return }
        let now=clock(), candidates=candidates(id)
        let ready=candidates.filter { (0...60_000).contains(now-(responsive[$0.handle] ?? 0)) }
        guard !ready.isEmpty else {
            if let profile=candidates.first { hello(profile.handle) }; return
        }
        sentTyping=sentTyping.filter { now-$0.value.0 <= 8_000 }
        if let previous=sentTyping[id], previous.1 == active && now-previous.0 < 4_000 { return }
        guard sentTyping.count < 32 || sentTyping[id] != nil else { return }
        let stamp=max(now,(sentTyping[id]?.0 ?? -1)+1)
        sentTyping[id]=(stamp,active)
        try? encryptedPeer(id,"LP1|T|\(stamp)|\(active ? 1 : 0)", routes: ready)
    }
    func request(_ id: String) throws {
        guard !failed, visible(), let profile=candidates(id).first else { throw LokaProtocolError.invalid }
        _ = try book.begin(peer:id,name:Self.displayName(name()),now:clock()); keys[id]=profile.key
        try commit(); publish(); try retryPeer(id)
    }
    func decide(_ id: String, accept: Bool) throws {
        guard !failed else { throw LokaProtocolError.invalid }
        _ = try book.decide(id:id,accept:accept,name:Self.displayName(name()),now:clock()); try commit(); publish()
        for id in Set(profiles.values.map(\.id)).sorted() { try retryPeer(id) }
    }
    func block(_ id: String) throws { guard !failed else { throw LokaProtocolError.invalid }; try book.block(peer:id); profiles=profiles.filter { $0.value.id != id }; try commit(); publish() }
    func visibilityChanged() { if !visible() { for p in profiles.values { try? encrypt(p.handle,p.key,"LP1|X") } } }
    private func retry(_ handle: String) throws { if let p=profiles[handle] { try retryPeer(p.id) } }
    private func retryPeer(_ id: String) throws {
        guard let e=try book.snapshot(now:clock()).first(where: { $0.peer == id }) else { return }
        let kind: String
        switch e.phase { case .outgoing: kind="R"; case .approved: kind="A"; case .complete: kind=e.outgoing ? "K" : "A"; case .declined: if e.outgoing { return }; kind="D"; case .incoming: return }
        let name=kind == "R" ? e.request.name : kind == "A" ? e.responseName : ""
        try encryptedPeer(id,ContactConsent(kind:kind,id:e.request.id,expires:e.request.expires,name:name).encode())
    }
    func tick() {
        guard !failed else { return }
        for handle in links where profiles[handle] == nil { hello(handle) }
        let now=clock()
        if visible() {
            let value=Self.avatarID(avatar()) ?? "-"
            for (handle,var offer) in avatarOffers where offer.value != value && profiles[handle]?.id == ContactCode.fingerprint(offer.key) && now-offer.at >= 2_000 {
                let stamp=max(now,offer.at+1)
                try? encrypt(handle,offer.key,"LP1|I|\(offer.nonce)|\(stamp)|\(value)")
                offer.value=value; offer.at=stamp; avatarOffers[handle]=offer
            }
        }
        if now-lastRetry >= 15_000 {
            lastRetry=now
            for p in profiles.values {
            let interval: Int64 = p.carryVersion >= 2 ? 120_000 : 15_000
            if now-(capabilityAt[p.handle] ?? 0) >= interval {
                if p.carryVersion != 3 { try? encrypt(p.handle,p.key,"LP1|V|2") }
                if p.carryVersion != 2 { try? encrypt(p.handle,p.key,"LP1|V|3") }
                capabilityAt[p.handle]=now
            }
            }
            for id in Set(profiles.values.map(\.id)).sorted() {
                if (try? book.snapshot(now:now))?.contains(where: { $0.peer == id && $0.phase == .complete }) != true { try? retryPeer(id) }
            }
            publish()
        }
    }
}
