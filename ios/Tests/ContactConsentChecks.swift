import Foundation

@main struct ContactConsentChecks {
    static func rejects(_ action: () throws -> Void) {
        do { try action(); fatalError("Expected consent rejection") } catch {}
    }
    static func main() throws {
        let alice = String(repeating: "a", count: 64), bob = String(repeating: "b", count: 64), stranger = String(repeating: "c", count: 64)
        let id = "11111111-1111-4111-8111-111111111111"
        let vector = ContactConsent(kind: "R", id: id, expires: 300000, name: "Mary")
        let encoded = try vector.encode()
        precondition(encoded == "LC1|R|\(id)|300000|TWFyeQ==")
        let decoded = try ContactConsent.decode(encoded); precondition(decoded == vector)
        for bad in ["LC1|R|\(id)|0300000|TWFyeQ==", "LC1|R|\(id)|300000|/w==", "LC1|K|\(id)|300000|TWFyeQ==", "LC1|R|\(id)|300000|TWFyeQ", "LC1|R|bad|300000|TWFyeQ==", "LC1|R|\(id)|300000|"] {
            rejects { _ = try ContactConsent.decode(bad) }
        }
        for name in [" Mary", "Mary\n", "\u{202e}Mary", "\u{e0001}Mary", "Mary\u{2028}Test", String(repeating: "a", count: 129)] {
            rejects { _ = try ContactConsent(kind: "R", id: id, expires: 300000, name: name).encode() }
        }
        let a = try ContactConsentBook(own: alice), b = try ContactConsentBook(own: bob)
        let request = try a.begin(peer: bob, name: "Alice", now: 0, id: id)
        let initial = try b.receive(peer: alice, content: request, now: 1); precondition(initial == nil)
        let pending = try b.snapshot(now: 1); precondition(pending[0].phase == .incoming)
        rejects { _ = try b.receive(peer: alice, content: ContactConsent(kind: "K", id: id, expires: 300000), now: 2) }
        let accept = try b.decide(id: id, accept: true, name: "Bob", now: 3)
        rejects { _ = try a.receive(peer: stranger, content: accept, now: 4) }
        rejects { _ = try a.receive(peer: bob, content: ContactConsent(kind: "A", id: id, expires: 299999, name: "Bob"), now: 4) }
        let repeated = try b.receive(peer: alice, content: request, now: 4); precondition(repeated == accept)
        let ack = try a.receive(peer: bob, content: accept, now: 5)!
        let repeatedAck = try a.receive(peer: bob, content: accept, now: 6); precondition(ack == repeatedAck)
        _ = try b.receive(peer: alice, content: ack, now: 7)
        _ = try b.receive(peer: alice, content: ack, now: 8)
        let completedA = try a.snapshot(now: 8), completedB = try b.snapshot(now: 8)
        precondition(completedA[0].phase == .complete && completedB[0].phase == .complete)
        precondition(completedA[0].peerName == "Bob" && completedB[0].peerName == "Alice")
        rejects { _ = try a.receive(peer: bob, content: ContactConsent(kind: "A", id: id, expires: 300000, name: "Changed"), now: 9) }
        rejects { _ = try a.receive(peer: bob, content: accept, now: 300000) }
        let expired = try a.snapshot(now: 300000); precondition(expired.isEmpty)

        let c = try ContactConsentBook(own: alice), d = try ContactConsentBook(own: bob)
        let next = try c.begin(peer: bob, name: "Alice", now: 0, id: id)
        _ = try d.receive(peer: alice, content: next, now: 1)
        let decline = try d.decide(id: id, accept: false, name: "", now: 2)
        let repeatedDecline = try d.receive(peer: alice, content: next, now: 3); precondition(decline == repeatedDecline)
        _ = try c.receive(peer: bob, content: decline, now: 4)
        rejects { _ = try c.receive(peer: bob, content: accept, now: 5) }
        try d.block(peer: alice)
        rejects { _ = try d.receive(peer: alice, content: next, now: 6) }
        rejects { _ = try d.begin(peer: alice, name: "Bob", now: 6) }
        let bounded = try ContactConsentBook(own: bob)
        for i in 1...16 {
            let suffix = String(i, radix: 16), peer = String(repeating: "0", count: 64 - suffix.count) + suffix
            _ = try bounded.receive(peer: peer, content: ContactConsent(kind: "R", id: UUID().uuidString.lowercased(), expires: 300000, name: "Guest"), now: 0)
        }
        rejects { _ = try bounded.receive(peer: alice, content: next, now: 0) }
        let full = try bounded.snapshot(now: 0); precondition(full.count == 16)
        rejects { _ = try c.begin(peer: stranger, name: "Alice", now: Int64.max) }
        print("Contact consent experiment passed: canonical vector, explicit approval, lost replies, identity/deadline binding, decline, block, expiry and bounded inbox")
    }
}
