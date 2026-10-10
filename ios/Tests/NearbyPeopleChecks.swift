import Foundation

@main struct NearbyPeopleChecks {
    final class Network {
        var now: Int64 = 1_000_000
        var queue: [(Int,Data)] = []
        var peers: [NearbyPeople?] = [nil,nil]
        var profiles: [[NearbyProfile]] = [[],[]]
        var requests: [[ContactConsentBook.Entry]] = [[],[]]
        var saved: [NearbySaved?] = [nil,nil]
        var trust: [Set<String>] = [[],[]]
        var visible = [true,true]
        var attempts: [(String, Data)] = []
        var reject: String?
        var failSave = -1
        var avatars: [String?] = ["avatar_6","avatar_41"]
        let crypto: [LokaCrypto]
        init() throws { crypto = try (0..<2).map { _ in LokaCrypto(identity: try ContactIdentity(persistent:false)) }; try create(0); try create(1); connect() }
        func create(_ i: Int) throws {
            peers[i] = try NearbyPeople(crypto:crypto[i],name:{ i == 0 ? "Alice" : "Bob" },visible:{ self.visible[i] },
                send:{ handle,frame in self.attempts.append((handle,frame)); if handle == self.reject { throw LokaProtocolError.invalid }; self.queue.append((1-i,frame)) },save:{ state in if self.failSave == i { throw LokaProtocolError.invalid }; self.saved[i]=state },
                authorize:{ key,_ in self.trust[i].insert(ContactCode.fingerprint(key)) },changed:{ p,r in self.profiles[i]=p;self.requests[i]=r },clock:{ self.now },avatar:{ self.avatars[i] })
            try peers[i]!.restore(saved[i])
        }
        func connect() { peers.forEach { $0!.link("direct",up:true) }; pump() }
        func pump() { var count=0; while !queue.isEmpty { count += 1; precondition(count<100); let (i,f)=queue.removeFirst(); peers[i]!.receive("direct",f) } }
        func request() throws { try peers[0]!.request(crypto[1].deviceID); pump() }
        func tick() { now += 30_001; peers.forEach { $0!.tick() }; pump() }
    }
    static func interop(java: String, classpath: String, androidInitiates: Bool) throws {
        let process=Process(), input=Pipe(), output=Pipe()
        process.executableURL=URL(fileURLWithPath:java); process.arguments=["-cp",classpath,"JavaInterop","nearby-session"]
        process.standardInput=input; process.standardOutput=output; try process.run()
        defer { try? input.fileHandleForWriting.write(contentsOf:Data("QUIT\n".utf8)); process.waitUntilExit() }
        func command(_ text: String) throws -> [String] {
            try input.fileHandleForWriting.write(contentsOf:Data((text+"\n").utf8))
            var lines=[String](), bytes=Data()
            while true {
                guard let byte=try output.fileHandleForReading.read(upToCount:1), !byte.isEmpty else { throw LokaProtocolError.invalid }
                if byte[0] == 10 {
                    let line=String(data:bytes,encoding:.utf8)!; bytes=Data()
                    if line == "END" { return lines }; lines.append(line)
                } else { bytes.append(byte) }
            }
        }
        var outgoing=[Data](), incoming=[Data](), profiles=[NearbyProfile](), requests=[ContactConsentBook.Entry](), trusted=Set<String>()
        let people=try NearbyPeople(crypto:LokaCrypto(identity:ContactIdentity(persistent:false)),name:{ "iPhone Test" },visible:{ true },
            send:{ _,frame in outgoing.append(frame) },save:{ _ in },authorize:{ key,_ in trusted.insert(ContactCode.fingerprint(key)) },changed:{ profiles=$0;requests=$1 },avatar:{ "avatar_6" })
        var typingUntil: Int64=0
        people.trusted={ trusted.contains($0) }; people.typingChanged={ _,until in typingUntil=until }
        try people.restore(nil); people.link("direct",up:true)
        func collect(_ lines: [String]) { for line in lines where line.hasPrefix("FRAME ") { incoming.append(Data(base64Encoded:String(line.dropFirst(6)))!) } }
        collect(try command("LINK"))
        func pump() throws {
            var count=0
            while !outgoing.isEmpty || !incoming.isEmpty {
                count += 1; precondition(count<50)
                while !outgoing.isEmpty { collect(try command("FRAME " + outgoing.removeFirst().base64EncodedString())) }
                while !incoming.isEmpty { people.receive("direct",incoming.removeFirst()) }
            }
        }
        try pump(); precondition(profiles.first?.avatarID == "avatar_41"); let remoteAvatar=try command("AVATAR"); precondition(remoteAvatar == ["AVATAR avatar_6"]); precondition(profiles.first?.name == "Android Test"); precondition(profiles.first?.carryVersion == 3)
        if androidInitiates { collect(try command("REQUEST")) } else { try people.request(profiles[0].id) }
        try pump(); precondition(trusted.isEmpty)
        let waiting=try command("STATE"); precondition(waiting == ["STATE 0 iPhone Test"])
        if androidInitiates { try people.decide(requests[0].request.id,accept:true) } else { collect(try command("ACCEPT")) }
        try pump(); precondition(trusted.count==1 && requests[0].phase == .complete)
        let accepted=try command("STATE"); precondition(accepted == ["STATE 1 iPhone Test"])
        people.typing(profiles[0].id,active:true); try pump()
        let remoteTyping=try command("TYPING"); precondition(remoteTyping == ["TYPING true"])
        people.typing(profiles[0].id,active:false); try pump()
        let stopped=try command("TYPING"); precondition(stopped == ["TYPING false"])
        collect(try command("TYPE1")); try pump(); precondition(typingUntil > Int64(Date().timeIntervalSince1970*1000))
        collect(try command("TYPE0")); try pump(); precondition(typingUntil == 0)
    }
    static func main() throws {
        if CommandLine.arguments.count == 3 {
            try interop(java:CommandLine.arguments[1],classpath:CommandLine.arguments[2],androidInitiates:false)
            try interop(java:CommandLine.arguments[1],classpath:CommandLine.arguments[2],androidInitiates:true)
            print("Actual Kotlin–Swift LP1 profile exchange, approved chat requests and encrypted typing passed in both directions")
        }

        let ranked=try Network()
        func bind(_ i: Int, _ handle: String) throws {
            ranked.queue.removeAll(); ranked.peers[i]!.link(handle,up:true)
            let hello=ranked.queue.first { String(data:$0.1,encoding:.utf8)?.hasPrefix("LP1H") == true }!.1
            let nonce=String(data:hello,encoding:.utf8)!.dropFirst(4).components(separatedBy:"|")[0]
            let name=Data("Peer".utf8).base64EncodedString()
            let frame=Data("LP1E".utf8) + (try ranked.crypto[1-i].encrypt(recipient:ranked.crypto[i].identity.publicKey,text:"LP1|P|\(nonce)|\(name)",now:ranked.now).encode())
            ranked.peers[i]!.receive(handle,frame); ranked.queue.removeAll()
        }
        try bind(0,"wifi:peer"); try bind(1,"wifi:peer")
        ranked.peers.forEach { $0!.routePreference = { $0.hasPrefix("wifi:") ? 0 : 1 } }
        ranked.attempts.removeAll(); try ranked.peers[0]!.request(ranked.crypto[1].deviceID)
        precondition(ranked.attempts.map { $0.0 } == ["wifi:peer"])
        ranked.pump(); ranked.attempts.removeAll(); try ranked.peers[1]!.decide(ranked.requests[1][0].request.id,accept:true)
        precondition(ranked.attempts.count == 1 && ranked.attempts[0].0 == "wifi:peer"); ranked.pump()
        ranked.peers[0]!.trusted = { _ in true }; ranked.attempts.removeAll(); ranked.peers[0]!.typing(ranked.crypto[1].deviceID,active:true)
        precondition(ranked.attempts.count == 1 && ranked.attempts[0].0 == "wifi:peer")
        ranked.now += 4001; ranked.reject="wifi:peer"; ranked.attempts.removeAll()
        ranked.peers[0]!.typing(ranked.crypto[1].deviceID,active:false)
        precondition(ranked.attempts.map { $0.0 } == ["wifi:peer","direct"] && ranked.attempts[0].1 == ranked.attempts[1].1)
        ranked.reject=nil; ranked.now += 4001; ranked.peers[0]!.routeLoad = { $0.hasPrefix("wifi:") ? 100 : 0 }; ranked.attempts.removeAll()
        ranked.peers[0]!.typing(ranked.crypto[1].deviceID,active:true)
        precondition(ranked.attempts.count == 1 && ranked.attempts[0].0 == "direct")
        ranked.peers[0]!.link("direct",up:false); ranked.peers[0]!.link("wifi:peer",up:false)
        ranked.now += 4001; ranked.attempts.removeAll(); ranked.peers[0]!.typing(ranked.crypto[1].deviceID,active:false)
        precondition(ranked.attempts.isEmpty)
        print("Ranked control routes passed: Wi-Fi preference, queue load, acceptance, typing, exact-frame fallback and disconnected exclusion")

        let art=try Network()
        precondition(art.profiles[0][0].avatarID == "avatar_41" && art.profiles[1][0].avatarID == "avatar_6")
        precondition(art.trust.allSatisfy(\.isEmpty))
        art.avatars[0]="avatar_17"; art.now += 2_001; art.peers[0]!.tick(); let updates=art.queue; art.pump()
        precondition(art.profiles[1][0].avatarID == "avatar_17")
        let latest=art.profiles[1][0]
        let stale=NearbyProfile(handle:"other-link",id:latest.id,key:latest.key,name:latest.name,avatarID:"avatar_6",avatarShared:true,avatarUpdatedAt:latest.avatarUpdatedAt-1)
        precondition(NearbyPeople.displayProfiles([stale,latest]).first?.avatarID == "avatar_17")
        precondition(NearbyPeople.displayProfiles([latest,stale]).first?.avatarID == "avatar_17")
        art.avatars[0]=nil; art.now += 2_001; art.peers[0]!.tick(); art.pump()
        precondition(art.profiles[1][0].avatarID == nil && art.profiles[1][0].avatarShared)
        for (i,f) in updates { art.peers[i]!.receive("direct",f) }
        precondition(art.profiles[1][0].avatarID == nil)
        let original=try LokaPacket.decode(Data(updates[0].1.dropFirst(4)))
        let nonce=try art.crypto[1].decrypt(original).components(separatedBy:"|")[2]
        func inject(_ text: String, handle: String = "direct") throws {
            let frame=try art.crypto[0].encrypt(recipient:art.crypto[1].identity.publicKey,text:text,now:art.now).encode()
            art.peers[1]!.receive(handle,Data("LP1E".utf8)+frame)
        }
        try inject("LP1|I|\(nonce)|\(art.now+1)|../../avatar_1")
        try inject("LP1|I|00000000-0000-0000-0000-000000000000|\(art.now+1)|avatar_1")
        try inject("LP1|I|\(nonce)|\(art.now-60_001)|avatar_1")
        try inject("LP1|I|\(nonce)|\(art.now+2_001)|avatar_1")
        try inject("LP1|I|\(nonce)|0\(art.now)|avatar_1")
        try inject("LP1|I|\(nonce)|\(art.now+1)|avatar_1",handle:"unbound")
        precondition(art.profiles[1][0].avatarID == nil)
        try inject("LP1|I|\(nonce)|\(art.now+1)|avatar_1")
        precondition(art.profiles[1][0].avatarID == "avatar_1")
        art.peers.forEach { $0!.link("direct",up:false) }; art.connect()
        try inject("LP1|I|\(nonce)|\(art.now+2)|avatar_17")
        precondition(art.profiles[1][0].avatarID == nil)
        precondition(NearbyPeople.avatarID("avatar_042") == nil && NearbyPeople.avatarID("../../avatar_1") == nil)
        art.visible[0]=false; art.peers[0]!.visibilityChanged(); art.pump(); art.avatars[0]="avatar_41"; art.now += 2_001; art.peers[0]!.tick(); art.pump()
        precondition(art.profiles[1].isEmpty)
        print("Bundled avatar exchange, live changes, clear, replay, validation and visibility checks passed")
        let n=try Network(); precondition(n.profiles.allSatisfy { $0.first?.carryVersion == 3 }); precondition(n.profiles[0][0].name == "Bob" && n.profiles[1][0].name == "Alice")
        try n.request(); precondition(n.trust.allSatisfy(\.isEmpty))
        try n.peers[1]!.decide(n.requests[1][0].request.id,accept:true); n.queue=[]
        n.peers.forEach { $0!.link("direct",up:false) }; try n.create(1); n.connect(); n.tick()
        precondition(n.trust.allSatisfy { $0.count == 1 }); precondition(n.requests.allSatisfy { $0[0].phase == .complete })
        n.visible[1]=false; n.peers[1]!.visibilityChanged(); n.pump(); precondition(n.profiles[0].isEmpty); n.tick(); precondition(n.profiles[0].isEmpty)
        let quiet=try Network(); try quiet.request(); try quiet.peers[1]!.decide(quiet.requests[1][0].request.id,accept:true); quiet.pump()
        precondition(quiet.requests.allSatisfy { $0.first?.phase == .complete })
        quiet.now += 30_001; quiet.peers.forEach { $0!.tick() }; precondition(quiet.queue.isEmpty)
        quiet.now += 120_001; quiet.peers.forEach { $0!.tick() }; precondition(quiet.queue.count == 2); quiet.pump()
        quiet.peers.forEach { $0!.link("direct",up:false) }; quiet.connect()
        precondition(quiet.profiles.allSatisfy { $0.first?.carryVersion == 3 } && quiet.trust.allSatisfy { $0.count == 1 })
        let denied=try Network(); try denied.request(); try denied.peers[1]!.decide(denied.requests[1][0].request.id,accept:false); denied.pump(); denied.tick()
        precondition(denied.trust.allSatisfy(\.isEmpty)); precondition(denied.requests[0][0].phase == .declined)
        try denied.peers[1]!.block(denied.crypto[0].deviceID); try denied.create(1); denied.peers[0]!.link("direct",up:false); denied.connect(); precondition(denied.profiles[1].isEmpty)
        let broken=try Network(); try broken.request(); broken.failSave=1
        do { try broken.peers[1]!.decide(broken.requests[1][0].request.id,accept:true); fatalError("Storage failure accepted") } catch {}
        broken.pump(); precondition(broken.trust.allSatisfy(\.isEmpty))
        let crossed=try Network(); try crossed.peers[0]!.request(crossed.crypto[1].deviceID); try crossed.peers[1]!.request(crossed.crypto[0].deviceID); crossed.pump(); crossed.tick(); precondition(crossed.trust.allSatisfy { $0.count==1 })
        precondition([nil,127,-100,-82,-74,-67,-60,-50].map(NearbyPeople.bars) == [0,0,1,2,3,4,5,6])
        let typing=try Network(); var hints=[Int64]()
        typing.peers[0]!.trusted={ _ in true }; typing.peers[1]!.typingChanged={ _,until in hints.append(until) }
        typing.peers[0]!.typing(typing.crypto[1].deviceID,active:true); typing.pump(); precondition(hints.isEmpty)
        typing.peers[1]!.trusted={ _ in true }; typing.now += 4_001
        typing.peers[0]!.typing(typing.crypto[1].deviceID,active:true); let frame=typing.queue[0].1; typing.pump()
        precondition(hints == [typing.now+8_000])
        typing.peers[0]!.typing(typing.crypto[1].deviceID,active:true); precondition(typing.queue.isEmpty)
        typing.peers[0]!.typing(typing.crypto[1].deviceID,active:false); typing.pump(); precondition(hints.last == 0)
        typing.peers[1]!.receive("direct",frame); precondition(hints.count == 2)
        typing.now += 9_000; typing.peers[1]!.receive("direct",frame); precondition(hints.count == 2)
        print("Encrypted typing trust, throttle, stop, replay and expiry checks passed")
        print("Nearby profiles, approval, lost reply/restart, decline/block, storage failure, simultaneous requests, withdrawal and signal checks passed")
    }
}
