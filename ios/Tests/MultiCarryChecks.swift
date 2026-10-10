import Foundation

@main struct MultiCarryChecks {
    static func main() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("loka-multi-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        func java(_ mode: String, _ args: [String] = []) throws {
            let p = Process(); p.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
            p.arguments = ["-cp",CommandLine.arguments[2],"JavaInterop",mode,dir.path] + args
            try p.run(); p.waitUntilExit(); precondition(p.terminationStatus == 0)
        }
        let a = LokaCrypto(identity: try ContactIdentity(persistent: false))
        let c = LokaCrypto(identity: try ContactIdentity(persistent: false))
        let d = LokaCrypto(identity: try ContactIdentity(persistent: false))
        try a.identity.publicKey.write(to: dir.appendingPathComponent("swift-public.der"))
        try java("generate")
        let b = ContactCode.fingerprint(try Data(contentsOf: dir.appendingPathComponent("java-public.der")))
        var now = Int64(Date().timeIntervalSince1970 * 1000)
        var disk: [String: [Data]] = [:], writes: [Data] = [], received: [String] = []
        func node(_ key: LokaCrypto) -> LokaMesh {
            let mesh = LokaMesh(crypto: key, trusted: { peer in
                (key.deviceID == a.deviceID && peer == d.deviceID) || (key.deviceID == d.deviceID && peer == a.deviceID)
            }, sendFrame: { writes.append($0) },
                message: { _, text in received.append(text) }, event: { _ in }, clock: { now }, saveCarry: { disk[key.deviceID] = $0 })
            mesh.carryPeer = { $0 }; mesh.carryVersion = { _ in 3 }; return mesh
        }
        let source = node(a); source.setLinks([b])
        let original = try source.send(recipient: d.identity.publicKey, text: "Swift Android Swift chain", automatic: true)
        precondition(original.version == 3 && writes.count == 1)
        try writes.removeFirst().write(to: dir.appendingPathComponent("multi-in.bin"))
        try java("multi-forward", [a.deviceID,c.deviceID])
        let fromB = try Data(contentsOf: dir.appendingPathComponent("multi-out.bin"))
        let authorized = try LokaPacket.decode(fromB); try authorized.verify()
        precondition(authorized.grants.map { $0.target } == [b,c.deviceID])
        precondition(authorized.ciphertext == original.ciphertext)
        let relay = node(c); precondition(relay.receive(fromB, from: b)); precondition(writes.isEmpty)
        let restarted = node(c); try restarted.restoreCarry(disk[c.deviceID]!); restarted.setLinks([d.deviceID])
        precondition(writes.count == 1)
        let arriving = writes.removeFirst()
        let hopCount = try LokaPacket.decode(arriving).hops; precondition(hopCount == 4)
        let dest = node(d); precondition(dest.receive(arriving, from: c.deviceID)); precondition(dest.receive(arriving, from: c.deviceID))
        precondition(received == ["Swift Android Swift chain"])
        // Destination-originated encrypted receipt crosses the reverse native engines.
        dest.setLinks([c.deviceID])
        let ack = try ChatContent(kind: "A", id: original.id).encode()
        _ = try dest.send(recipient: a.identity.publicKey, text: ack, urgent: true, automatic: true, returnVia: [c.deviceID,b])
        let returning = node(c); precondition(returning.receive(writes.removeFirst(), from: d.deviceID))
        returning.setLinks([b]); try writes.removeFirst().write(to: dir.appendingPathComponent("multi-in.bin"))
        try java("multi-forward", [c.deviceID,a.deviceID])
        let receiptFrame = try Data(contentsOf: dir.appendingPathComponent("multi-out.bin")); precondition(source.receive(receiptFrame, from: b))
        precondition(received == ["Swift Android Swift chain",ack])
        // Locked final inbox recovery does not depend on a live old carrier handle.
        let recoveredDestination = node(d)
        precondition(recoveredDestination.receive(arriving))
        precondition(received.last == "Swift Android Swift chain")
        // Tampering must fail signature verification across both grant and original envelope.
        var bad = authorized; bad.grants[1].target = a.deviceID
        do { try bad.verify(); fatalError("Altered delegation accepted") } catch {}
        bad = authorized; bad.returnVia = [c.deviceID]
        do { try bad.verify(); fatalError("Altered hint accepted") } catch {}
        now += 3_600_000; returning.tick(); precondition(disk[c.deviceID]!.isEmpty)

        // A stale direct connection accepts writes but drops all frames. A nonfriend
        // carrier must become eligible without waiting for a disconnect callback.
        for version in [2, 3] {
            var relayFrames: [Data] = [], arrivals: [String] = []
            let stuck = LokaMesh(crypto: a, trusted: { $0 == d.deviceID }, sendFrame: { _ in }, message: { _, _ in }, event: { _ in },
                sendTo: { peer, data, _ in if peer == c.deviceID { relayFrames.append(data) } }, clock: { now }, saveCarry: { _ in })
            stuck.carryPeer = { $0 }; stuck.carryVersion = { _ in version }
            stuck.setLinks([c.deviceID,d.deviceID])
            let packet = try stuck.send(recipient: d.identity.publicKey, text: "stale direct two hops", automatic: true)
            precondition(relayFrames.isEmpty)
            now += 14999; stuck.retry(); precondition(relayFrames.isEmpty)
            now += 1; stuck.retry(); precondition(relayFrames.count == 1)
            let receiver = LokaMesh(crypto: d, trusted: { $0 == a.deviceID }, sendFrame: { _ in }, message: { _, text in arrivals.append(text) }, event: { _ in }, clock: { now })
            let middle = LokaMesh(crypto: c, trusted: { _ in false }, sendFrame: { frame in
                let forwarded = try LokaPacket.decode(frame)
                precondition(forwarded.id == packet.id && forwarded.hops == 5)
                precondition(receiver.receive(frame, from: c.deviceID))
            }, message: { _, _ in fatalError("Carrier decrypted") }, event: { _ in }, clock: { now }, saveCarry: { _ in })
            middle.carryPeer = { $0 }; middle.carryVersion = { _ in version }
            middle.setLinks([d.deviceID]); precondition(middle.receive(relayFrames[0], from: a.deviceID))
            precondition(arrivals == ["stale direct two hops"])
        }
        print("Stale direct route fallback through nonfriend carrier passed for v2 and v3")
        print("Native Swift→Android→Swift→Swift carrier chain, restart, reverse receipt, duplicate, tamper and expiry checks passed")
    }
}
