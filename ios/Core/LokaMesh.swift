import Foundation

/// Serialized by its caller. Matches Android's bounded, foreground packet-v0 flooding.
final class LokaMesh {
    var applicationPeer: (String) -> Bool = { _ in false }
    var applicationContent: (String,String) -> Bool = { _,_ in false }
    var applicationPacket: (LokaPacket) -> Bool = { _ in false }
    private func permittedText(_ id: String, _ text: String) -> Bool { trusted(id) || (applicationPeer(id) && applicationContent(id,text)) }
    var routeLoad: (String) -> Int = { _ in 0 }
    var routePreference: (String) -> Int = { _ in 0 }
    private func orderedLinks() -> [String] {
        links.sorted {
            let a = max(0, routeLoad($0)), b = max(0, routeLoad($1))
            if a != b { return a < b }
            let ar = routePreference($0), br = routePreference($1)
            return ar == br ? $0 < $1 : ar < br
        }
    }
    var observeRoute: ((LokaPacket, String?, Bool) -> Void)?
    var carryPeer: (String) -> String? = { _ in nil }
    var carryVersion: (String) -> Int = { _ in 2 }
    private struct Pending { var packet: LokaPacket; let incoming: String?; var urgent = false }
    private let saveCarry: (([Data]) throws -> Void)?
    private let retryDuplicates: Bool
    private let crypto: LokaCrypto
    private let trusted: (String) -> Bool
    private let sendFrame: (Data) throws -> Void
    private let sendUrgentFrame: ((Data) throws -> Void)?
    private let message: (LokaPacket, String) throws -> Void
    private let event: (String) -> Void
    private let clock: () -> Int64
    private var failedUntil: [String: Int64] = [:]
    private var peerAttempts: [String: Int64] = [:]
    private var attempted: [String: Int64] = [:]
    private var acceptedAttempts: [String: Int] = [:]
    private var sentTargets: [String: Set<String>] = [:]
    private func retryDelay(_ id: String) -> Int64 { 15000 * Int64(1 << min(3, max(0, (acceptedAttempts[id] ?? 0) - 1))) }
    private func retryReady(_ packet: LokaPacket, to peer: String) -> Bool {
        clock() - (attempted[packet.id] ?? 0) >= retryDelay(packet.id) ||
            (packet.version >= 2 && carryPeer(peer).map { !(sentTargets[packet.id] ?? []).contains($0) } == true)
    }
    private var seen: [String: Int64] = [:]
    private var pending: [String: Pending] = [:]
    private var links: Set<String> = []
    private let sendTo: ((String, Data, Bool) throws -> Void)?
    var relayEnabled = true {
        didSet { if !relayEnabled { try? commit(pending.filter { $0.value.packet.source == crypto.deviceID }) } }
    }
    init(crypto: LokaCrypto, trusted: @escaping (String) -> Bool, sendFrame: @escaping (Data) throws -> Void,
         message: @escaping (LokaPacket, String) throws -> Void, event: @escaping (String) -> Void,
         retryDuplicates: Bool = false, sendTo: ((String, Data, Bool) throws -> Void)? = nil, sendUrgentFrame: ((Data) throws -> Void)? = nil, clock: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }, saveCarry: (([Data]) throws -> Void)? = nil) {
        self.saveCarry = saveCarry
        self.sendTo = sendTo
        self.sendUrgentFrame = sendUrgentFrame
        self.retryDuplicates = retryDuplicates
        self.crypto = crypto; self.trusted = trusted; self.sendFrame = sendFrame
        self.message = message; self.event = event; self.clock = clock
    }
    /// Compatibility for single-link protocol tests; production supplies concrete handles.
    func link(_ connected: Bool) { setLinks(connected ? ["direct"] : []) }
    func setLinks(_ ready: Set<String>) {
        tick()
        let bounded = Set(ready.sorted().prefix(16))
        let added = bounded.subtracting(links)
        links = bounded
        for peer in added { failedUntil.removeValue(forKey: peer) }
        selectCarriers()
        for peer in orderedLinks().filter({ added.contains($0) }) {
            for item in pending.values.sorted(by: { $0.packet.createdAt < $1.packet.createdAt }) where item.incoming != peer {
                transmit(item.packet, to: peer)
            }
        }
    }
    func send(recipient: Data, text: String, urgent: Bool = false, carrier: String = "", automatic: Bool = false, returnVia: [String] = [], lifetimeMs: Int64? = nil) throws -> LokaPacket {
        if urgent { guard let content = try ChatContent.decode(text), ["A", "B"].contains(content.kind) else { throw LokaProtocolError.invalid } }
        tick()
        guard permittedText(ContactCode.fingerprint(recipient),text), pending.count < 128, seen.count < 2048 else { throw LokaProtocolError.invalid }
        guard (carrier.isEmpty && !automatic) || pending.count < (urgent ? 128 : 112) else { throw LokaProtocolError.invalid }
        let packet = try crypto.encrypt(recipient: recipient, text: text, now: clock(), carrier: carrier, automatic: automatic, multiCarry: automatic && (!returnVia.isEmpty || carryVersion(ContactCode.fingerprint(recipient)) >= 3), returnVia: returnVia, lifetimeMs: lifetimeMs)
        var next = pending; next[packet.id] = Pending(packet: packet, incoming: nil, urgent: urgent)
        try commit(next); seen[packet.id] = packet.expiresAt
        if packet.version > 0 { event("CARRY \(packet.id.prefix(8)) origin committed") }
        selectCarriers()
        let selected = pending[packet.id]!.packet
        for peer in orderedLinks() { transmit(selected, to: peer) }
        return selected
    }
    @discardableResult func receive(_ frame: Data, from incoming: String? = nil) -> Bool {
        var traceID = "unknown"
        do {
            tick()
            let packet = try LokaPacket.decode(frame)
            if UUID(uuidString: packet.id) != nil { traceID = String(packet.id.prefix(8)) }
            try packet.validate(now: clock()); try packet.verify()
            event("CARRY \(traceID) ingress src=\(packet.source.prefix(8)) dst=\(packet.destination.prefix(8)) hops=\(packet.hops) v=\(packet.version) role=\(packet.destination == crypto.deviceID ? "destination" : "relay") authenticated=\((incoming.flatMap { carryPeer($0) } ?? "unknown").prefix(8))")
            if packet.version == 1 {
                if packet.destination == crypto.deviceID && packet.hops == 6 { event("CARRY \(packet.id.prefix(8)) direct bypass ignored"); return false }
                if packet.destination != crypto.deviceID && packet.carrier != crypto.deviceID { event("CARRY \(traceID) ignored not designated carrier"); return false }
                guard packet.destination == crypto.deviceID ? packet.hops == 5 : packet.hops == 6 else { throw LokaProtocolError.invalid }
            }
            if packet.version == 2 {
                if packet.destination != crypto.deviceID && packet.carrier != crypto.deviceID { event("CARRY \(traceID) ignored not designated carrier"); return false }
                guard packet.destination == crypto.deviceID ? (5...6).contains(packet.hops) : packet.hops == 6 else { throw LokaProtocolError.invalid }
            }
            if packet.version == 3 {
                let index = 6 - Int(packet.hops)
                guard packet.holders().indices.contains(index) else { throw LokaProtocolError.invalid }
                if packet.destination != crypto.deviceID {
                    guard let incoming, carryPeer(incoming) == packet.holders()[index],
                          index + 1 < packet.holders().count, packet.holders()[index + 1] == crypto.deviceID else { throw LokaProtocolError.invalid }
                }
                // A final recipient also accepts its signed locked inbox after the link is gone.
                // Relay admission still requires a verified live incoming identity.
            }
            if seen[packet.id] != nil {
                if retryDuplicates && packet.destination == crypto.deviceID && (trusted(packet.source) || applicationPeer(packet.source)) {
                    let text = try crypto.decrypt(packet)
                    guard permittedText(packet.source,text) else { throw LokaProtocolError.invalid }
                    try message(packet,text)
                }
                return true
            }
            guard seen.count < 2048 else { throw LokaProtocolError.invalid }
            if packet.destination == crypto.deviceID {
                guard trusted(packet.source) || applicationPeer(packet.source) else { throw LokaProtocolError.invalid }
                let text = try crypto.decrypt(packet)
                guard permittedText(packet.source,text) else { throw LokaProtocolError.invalid }
                observeRoute?(packet, incoming, false)
                try message(packet, text)
                seen[packet.id] = packet.expiresAt
                if packet.version > 0 { event("CARRY \(packet.id.prefix(8)) destination saved") }
            } else {
                if relayEnabled && packet.hops > 0, let incoming {
                    guard pending.count < (packet.version > 0 ? 112 : 128) else { throw LokaProtocolError.invalid }
                    var forwarded = packet; forwarded.hops -= 1
                    // Keep ciphertext unchanged except the existing mutable hop budget.
                    var next = pending; next[packet.id] = Pending(packet: forwarded, incoming: incoming)
                    try commit(next); seen[packet.id] = packet.expiresAt
                    if packet.version > 0 { event("CARRY \(packet.id.prefix(8)) carrier committed") }
                    selectCarriers()
                    for peer in orderedLinks() where peer != incoming { transmit(pending[packet.id]!.packet, to: peer) }
                }
            }
            return true
        } catch { event("CARRY \(traceID) rejected validation or admission"); return false }
    }
    func tick() {
        let now = clock()
        failedUntil = failedUntil.filter { $0.value > now }
        peerAttempts = peerAttempts.filter { now - $0.value < 15_000 }
        seen = seen.filter { $0.value > now }
        let keep = pending.filter { $0.value.packet.expiresAt > now }
        if keep.count != pending.count { do { try commit(keep) } catch { pending = keep; event("Carry expiry cleanup will retry on restart") } }
        attempted = attempted.filter { pending[$0.key] != nil }
        acceptedAttempts = acceptedAttempts.filter { pending[$0.key] != nil }
        sentTargets = sentTargets.filter { pending[$0.key] != nil }
    }
    func retry() {
        tick(); selectCarriers(); guard !links.isEmpty else { return }
        let eligible = pending.values.filter { item in orderedLinks().contains { peer in
            peer != item.incoming && canAttempt(item.packet, to: peer) &&
                retryReady(item.packet, to: peer)
        } }
            .sorted {
                let a = attempted[$0.packet.id] ?? 0, b = attempted[$1.packet.id] ?? 0
                if a != b { return a < b }
                if a == 0 && $0.packet.createdAt != $1.packet.createdAt { return $0.packet.createdAt > $1.packet.createdAt }
                return $0.packet.id < $1.packet.id
            }
        // Three receipt slots, with one slot reserved for ordinary traffic when present.
        let receipts = Array(eligible.filter { $0.urgent }.prefix(3))
        let receiptIDs = Set(receipts.map { $0.packet.id })
        let normal = eligible.filter { !$0.urgent }
        // Admit the reserved ordinary slot while the route is idle; receipt
        // transport queues still insert their frames ahead of waiting data.
        let items = (Array(normal.prefix(1)) + receipts + Array(normal.dropFirst()) + eligible.filter { $0.urgent && !receiptIDs.contains($0.packet.id) }).prefix(4)
        for item in items {
            let readyPeers = orderedLinks().filter { $0 != item.incoming && retryReady(item.packet, to: $0) }
            for peer in readyPeers { transmit(item.packet, to: peer) }
        }
    }
    func diagnostic() -> [String] {
        ["own=\(crypto.deviceID.prefix(8)) relay=\(relayEnabled) pending=\(pending.count)"] + pending.values.map {
            let p = $0.packet
            return "id=\(p.id.prefix(8)) src=\(p.source.prefix(8)) dst=\(p.destination.prefix(8)) v=\(p.version) hops=\(p.hops) grant=\(p.holders().map { String($0.prefix(8)) }.joined(separator: ","))"
        }
    }
    func queued() throws -> [Data] { try pending.values.filter { $0.packet.source == crypto.deviceID }.sorted { $0.packet.id < $1.packet.id }.map { try $0.packet.encode() } }
    func restore(_ frame: Data) throws {
        let packet = try LokaPacket.decode(frame); try packet.validate(now: clock()); try packet.verify()
        guard packet.source == crypto.deviceID, (trusted(packet.destination) || applicationPacket(packet)), pending.count < 128, seen.count < 2048 else { throw LokaProtocolError.invalid }
        pending[packet.id] = Pending(packet: packet, incoming: nil); seen[packet.id] = packet.expiresAt
    }
    func discard(_ ids: [String]) {
        do { try commit(pending.filter { !ids.contains($0.key) }); for id in ids { attempted.removeValue(forKey: id) } }
        catch { event("Could not update carry storage") }
    }
    func restoreCarry(_ frames: [Data]) throws {
        guard frames.count <= 128, frames.reduce(0, { $0 + $1.count }) <= 524288 else { throw LokaProtocolError.invalid }
        var next = pending
        for frame in frames {
            let packet = try LokaPacket.decode(frame); try packet.verify()
            guard (1...3).contains(packet.version) else { throw LokaProtocolError.invalid }
            if packet.expiresAt <= clock() { continue }
            try packet.validate(now: clock())
            let index = packet.holders().firstIndex(of: crypto.deviceID) ?? -1
            guard packet.source == crypto.deviceID ? ((trusted(packet.destination) || applicationPacket(packet)) && packet.hops == 6) : (packet.version == 3 ? (index > 0 && packet.hops == 6 - Int32(index)) : (packet.carrier == crypto.deviceID && packet.hops == 5)),
                  next.count < 128, next[packet.id] == nil else { throw LokaProtocolError.invalid }
            next[packet.id] = Pending(packet: packet, incoming: nil)
        }
        pending = next
        for item in next.values where item.packet.version > 0 {
            seen[item.packet.id] = item.packet.expiresAt; event("CARRY \(item.packet.id.prefix(8)) restored")
        }
    }
    private func commit(_ next: [String: Pending]) throws {
        let frames = try next.values.filter { $0.packet.version > 0 }.sorted { $0.packet.id < $1.packet.id }.map { try $0.packet.encode() }
        guard next.count <= 128, frames.reduce(0, { $0 + $1.count }) <= 524288 else { throw LokaProtocolError.invalid }
        let before = try pending.values.filter { $0.packet.version > 0 }.sorted { $0.packet.id < $1.packet.id }.map { try $0.packet.encode() }
        if before != frames { guard let saveCarry else { throw LokaProtocolError.invalid }; try saveCarry(frames) }
        pending = next
    }
    func forget(_ id: String) { try? commit(pending.filter { $0.value.packet.destination != id }) }
    private func selectCarriers() {
        let peers = orderedLinks().filter { (failedUntil[$0] ?? 0) <= clock() }.compactMap { carryPeer($0) }
        for item in Array(pending.values) {
            let p = item.packet
            if p.version == 3 {
                guard p.holders().last == crypto.deviceID, p.grants.count < 3, (!peers.contains(p.destination) || clock() - p.createdAt >= 15_000) else { continue }
                let candidates = peers.filter { carryVersion($0) >= 3 && !p.holders().contains($0) && $0 != p.destination }
                let hints = p.returnVia.dropFirst((p.returnVia.firstIndex(of: crypto.deviceID) ?? -1) + 1)
                guard let target = hints.first(where: { candidates.contains($0) }) ?? candidates.first else { continue }
                do {
                    var updated = item; updated.packet = try crypto.delegate(p, target: target)
                    var next = pending; next[p.id] = updated; try commit(next)
                    attempted.removeValue(forKey: p.id)
                    event("CARRY \(p.id.prefix(8)) next carrier committed depth=\(updated.packet.grants.count)")
                } catch { event("Could not save next carrier; message remains queued") }
                continue
            }
            guard p.version == 2, p.source == crypto.deviceID, p.carrier.isEmpty, (!peers.contains(p.destination) || clock() - p.createdAt >= 15_000),
                  let carrier = peers.first(where: { $0 != crypto.deviceID && $0 != p.destination }) else { continue }
            do {
                var updated = item; updated.packet = try crypto.authorizeCarrier(p, carrier: carrier)
                var next = pending; next[p.id] = updated
                try commit(next); attempted.removeValue(forKey: p.id)
                event("CARRY \(p.id.prefix(8)) automatic relay selected")
            } catch { event("Could not save relay selection; message remains queued") }
        }
    }
    private func canAttempt(_ packet: LokaPacket, to peer: String) -> Bool {
        guard packet.version >= 2 else { return true }
        guard (failedUntil[peer] ?? 0) <= clock(), let identity = carryPeer(peer) else { return false }
        if packet.version == 3 {
            guard carryVersion(identity) >= 3, let index = packet.holders().firstIndex(of: crypto.deviceID) else { return false }
            if identity != packet.destination {
                guard index + 1 < packet.holders().count, packet.holders()[index + 1] == identity else { return false }
            }
        } else if identity != packet.destination && !(packet.source == crypto.deviceID && !packet.carrier.isEmpty && identity == packet.carrier) { return false }
        // Normal packets wait for the transport to drain. Receipts retain a
        // bounded fast lane without filling a congested radio indefinitely.
        let load = max(0, routeLoad(peer))
        return pending[packet.id]?.urgent == true ? load < 16384 : load == 0
    }
    private func transmit(_ packet: LokaPacket, to peer: String) {
        guard canAttempt(packet, to: peer) else { return }
        if packet.version == 2 {
            guard let identity = carryPeer(peer), identity == packet.destination || (packet.source == crypto.deviceID && !packet.carrier.isEmpty && identity == packet.carrier) else { return }
        }
        let target = carryPeer(peer)
        let attemptKey = packet.id + ":" + (target ?? peer)
        if packet.version >= 2, let at = peerAttempts[attemptKey], clock() - at < 15_000 { return }
        if packet.version > 0 { event("CARRY \(packet.id.prefix(8)) write attempted hops=\(packet.hops) peer=\((target ?? "unknown").prefix(8))") }
        attempted[packet.id] = clock()
        do {
            if let sendTo { try sendTo(peer, packet.encode(), pending[packet.id]?.urgent == true); if packet.version >= 2 { acceptedAttempts[packet.id] = min(4, (acceptedAttempts[packet.id] ?? 0) + 1) }; if packet.version >= 2 { peerAttempts[attemptKey] = clock(); if let target { sentTargets[packet.id, default: []].insert(target) } }; observeRoute?(packet, peer, true); return }
            let writer = pending[packet.id]?.urgent == true ? (sendUrgentFrame ?? sendFrame) : sendFrame
            try writer(packet.encode())
            if packet.version >= 2 { acceptedAttempts[packet.id] = min(4, (acceptedAttempts[packet.id] ?? 0) + 1) }
            if packet.version >= 2 { peerAttempts[attemptKey] = clock() }
            if packet.version >= 2, let target { sentTargets[packet.id, default: []].insert(target) }
            observeRoute?(packet, peer, true)
        }
        catch { if packet.version >= 2 { failedUntil[peer] = clock() + 30_000 }; event("Message is waiting for a local connection") }
    }
}
