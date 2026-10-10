import Foundation
import CryptoKit

@main struct ChatContentChecks {
    static func main() throws {
        let id = "11111111-1111-4111-8111-111111111111"
        let read = try ChatContent.decode("L1|B|\(id)|100")!; precondition(String(data: read.data, encoding: .utf8) == "100")
        let readEncoded = try read.encode(); precondition(readEncoded == "L1|B|\(id)|100")
        for at in ["", "-1", "001", "9223372036854775808", "100|extra"] { do { _ = try ChatContent.decode("L1|B|\(id)|\(at)"); fatalError("Invalid read timestamp accepted") } catch {} }
        let hop = try ChatContent.decode("L1|H|\(id)|2")!; precondition(hop.index == 2)
        for bad in ["L1|H|\(id)|0", "L1|H|\(id)|8", "L1|H|\(id)|02"] {
            do { _ = try ChatContent.decode(bad); fatalError("Invalid hop accepted") } catch {}
        }
        let reaction = ChatContent(kind: "R", id: id, data: Data("\(id)|❤️".utf8))
        let reactionRoundtrip = try ChatContent.decode(reaction.encode())!; precondition(reactionRoundtrip.data == reaction.data)
        let replaced = try ChatContent.newerReaction("100|\(id)|👍", "101|\(id)|")
        let stale = try ChatContent.newerReaction("101|\(id)|", "100|\(id)|👍")
        precondition(replaced && !stale)
        let receipt = try ChatContent.decode("L1|A|\(id)")!
        precondition(receipt.acknowledges(messageID: id, recipient: "bob", sender: "bob"))
        precondition(!receipt.acknowledges(messageID: id, recipient: "bob", sender: "mallory"))
        precondition(!receipt.acknowledges(messageID: UUID().uuidString, recipient: "bob", sender: "bob"))
        let text = ChatContent(kind: "T", id: id, data: Data("Hello 👋 café".utf8))
        let encoded = try text.encode()
        precondition(encoded == "L1|T|11111111-1111-4111-8111-111111111111|SGVsbG8g8J+RiyBjYWbDqQ==")
        precondition(tryDecode(encoded)?.data == text.data)
        for bad in ["L1|A|bad", "L1|A|\(id)|extra", "L1|T|\(id)|/w==", "L1|T|\(id)|YQ", "L1|V|\(id)|0|97|YQ==", "L1|V|\(id)|00|1|YQ=="] {
            do { _ = try ChatContent.decode(bad); fatalError("Malformed content accepted") } catch {}
        }
        let bytes = Data((0..<98304).map { UInt8($0 % 251) }); let chunks = try ChatContent.voice(id: id, data: bytes)
        let assembly = VoiceAssembly()
        var result: Data?
        for part in chunks.reversed() { result = try assembly.accept(sender: "friend", part: part, expires: 100, now: 0) }
        precondition(result == bytes)
        let expired = VoiceAssembly()
        _ = try expired.accept(sender: "friend", part: chunks[0], expires: 10, now: 0)
        precondition(tryAccept(expired, chunks[1], 11) == nil)
        let jpeg = try Data(contentsOf: URL(fileURLWithPath: "android/loka-mesh-lab/core/src/test/resources/image-test.jpg"))
        precondition(ChatContent.validImage(jpeg))
        precondition(!ChatContent.validImage(jpeg.dropLast()))
        precondition(!ChatContent.validImage(Data(repeating: 0, count: 65537)))
        var bomb = [UInt8](jpeg)
        let sof = (0..<(bomb.count - 1)).first { bomb[$0] == 255 && bomb[$0+1] == 192 }!
        bomb[sof+5] = 127; bomb[sof+6] = 255
        precondition(!ChatContent.validImage(Data(bomb)))
        let imageParts = try ChatContent.image(id: id, data: jpeg)
        precondition(imageParts.count > 1)
        let imageAssembly = VoiceAssembly()
        var imageResult: Data?
        for part in imageParts.reversed() { imageResult = try imageAssembly.accept(sender: "friend", part: ChatContent.decode(part.encode())!, expires: 100, now: 0) }
        precondition(imageResult == jpeg)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("loka-history-test-\(UUID())")
        defer { try? FileManager.default.removeItem(at: dir) }
        let key = Data(repeating: 42, count: 32)
        let archive = try MessageArchive(directory: dir, testKey: key)
        let message = LokaMessage(id: id, friendID: String(repeating: "a", count: 64), text: "private test text", outgoing: false, timestamp: 1, expiresAt: 300001)
        let photoMessage = LokaMessage(id: UUID().uuidString.lowercased(), friendID: message.friendID, text: jpeg.base64EncodedString(), outgoing: true, timestamp: 1, expiresAt: 300001, image: true)
        let voiceMessage = LokaMessage(id: UUID().uuidString.lowercased(), friendID: message.friendID, text: bytes.base64EncodedString(), outgoing: true, timestamp: 1, expiresAt: 300001, voice: true, packetIDs: (0..<96).map { _ in UUID().uuidString.lowercased() })
        var annotated = message; annotated.deliveredAt = 100; annotated.readAt = 101; annotated.readReceiptQueued = true; annotated.reportedHops = 3; annotated.myReaction = "100|\(id)|👍"; annotated.peerReaction = "101|\(id)|❤️"
        annotated.route = LocalRouteEvidence(transport: "ble", carrier: String(repeating: "b", count: 64), at: 100, expiresAt: 300001)
        precondition(annotated.route!.valid)
        let state = MessageArchive.State(messages: [annotated, photoMessage, voiceMessage], outbox: [], replyActions: [])
        try archive.save(state); let restored = try MessageArchive(directory: dir, testKey: key).load(); precondition(restored == state)
        let encounters = EncounterHistory()
        let peer = String(repeating: "a", count: 64)
        encounters.observe([peer], now: 0); encounters.observe([peer], now: 6000)
        try archive.saveEncounters(encounters.saved(now: 66000), now: 66000)
        let encounterRestart = try MessageArchive(directory: dir, testKey: key).loadEncounters(now: 66000)
        precondition(encounterRestart == encounters.saved(now: 66000))
        let encounterURL = dir.appendingPathComponent("loka-encounters-v1.enc")
        var encounterCipher = try Data(contentsOf: encounterURL)
        precondition(encounterCipher.range(of: Data(peer.utf8)) == nil)
        encounterCipher[encounterCipher.count - 1] ^= 1; try encounterCipher.write(to: encounterURL)
        do { _ = try archive.loadEncounters(now: 66000); fatalError("Tampered encounters accepted") } catch {}
        let unaffectedHistory = try archive.load(); precondition(unaffectedHistory == state)
        let lateOld = LokaMessage(id: "00000000-0000-0000-0000-000000000001", friendID: message.friendID, text: "Earlier", outgoing: false, timestamp: 10, expiresAt: 300010)
        var newer = LokaMessage(id: "00000000-0000-0000-0000-000000000003", friendID: message.friendID, text: "Later", outgoing: true, timestamp: 20, expiresAt: 300020)
        let tied = LokaMessage(id: "00000000-0000-0000-0000-000000000002", friendID: message.friendID, text: "Same time", outgoing: false, timestamp: 20, expiresAt: 300020)
        let expected = [lateOld.id, tied.id, newer.id]
        newer.deliveredAt = 999; newer.readAt = 1000
        for arrivals in [[newer, tied, lateOld], [lateOld, newer, tied], [tied, lateOld, newer]] {
            precondition(arrivals.sorted(by: lokaMessagePrecedes).map(\.id) == expected)
            precondition(arrivals.max(by: lokaMessagePrecedes)?.id == newer.id)
        }
        try archive.save(MessageArchive.State(messages: [newer, tied, lateOld], outbox: [], replyActions: []))
        let delayedRestored = try archive.load()
        precondition(delayedRestored.messages.sorted(by: lokaMessagePrecedes).map(\.id) == expected)
        try archive.save(state)
        let url = dir.appendingPathComponent("loka-messages-v1.enc")
        var cipher = try Data(contentsOf: url); precondition(cipher.range(of: Data(message.text.utf8)) == nil)
        cipher[cipher.count - 1] ^= 1; try cipher.write(to: url)
        do { _ = try archive.load(); fatalError("Tampered history accepted") } catch {}
        print("Chat content and encrypted archive checks passed: shared text vector, image bounds/reorder, 96 KiB voice, media archive restart and tamper rejection")
    }
    static func tryDecode(_ text: String) -> ChatContent? { try? ChatContent.decode(text) }
    static func tryAccept(_ assembly: VoiceAssembly, _ chunk: ChatContent, _ now: Int64) -> Data? { try? assembly.accept(sender: "friend", part: chunk, expires: 100, now: now) }
}
