import Foundation

@main struct MessageProtocolChecks {
    static func rejects(_ body: () throws -> Void) {
        do { try body(); fatalError("Expected rejection") } catch {}
    }
    static func main() throws {
        let alice = try ContactIdentity(persistent: false), bob = try ContactIdentity(persistent: false)
        let a = LokaCrypto(identity: alice), b = LokaCrypto(identity: bob)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let packet = try a.encrypt(recipient: bob.publicKey, text: "Hello 👋 café", now: now)
        let encoded = try packet.encode(), decoded = try LokaPacket.decode(encoded)
        try decoded.validate(now: now)
        let plaintext = try b.decrypt(decoded); precondition(plaintext == "Hello 👋 café")
        let reencoded = try decoded.encode(); precondition(reencoded == encoded)
        rejects { _ = try a.decrypt(packet) }
        rejects { try packet.validate(now: now + 300_001) }
        rejects { _ = try LokaPacket.decode(encoded + Data([0])) }
        rejects { _ = try LokaPacket.decode(encoded.dropLast()) }
        var malformed = packet; malformed.signature[malformed.signature.startIndex] ^= 1
        rejects { _ = try b.decrypt(malformed) }
        malformed = packet; malformed.ciphertext[malformed.ciphertext.startIndex] ^= 1
        malformed.signature = try alice.signMessage(malformed.signedData())
        rejects { _ = try b.decrypt(malformed) }
        malformed = packet; malformed.wrappedKey = try LokaOAEP.wrap(Data(repeating: 0x22, count: 32), recipient: bob.publicKey)
        malformed.signature = try alice.signMessage(malformed.signedData())
        rejects { _ = try b.decrypt(malformed) }
        malformed = packet; malformed.source = b.deviceID
        rejects { try malformed.validate(now: now) }
        let aes = Data(repeating: 0x73, count: 32)
        let oaep = try LokaOAEP.encode(aes)
        let decodedAES = try LokaOAEP.decode(oaep); precondition(decodedAES == aes)
        var invalidOAEP = oaep; invalidOAEP[0] = 1
        rejects { _ = try LokaOAEP.decode(invalidOAEP) }
        for index in [1, 32, 33, 200, 383] {
            invalidOAEP = oaep; invalidOAEP[index] ^= 1
            rejects { _ = try LokaOAEP.decode(invalidOAEP) }
        }
        rejects { _ = try LokaOAEP.encode(Data(count: 31)) }
        rejects { _ = try LokaOAEP.decode(Data(count: 383)) }

        // A -> relay -> B, with no trust or decryption keys for either endpoint at relay.
        let relayCrypto = LokaCrypto(identity: try ContactIdentity(persistent: false))
        var relayClock = now
        var forwarded: [(String, Data)] = []
        let relay = LokaMesh(crypto: relayCrypto, trusted: { _ in false },
            sendFrame: { _ in fatalError("Relay used untargeted broadcast") },
            message: { _, _ in fatalError("Relay decrypted endpoint content") }, event: { _ in },
            sendTo: { peer, data, _ in
                if peer == "broken" { throw LokaProtocolError.invalid }
                forwarded.append((peer, data))
            }, clock: { relayClock })
        relay.setLinks(["ingress", "destination", "broken"])
        precondition(relay.receive(encoded, from: "ingress"))
        precondition(forwarded.count == 1 && forwarded[0].0 == "destination")
        let relayed = try LokaPacket.decode(forwarded[0].1)
        precondition(relayed.hops == packet.hops - 1 && relayed.ciphertext == packet.ciphertext && relayed.signature == packet.signature)
        try relayed.verify()
        let relayPlaintext = try b.decrypt(relayed)
        precondition(relayPlaintext == "Hello 👋 café")
        rejects { _ = try relayCrypto.decrypt(relayed) }
        precondition(relay.receive(encoded, from: "ingress") && forwarded.count == 1)
        let relayArchive = try relay.queued(); precondition(relayArchive.isEmpty)
        relay.setLinks(["ingress", "alternate"])
        precondition(forwarded.count == 2 && forwarded.last?.0 == "alternate")
        relay.setLinks(["ingress", "alternate"]); precondition(forwarded.count == 2)
        relayClock += 15_000; relay.retry()
        precondition(forwarded.count == 3 && forwarded.allSatisfy { $0.0 != "ingress" })
        relayClock += 300_001; relay.retry(); relay.setLinks(["late"])
        precondition(forwarded.count == 3)
        relayClock = now
        let deferred = try a.encrypt(recipient: bob.publicKey, text: "Deferred", now: now)
        relay.setLinks(["ingress"])
        let deferredBytes = try deferred.encode()
        precondition(relay.receive(deferredBytes, from: "ingress"))
        precondition(forwarded.count == 3)
        relay.setLinks(["ingress", "destination"]); precondition(forwarded.count == 4)
        relay.relayEnabled = false
        relay.setLinks(["third"]); precondition(forwarded.count == 4)
        let disabledPacket = try a.encrypt(recipient: bob.publicKey, text: "Disabled", now: now)
        let disabledPacketBytes = try disabledPacket.encode()
        precondition(relay.receive(disabledPacketBytes, from: "ingress"))
        relay.relayEnabled = true
        var exhausted = try a.encrypt(recipient: bob.publicKey, text: "No hops", now: now); exhausted.hops = 0
        let exhaustedBytes = try exhausted.encode()
        precondition(relay.receive(exhaustedBytes, from: "ingress"))
        let noIngress = try a.encrypt(recipient: bob.publicKey, text: "Unknown ingress", now: now)
        let noIngressBytes = try noIngress.encode()
        precondition(relay.receive(noIngressBytes))
        precondition(forwarded.count == 4)
        precondition(!relay.receive(encoded + Data([0]), from: "ingress"))
        print("Swift relay checks passed: ciphertext-only forwarding, ingress exclusion, alternate route, delayed link, retries, expiry, duplicate suppression, relay off, hop limit and failed-link isolation")

        var priorityFrames = [Data](), ordinaryFrames = [Data]()
        var priorityClock = now
        let priorityMesh = LokaMesh(crypto: a, trusted: { _ in true }, sendFrame: { ordinaryFrames.append($0) },
            message: { _, _ in }, event: { _ in }, sendUrgentFrame: { priorityFrames.append($0) }, clock: { priorityClock })
        priorityMesh.link(true)
        let receipt = try ChatContent(kind: "A", id: UUID().uuidString.lowercased()).encode()
        _ = try priorityMesh.send(recipient: bob.publicKey, text: receipt, urgent: true)
        let receiptPlaintext = try b.decrypt(LokaPacket.decode(priorityFrames[0]))
        precondition(receiptPlaintext == receipt && ordinaryFrames.isEmpty)
        priorityClock += 15_000; priorityMesh.retry()
        precondition(priorityFrames.count == 2)
        rejects { _ = try priorityMesh.send(recipient: bob.publicKey, text: "ordinary text", urgent: true) }

        var clock = now, delivered = [String](), sent = [Data](), errors = [String]()
        var trust = false
        let receiver = LokaMesh(crypto: b, trusted: { _ in trust }, sendFrame: { sent.append($0) },
            message: { _, text in delivered.append(text) }, event: { errors.append($0) }, clock: { clock })
        receiver.receive(encoded); precondition(delivered.isEmpty && errors.contains(where: { $0.contains("rejected") }))
        trust = true
        receiver.receive(encoded); receiver.receive(encoded)
        precondition(delivered == ["Hello 👋 café"])
        // Transport connectivity does not replace sender trust; expiry prevents later delivery.
        let later = try a.encrypt(recipient: bob.publicKey, text: "Too late", now: now)
        clock = now + 300_001; receiver.receive(try later.encode()); precondition(delivered.count == 1)
        clock = now
        let sender = LokaMesh(crypto: a, trusted: { _ in true }, sendFrame: { sent.append($0) }, message: { _, _ in }, event: { _ in }, clock: { clock })
        _ = try sender.send(recipient: bob.publicKey, text: "Queued offline")
        precondition(sent.isEmpty)
        sender.link(true); precondition(sent.count == 1)
        sender.link(true); precondition(sent.count == 1) // Additional transport-ready events must not replay the whole queue.
        sender.link(false); sender.link(true); precondition(sent.count == 2)
        clock += 300_001; sender.link(false); sender.link(true); precondition(sent.count == 2)
        clock = now
        // A receipt lost during disconnect is retained, can survive archive restore,
        // and expires normally. It is ciphertext to the transport just like text.
        sent.removeAll()
        let receiptText = "L1|A|" + UUID().uuidString.lowercased()
        let receiptSender = LokaMesh(crypto: b, trusted: { _ in true }, sendFrame: { _ in throw LokaProtocolError.invalid }, message: { _, _ in }, event: { _ in }, clock: { clock })
        receiptSender.link(true)
        _ = try receiptSender.send(recipient: alice.publicKey, text: receiptText)
        let savedReceipts = try receiptSender.queued(); precondition(savedReceipts.count == 1)
        let restoredReceipts = LokaMesh(crypto: b, trusted: { _ in true }, sendFrame: { sent.append($0) }, message: { _, _ in }, event: { _ in }, clock: { clock })
        try restoredReceipts.restore(savedReceipts[0]); restoredReceipts.link(true)
        precondition(sent.count == 1)
        let receivedReceipt = try a.decrypt(LokaPacket.decode(sent[0])); precondition(receivedReceipt == receiptText)
        clock += 300_001; restoredReceipts.retry()
        let expiredReceipts = try restoredReceipts.queued(); precondition(expiredReceipts.isEmpty)
        clock = now
        let bounded = LokaMesh(crypto: a, trusted: { _ in true }, sendFrame: { _ in }, message: { _, _ in }, event: { _ in }, clock: { clock })
        for _ in 0..<128 { _ = try bounded.send(recipient: bob.publicKey, text: "Bounded queue test") }
        rejects { _ = try bounded.send(recipient: bob.publicKey, text: "Must not exceed capacity") }
        bounded.forget(b.deviceID)
        _ = try bounded.send(recipient: bob.publicKey, text: "Queue released after removing friend")

        if CommandLine.arguments.count == 3 {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("loka-interop-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            defer { try? FileManager.default.removeItem(at: directory) }
            try alice.publicKey.write(to: directory.appendingPathComponent("swift-public.der"))
            func java(_ action: String) throws {
                let process = Process(); process.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
                process.arguments = ["-cp", CommandLine.arguments[2], "JavaInterop", action, directory.path]
                try process.run(); process.waitUntilExit(); precondition(process.terminationStatus == 0)
            }
            try java("generate")
            var javaPacket = try LokaPacket.decode(Data(contentsOf: directory.appendingPathComponent("java-packet.bin")))
            javaPacket.hops -= 1 // An intermediary may mutate the hop budget without breaking the message signature.
            try javaPacket.validate(now: Int64(Date().timeIntervalSince1970 * 1000))
            let javaPlaintext = try a.decrypt(javaPacket); precondition(javaPlaintext == "Hello iPhone 👋 café")
            let response = try a.encrypt(recipient: Data(contentsOf: directory.appendingPathComponent("java-public.der")), text: "Hello Android 👋 café", now: Int64(Date().timeIntervalSince1970 * 1000))
            try response.encode().write(to: directory.appendingPathComponent("swift-packet.bin"))
            try java("decrypt")
            // Isolated consent exchange: real v0 encryption, no production trust-store changes.
            let javaKey = try Data(contentsOf: directory.appendingPathComponent("java-public.der"))
            let javaID = ContactCode.fingerprint(javaKey)
            let consent = try ContactConsentBook(own: a.deviceID)
            let request = try consent.begin(peer: javaID, name: "iPhone Test", now: now)
            let requestPacket = try a.encrypt(recipient: javaKey, text: request.encode(), now: now)
            try requestPacket.encode().write(to: directory.appendingPathComponent("consent-request.bin"))
            try java("consent-accept")
            let acceptancePacket = try LokaPacket.decode(Data(contentsOf: directory.appendingPathComponent("consent-accept.bin")))
            try acceptancePacket.validate(now: now)
            let acceptance = try ContactConsent.decode(a.decrypt(acceptancePacket))
            let ack = try consent.receive(peer: acceptancePacket.source, content: acceptance, now: now)!
            let ackPacket = try a.encrypt(recipient: javaKey, text: ack.encode(), now: now)
            try ackPacket.encode().write(to: directory.appendingPathComponent("consent-ack.bin"))
            try java("consent-confirm")
            let approved = try consent.snapshot(now: now)
            precondition(approved[0].phase == .complete && approved[0].peerName == "Android Test")
        } else { fatalError("Pass Java binary and classpath to require bidirectional actual Android-core checks") }
        print("Swift message checks passed: actual Android ↔ Swift encryption and Android relay, codec, signatures, tags, OAEP rejection, trust, duplicates, expiry, bounded queue and offline replay")
    }
}
