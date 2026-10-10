import Foundation
@main struct Checks {
    static func rejects(_ block: () throws -> Void) { do { try block(); fatalError("Expected rejection") } catch { } }
    static func main() throws {
        let a = LokaCrypto(identity: try ContactIdentity(persistent: false))
        let bob = try ContactIdentity(persistent: false)
        let b = LokaCrypto(identity: bob)
        let now: Int64 = 1800000000000
        let event = GameEvent(kind:"C",id:UUID().uuidString.lowercased(),session:UUID().uuidString.lowercased(),pack:String(repeating:"c",count:64),expires:now+120000)
        let text = try event.encode()
        let packet = try a.encrypt(recipient:bob.publicKey, text:text,now:now,automatic:true,lifetimeMs:120000)
        precondition(packet.expiresAt==now+120000); try packet.verify()
        let plain = try b.decrypt(packet); precondition(plain==text)
        var tampered=packet; tampered.expiresAt+=1; rejects { try tampered.verify() }
        rejects { try packet.validate(now:now+120000) }
        rejects { _ = try a.encrypt(recipient:bob.publicKey,text:text,now:now,lifetimeMs:0) }
        rejects { _ = try a.encrypt(recipient:bob.publicKey,text:text,now:now,lifetimeMs:300001) }
        let chat=try a.encrypt(recipient:bob.publicKey,text:"chat",now:now)
        let carry=try a.encrypt(recipient:bob.publicKey,text:"chat",now:now,automatic:true)
        precondition(chat.expiresAt==now+300000 && carry.expiresAt==now+3600000)
        let folder=FileManager.default.temporaryDirectory.appendingPathComponent("loka-game-test-\(UUID())")
        defer { try? FileManager.default.removeItem(at:folder) }
        let archive=try MessageArchive(directory:folder,testKey:Data(repeating:42,count:32))
        let raw="Q1|\(event.pack)\n-"; try archive.saveGame(raw)
        let restored=try archive.loadGame(); precondition(restored==raw)
        let history=try archive.load(); precondition(history.messages.isEmpty && history.outbox.isEmpty)
        let file=folder.appendingPathComponent("loka-game-v1.enc")
        var data=try Data(contentsOf:file); precondition(data.range(of:Data(raw.utf8))==nil)
        data[data.count-1]^=1; try data.write(to:file); rejects { _ = try archive.loadGame() }
        precondition(QuickQuiz.canQueue(95) && !QuickQuiz.canQueue(96))
        print("Game capability event: \(text.utf8.count) plaintext bytes; \(try packet.encode().count) encrypted packet bytes before transport framing")
        print("PASS Swift game encrypted envelope: short signed expiry, unchanged chat defaults, tamper rejection, isolated encrypted game storage and queue reserve")
    }
}
