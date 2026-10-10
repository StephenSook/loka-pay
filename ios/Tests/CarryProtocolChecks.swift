import Foundation

@main struct CarryProtocolChecks {
    static func rejects(_ body: () throws -> Void) {
        do { try body(); fatalError("Expected rejection") } catch {}
    }
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("loka-carry-check-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        func java(_ mode: String, _ extra: [String] = []) throws {
            let p = Process(); p.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
            p.arguments = ["-cp", CommandLine.arguments[2], "JavaInterop", mode, directory.path] + extra
            try p.run(); p.waitUntilExit(); precondition(p.terminationStatus == 0)
        }
        let source = LokaCrypto(identity: try ContactIdentity(persistent: false))
        let carrier = LokaCrypto(identity: try ContactIdentity(persistent: false))
        let stranger = LokaCrypto(identity: try ContactIdentity(persistent: false))
        try source.identity.publicKey.write(to: directory.appendingPathComponent("swift-public.der"))
        try java("generate")
        let destination = try Data(contentsOf: directory.appendingPathComponent("java-public.der"))
        var time = Int64(Date().timeIntervalSince1970 * 1000)
        let storageKey = Data(repeating: 0x71, count: 32)
        var storage = try MessageArchive(directory: directory, testKey: storageKey)
        var writes: [Data] = []
        func relay() -> LokaMesh {
            LokaMesh(crypto: carrier, trusted: { _ in false }, sendFrame: { writes.append($0) }, message: { _, _ in fatalError("Carrier decrypted") }, event: { _ in }, clock: { time }, saveCarry: { try storage.saveCarry($0) })
        }
        let packet = try source.encrypt(recipient: destination, text: "Carry interoperability", now: time, carrier: carrier.deviceID)
        let bytes = try packet.encode()
        let first = relay()
        precondition(first.receive(bytes, from: "sender"))
        let saved = try storage.loadCarry(); precondition(saved.count == 1)
        let encoded = try Data(contentsOf: directory.appendingPathComponent("loka-carry-v1.enc"))
        precondition(encoded.range(of: Data("Carry interoperability".utf8)) == nil)
        rejects { _ = try carrier.decrypt(packet) }
        var tampered = packet; tampered.carrier = stranger.deviceID
        rejects { try tampered.verify() }
        tampered = packet; tampered.expiresAt += 1
        rejects { try tampered.verify() }
        // Real encrypted archive re-open, simulated elapsed time, recreated native engine.
        time += 600000
        storage = try MessageArchive(directory: directory, testKey: storageKey)
        let restored = relay(); try restored.restoreCarry(storage.loadCarry()); restored.link(true)
        precondition(writes.count == 1)
        let forwarded = try LokaPacket.decode(writes[0])
        precondition(forwarded.expiresAt == packet.expiresAt && forwarded.hops == 5)
        try writes[0].write(to: directory.appendingPathComponent("swift-carry.bin"))
        try java("carry-check", [String(time)])
        let ack = try Data(contentsOf: directory.appendingPathComponent("java-carry-receipt.bin"))
        var delivered: [String] = []
        let sender = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { _ in }, message: { _, text in delivered.append(text) }, event: { _ in }, clock: { time })
        precondition(!sender.receive(ack, from: "direct")); precondition(delivered.isEmpty)
        writes.removeAll(); precondition(restored.receive(ack, from: "recipient"))
        precondition(writes.count == 1)
        precondition(sender.receive(writes[0], from: "carrier")); precondition(delivered == ["Carry receipt"])
        // Storage failure must not poison the duplicate cache or forward first.
        var fail = true; var commits = 0; var sent = 0
        let retry = LokaMesh(crypto: carrier, trusted: { _ in false }, sendFrame: { _ in precondition(commits > 0); sent += 1 }, message: { _, _ in }, event: { _ in }, clock: { time }, saveCarry: { _ in if fail { throw LokaProtocolError.invalid }; commits += 1 })
        retry.link(true); precondition(!retry.receive(bytes, from: "sender")); precondition(sent == 0)
        fail = false; precondition(retry.receive(bytes, from: "sender")); precondition(sent == 1 && commits == 1)
        time = packet.expiresAt; rejects { try packet.validate(now: time) }
        var corrupt = encoded; corrupt[corrupt.startIndex] ^= 1
        try corrupt.write(to: directory.appendingPathComponent("loka-carry-v1.enc"))
        rejects { _ = try storage.loadCarry() }
        // Ordinary send starts offline; a subsequently verified peer is selected without UI input.
        time = packet.createdAt
        var sourceDisk: [Data] = []; var autoWrites: [(String,Data)] = []; var peerIDs: [String:String] = [:]
        var receipts: [String] = []
        let origin = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { _ in },
            message: { _,text in receipts.append(text) }, event: { _ in },
            sendTo: { h,f,_ in autoWrites.append((h,f)) }, clock: { time }, saveCarry: { sourceDisk = $0 })
        origin.carryPeer = { peerIDs[$0] }
        let automatic = try origin.send(recipient: destination, text: "Carry interoperability", automatic: true)
        precondition(automatic.version == 2 && automatic.carrier.isEmpty)
        origin.setLinks(["b"]); precondition(autoWrites.isEmpty)
        peerIDs["b"] = carrier.deviceID; origin.retry()
        let selected = try LokaPacket.decode(sourceDisk[0])
        precondition(selected.carrier == carrier.deviceID && selected.id == automatic.id && selected.ciphertext == automatic.ciphertext)
        try selected.verify()
        var altered = selected; altered.carrier = stranger.deviceID; rejects { try altered.verify() }
        try storage.saveCarry([]); writes.removeAll()
        let autoRelay = relay(); autoRelay.carryPeer = { $0 == "c" ? ContactCode.fingerprint(destination) : stranger.deviceID }
        precondition(autoRelay.receive(autoWrites[0].1, from: "a"))
        time += 600000
        storage = try MessageArchive(directory: directory, testKey: storageKey)
        let autoRestored = relay(); autoRestored.carryPeer = { $0 == "c" ? ContactCode.fingerprint(destination) : $0 == "a" ? source.deviceID : stranger.deviceID }
        try autoRestored.restoreCarry(storage.loadCarry()); autoRestored.setLinks(["other"])
        precondition(writes.isEmpty)
        autoRestored.setLinks(["c"]); precondition(writes.count == 1)
        try writes[0].write(to: directory.appendingPathComponent("swift-carry.bin"))
        try java("auto-carry-check", [String(time)])
        let autoAck = try Data(contentsOf: directory.appendingPathComponent("java-carry-receipt.bin"))
        writes.removeAll(); precondition(autoRestored.receive(autoAck, from: "c"))
        autoRestored.setLinks(["a"]); precondition(writes.count == 1)
        precondition(origin.receive(writes[0], from: "b")); precondition(receipts == ["Carry receipt"])
        // Direct v2 is valid; receiver does not require an artificial relay traversal.
        let direct = try carrier.encrypt(recipient: source.identity.publicKey, text: "direct", now: time, automatic: true)
        let directBytes = try direct.encode(); precondition(origin.receive(directBytes, from: "direct")); precondition(receipts.last == "direct")
        // Restart must never choose a second carrier, including on another radio.
        autoWrites.removeAll(); peerIDs["other"] = stranger.deviceID
        let recoveredOrigin = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { autoWrites.append(("unexpected",$0)) }, message: { _,_ in }, event: { _ in }, clock: { time }, saveCarry: { sourceDisk = $0 })
        recoveredOrigin.carryPeer = { peerIDs[$0] }; try recoveredOrigin.restoreCarry(sourceDisk)
        recoveredOrigin.setLinks(["other"]); precondition(autoWrites.isEmpty)
        var fallbackDisk: [Data] = []; var fallbackWrites: [String] = []
        let fallback = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { _ in }, message: { _,_ in }, event: { _ in },
            sendTo: { h,_,_ in if h == "c" { throw LokaProtocolError.invalid }; fallbackWrites.append(h) }, clock: { time }, saveCarry: { fallbackDisk = $0 })
        fallback.carryPeer = { $0 == "c" ? ContactCode.fingerprint(destination) : carrier.deviceID }
        fallback.setLinks(["c"]); _ = try fallback.send(recipient: destination, text: "fallback", automatic: true)
        fallback.setLinks(["c","b"])
        let fallbackPacket = try LokaPacket.decode(fallbackDisk[0])
        precondition(fallbackWrites == ["b"] && fallbackPacket.carrier == carrier.deviceID)
        var duplicateWrites = 0
        let multiRadio = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { _ in duplicateWrites += 1 }, message: { _,_ in }, event: { _ in }, clock: { time }, saveCarry: { _ in })
        multiRadio.carryPeer = { _ in ContactCode.fingerprint(destination) }
        multiRadio.setLinks(["r1","r2"]); _ = try multiRadio.send(recipient: destination, text: "one copy", automatic: true)
        precondition(duplicateWrites == 1)
        multiRadio.setLinks(["r1","r2","r3"]); precondition(duplicateWrites == 1)
        time += 15000; multiRadio.retry(); precondition(duplicateWrites == 2)
        var chosenRoutes: [String] = []; var observedRoutes: [String] = []
        let lessBusy = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { _ in }, message: { _,_ in }, event: { _ in }, sendTo: { h,_,_ in chosenRoutes.append(h) }, clock: { time }, saveCarry: { _ in })
        lessBusy.carryPeer = { _ in ContactCode.fingerprint(destination) }
        lessBusy.routeLoad = { $0 == "a-busy" ? 1400 : 0 }
        lessBusy.observeRoute = { _,h,outgoing in if outgoing { observedRoutes.append(h ?? "unknown") } }
        lessBusy.setLinks(["a-busy","z-clear"])
        _ = try lessBusy.send(recipient: destination, text: "clear route", automatic: true)
        precondition(chosenRoutes == ["z-clear"] && observedRoutes == chosenRoutes)
        var receiptWrites: [Data] = []
        let fair = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { receiptWrites.append($0) }, message: { _,_ in }, event: { _ in }, clock: { time })
        fair.link(true)
        for i in 0..<5 { _ = try fair.send(recipient: carrier.identity.publicKey, text: "data \(i)") }
        for _ in 0..<4 { _ = try fair.send(recipient: carrier.identity.publicKey, text: ChatContent(kind: "A", id: UUID().uuidString.lowercased()).encode(), urgent: true) }
        receiptWrites.removeAll(); time += 15000; fair.retry()
        let retried = try receiptWrites.map { try carrier.decrypt(LokaPacket.decode($0)) }
        precondition(retried.count == 4)
        precondition(retried.filter { $0.hasPrefix("L1|A|") }.count == 3)
        precondition(retried.filter { $0.hasPrefix("data ") }.count == 1)
        var preferredWrites: [String] = []
        var handoffWrites: [String] = []
        var destinationVerified = false
        let handoff = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { _ in }, message: { _,_ in }, event: { _ in }, sendTo: { h,_,_ in handoffWrites.append(h) }, clock: { time }, saveCarry: { _ in })
        handoff.carryPeer = { $0 == "relay" ? carrier.deviceID : destinationVerified ? ContactCode.fingerprint(destination) : nil }
        handoff.setLinks(["relay", "destination"])
        _ = try handoff.send(recipient: destination, text: "fast handoff", automatic: true)
        precondition(handoffWrites == ["relay"])
        time += 1000; destinationVerified = true; handoff.retry()
        precondition(handoffWrites == ["relay", "destination"])
        handoff.retry(); precondition(handoffWrites.count == 2)
        var loads = ["ble:b": 0, "wifi:b": 0]
        let preferred = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { _ in }, message: { _,_ in }, event: { _ in }, sendTo: { h,_,_ in preferredWrites.append(h) }, clock: { time }, saveCarry: { _ in })
        preferred.carryPeer = { _ in carrier.deviceID }; preferred.routeLoad = { loads[$0] ?? 0 }
        preferred.routePreference = { $0.hasPrefix("wifi:") ? 0 : 1 }
        preferred.setLinks(["ble:b","wifi:b"])
        _ = try preferred.send(recipient: carrier.identity.publicKey, text: "wifi", automatic: true)
        precondition(preferredWrites == ["wifi:b"])
        preferredWrites.removeAll(); loads["wifi:b"] = 1000
        _ = try preferred.send(recipient: carrier.identity.publicKey, text: "fallback", automatic: true)
        precondition(preferredWrites == ["ble:b"])
        preferredWrites.removeAll(); loads["ble:b"] = 1000
        let held = try preferred.send(recipient: carrier.identity.publicKey, text: "held", automatic: true)
        precondition(preferredWrites.isEmpty)
        loads["wifi:b"] = 0; preferred.retry(); precondition(preferredWrites == ["wifi:b"])
        let heldFrames = try preferred.queued(); let heldIDs = try heldFrames.map { try LokaPacket.decode($0).id }
        precondition(heldIDs.contains(held.id))
        var repeated: [Data] = []
        let paced = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { repeated.append($0) }, message: { _,_ in }, event: { _ in }, clock: { time }, saveCarry: { _ in })
        paced.carryPeer = { _ in carrier.deviceID }; paced.link(true)
        let old = try paced.send(recipient: carrier.identity.publicKey, text: "old", automatic: true)
        time += 15000; paced.retry(); precondition(repeated.count == 2)
        time += 15000; paced.retry(); precondition(repeated.count == 2)
        time += 15000; paced.retry(); precondition(repeated.count == 3)
        time += 60000; paced.retry(); precondition(repeated.count == 4)
        time += 119000; paced.retry(); precondition(repeated.count == 4)
        time += 1000; paced.retry(); precondition(repeated.count == 5)
        let fresh = try paced.send(recipient: carrier.identity.publicKey, text: "fresh", automatic: true)
        let lastPacket = try LokaPacket.decode(repeated.last!); precondition(lastPacket.id == fresh.id)
        let retained = try paced.queued().map { try LokaPacket.decode($0) }; precondition(retained.first { $0.id == old.id }?.expiresAt == old.expiresAt)
        paced.link(false); time += 16000; let count = repeated.count; paced.setLinks(["new"])
        precondition(repeated.count == count + 2)
        var busy = true; var drained: [String] = []
        let onDrain = LokaMesh(crypto: source, trusted: { _ in true }, sendFrame: { frame in drained.append(try LokaPacket.decode(frame).id); busy = true }, message: { _,_ in }, event: { _ in }, clock: { time }, saveCarry: { _ in })
        onDrain.carryPeer = { _ in carrier.deviceID }; onDrain.routeLoad = { _ in busy ? 1000 : 0 }; onDrain.link(true)
        let older = try onDrain.send(recipient: carrier.identity.publicKey, text: "older", automatic: true)
        time += 1000; let latest = try onDrain.send(recipient: carrier.identity.publicKey, text: "fresh", automatic: true)
        precondition(drained.isEmpty)
        busy = false; onDrain.retry(); precondition(drained == [latest.id])
        time += 16000; busy = false; onDrain.retry(); precondition(drained == [latest.id, older.id])
        var receiptWindow = ReceiptWindow(capacity: 1)
        precondition(receiptWindow.canCreate(sender: "a", message: "m", now: 0))
        precondition(receiptWindow.canCreate(sender: "a", message: "m", now: 1)) // failed save never remembers
        receiptWindow.remember(sender: "a", message: "m", deadline: 3600000, now: 1)
        precondition(!receiptWindow.canCreate(sender: "a", message: "m", now: 300001))
        precondition(!receiptWindow.canCreate(sender: "b", message: "m", now: 3599999)) // bounded capacity
        precondition(receiptWindow.canCreate(sender: "b", message: "m", now: 3600000))
        var separate = ReceiptWindow()
        separate.remember(sender: "a", message: "m", deadline: 3600000, now: 0)
        precondition(separate.canCreate(sender: "b", message: "m", now: 300001))
        print("Automatic carry passed: queued before discovery, verified peer selection, durable signed binding, one relay only, encrypted restart, Swift to Kotlin payload and returned receipt, direct delivery")
        print("Native carry checks passed: Swift encrypted archive restart after simulated 10 minutes → actual Kotlin decryption → receipt via carrier → Swift, policy tampering, expiry, no relay decryption, failed admission retry")
    }
}
