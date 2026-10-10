import Foundation
@main struct Checks {
    static func rejects(_ block: () throws -> Void) { do { try block(); fatalError("Expected rejection") } catch {} }
    static func main() throws {
        let catalog=try PartyCatalog.load(url:URL(fileURLWithPath:CommandLine.arguments[1]))
        precondition(catalog.games.count==8 && catalog.games.flatMap(\.cards).count==294)
        precondition(catalog.games.first{$0.id=="two_player_specials"}!.instructions.keys.sorted()==["couples"])
        let localDeck=FilteredCardDeck(cards:catalog.games.flatMap(\.cards))
        for context in [CardAudience(players:2,mode:"friends"),CardAudience(players:2,mode:"couples"),CardAudience(players:4,mode:"group"),CardAudience(players:20,mode:"group")] {
            let eligible=localDeck.eligible(["clean","drinking","dirty"],adult:true,drinking:true,audience:context)
            precondition(!eligible.isEmpty && eligible.allSatisfy{context.accepts($0) && !$0.gameName.isEmpty && !$0.playRule(context.mode).isEmpty})
            precondition(context.mode=="couples" || !eligible.contains{$0.game=="two_player_specials"})
        }
        let alice = try ContactIdentity(persistent:false), bob = try ContactIdentity(persistent:false)
        let a = LokaCrypto(identity:alice), b = LokaCrypto(identity:bob)
        let now:Int64 = 1800000000000, pack = String(repeating:"f",count:64)
        let e = PartyEvent(kind:"C",id:UUID().uuidString.lowercased(),session:UUID().uuidString.lowercased(),pack:pack,expires:now+120000)
        let text = try e.encode(); var delivered:[String] = []
        let mesh = LokaMesh(crypto:b,trusted:{_ in false},sendFrame:{_ in},message:{_,raw in delivered.append(raw)},event:{_ in},clock:{now})
        let packet = try a.encrypt(recipient:bob.publicKey,text:text,now:now)
        _ = mesh.receive(try packet.encode());precondition(delivered.isEmpty)
        mesh.applicationPeer = {$0==a.deviceID};mesh.applicationContent = {id,raw in id==a.deviceID && (try? PartyEvent.decode(raw).pack)==pack}
        _ = mesh.receive(try packet.encode());precondition(delivered==[text])
        _ = mesh.receive(try a.encrypt(recipient:bob.publicKey,text:"chat",now:now).encode());precondition(delivered.count==1)
        _ = mesh.receive(try a.encrypt(recipient:bob.publicKey,text:text.replacingOccurrences(of:"L1|G|2|",with:"L1|G|9|"),now:now).encode());precondition(delivered.count==1)
        rejects { _ = try mesh.send(recipient:alice.publicKey,text:"chat") }
        _ = try mesh.send(recipient:alice.publicKey,text:text)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("loka-party-archive-\(UUID())")
        defer { try? FileManager.default.removeItem(at:dir) }
        let archive = try MessageArchive(directory:dir,testKey:Data(repeating:42,count:32))
        try archive.saveParty("party saved proposal");try archive.saveGame("quiz saved state")
        let party = try archive.loadParty(), quiz = try archive.loadGame(), chat = try archive.load()
        precondition(party=="party saved proposal" && quiz=="quiz saved state" && chat.messages.isEmpty)
        let file = dir.appendingPathComponent("loka-party-v1.enc");var data = try Data(contentsOf:file)
        precondition(data.range(of:Data("party saved proposal".utf8))==nil);data[data.count-1]^=1;try data.write(to:file)
        rejects { _ = try archive.loadParty() };let unchangedQuiz = try archive.loadGame();precondition(unchangedQuiz==quiz)
        rejects { try archive.saveParty(String(repeating:"x",count:32769)) }
        let move=PartyEvent(kind:"M",id:UUID().uuidString.lowercased(),session:e.session,pack:pack,expires:now+120000,revision:1,value:"skip",ref:UUID().uuidString.lowercased())
        let moveText=try move.encode(), movePacket=try a.encrypt(recipient:bob.publicKey,text:move.encode(),now:now,automatic:true,multiCarry:true,lifetimeMs:120000)
        print("Party Cards move: \(moveText.utf8.count) plaintext bytes; \(try movePacket.encode().count) encrypted v3 direct packet bytes before transport framing and ACKs")
        print("PASS Swift scoped non-contact encrypted Cards admission, rejected chat/unsupported version, isolated protected Party/Quiz/chat archives, tamper and size limits")
    }
}
