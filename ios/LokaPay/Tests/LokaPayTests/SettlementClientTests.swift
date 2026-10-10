import CryptoKit
import Foundation
import Testing
@testable import LokaPay

/// One canned HTTP exchange, or a URLError in its place.
struct StubReply: Sendable {
    var status = 200
    var headers: [String: String] = [:]
    var body = Data()
    var failure: URLError?
    /// Virtual seconds the exchange takes. Like a real transport, the stub stops at the
    /// request's `timeoutInterval` and throws `URLError(.timedOut)`.
    var delay: TimeInterval = 0

    func delayed(_ seconds: TimeInterval) -> StubReply {
        var copy = self
        copy.delay = seconds
        return copy
    }
}

/// Answers requests from a queue and records them. No request reaches the network.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var replies: [StubReply]
    private var recorded: [URLRequest] = []
    private var started: [(at: TimeInterval, timeout: TimeInterval)] = []
    private let clock: FakeClock?

    init(_ replies: [StubReply], clock: FakeClock? = nil) {
        self.replies = replies
        self.clock = clock
    }

    var requests: [URLRequest] { lock.withLock { recorded } }
    /// When each request started (virtual time) and the timeout it was given.
    var starts: [(at: TimeInterval, timeout: TimeInterval)] { lock.withLock { started } }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let now = clock?.now ?? 0
        let reply: StubReply? = lock.withLock {
            recorded.append(request)
            started.append((now, request.timeoutInterval))
            return replies.isEmpty ? nil : replies.removeFirst()
        }
        guard let reply else {
            Issue.record("unexpected extra request to \(request.url!)")
            throw URLError(.unknown)
        }
        if reply.delay > 0, let clock {
            clock.advance(min(reply.delay, request.timeoutInterval))
            if reply.delay > request.timeoutInterval { throw URLError(.timedOut) }
        }
        if let failure = reply.failure { throw failure }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1",
                                       headerFields: reply.headers)!
        return (reply.body, response)
    }
}

/// Virtual time: `sleep` records the wait and advances `now` without waiting. `advance` moves
/// time for transport latency without counting as a client sleep.
final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var time: TimeInterval = 0
    private var waits: [TimeInterval] = []

    var sleeps: [TimeInterval] { lock.withLock { waits } }
    var now: TimeInterval { lock.withLock { time } }

    func advance(_ seconds: TimeInterval) { lock.withLock { time += seconds } }

    var clock: SettlementClock {
        SettlementClock(now: { self.lock.withLock { self.time } },
                        sleep: { d in self.lock.withLock { self.time += d; self.waits.append(d) } })
    }
}

/// Serves scripted responses to a real URLSession, so `URLSessionTransport` is tested without a
/// network. Each script has its own URL, so tests running in parallel do not share one.
final class ScriptedURLProtocol: URLProtocol, @unchecked Sendable {
    struct Script: Sendable {
        var status = 200
        var headers: [String: String] = [:]
        var chunks: [Data] = []
        /// Seconds between chunks; 0 sends them all at once.
        var interval: TimeInterval = 0
    }

    private static let registry = NSLock()
    private static var scripts: [String: Script] = [:]
    private let state = NSLock()
    private var stopped = false

    static func register(_ script: Script) -> URL {
        let url = URL(string: "https://transport.test.invalid/\(UUID().uuidString)")!
        registry.withLock { scripts[url.absoluteString] = script }
        return url
    }

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ScriptedURLProtocol.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let script = Self.registry.withLock({ Self.scripts[url.absoluteString] }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        let response = HTTPURLResponse(url: url, statusCode: script.status, httpVersion: "HTTP/1.1",
                                       headerFields: script.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        deliver(script.chunks[...], interval: script.interval)
    }

    private func deliver(_ chunks: ArraySlice<Data>, interval: TimeInterval) {
        if state.withLock({ stopped }) { return }
        guard let chunk = chunks.first else {
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        client?.urlProtocol(self, didLoad: chunk)
        let rest = chunks.dropFirst()
        if interval == 0 {
            deliver(rest, interval: 0)
        } else {
            DispatchQueue.global().asyncAfter(deadline: .now() + interval) { self.deliver(rest, interval: interval) }
        }
    }

    override func stopLoading() { state.withLock { stopped = true } }
}

struct NotDecided: Error {}

/// TEST-ONLY fixtures. Every wire is from protocol/vectors/payment-v1.json, signed by the
/// vector server key (derived from a public label). None of this belongs in the app.
enum APIFixtures {
    static let baseURL = URL(string: "https://api.test.invalid")!

    static func client(_ stub: StubTransport, retry: RetryPolicy = .standard,
                       clock: FakeClock = FakeClock()) -> SettlementClient {
        SettlementClient(deployment: Vectors.deployment, serverPublicKey: Vectors.serverKey, baseURL: baseURL,
                         transport: stub, retryPolicy: retry, clock: clock.clock)
    }

    static func publicKey(_ name: String) -> Data {
        Vectors.hex((Vectors.keys[name] as! [String: Any])["publicKeyHex"])
    }

    static func wire(_ list: String, _ index: Int) -> Data { Vectors.hex(Vectors.list(list)[index]["wireHex"]) }

    static func conf(_ name: String) -> [String: Any] {
        Vectors.list("confs").first { $0["name"] as! String == name }!
    }

    static func note(_ index: Int) -> SignedNote {
        try! SignedNote.validate(wire: wire("notes", index), deployment: Vectors.deployment)
    }

    static var settledSignatureBase58: String {
        (conf("settled")["fields"] as! [String: Any])["txSignatureBase58"] as! String
    }

    static var settledExplorer: String {
        "https://explorer.solana.com/tx/\(settledSignatureBase58)?cluster=devnet"
    }

    static func json(_ object: [String: Any]) -> Data { try! JSONSerialization.data(withJSONObject: object) }

    /// A POST /v1/payers body whose JSON numbers deliberately disagree with the certificate.
    static func payerBody(allowance: Data) -> Data {
        json([
            "allowanceId": "999", "payerKeyHash": String(repeating: "ab", count: 32), "pool": "team",
            "capUnits": "999999999999", "offlineLimitUnits": "999999999999", "bondUnits": "0",
            "expiry": 4_102_444_800, "earmarks": [], "allowance": Base64URL.encode(allowance),
            "openSignature": settledSignatureBase58, "explorer": settledExplorer,
        ])
    }

    static func merchantBody(merchant: Data) -> Data {
        json([
            "merchantKeyHash": String(repeating: "cd", count: 32), "merchant": Base64URL.encode(merchant),
            "registerSignature": settledSignatureBase58, "explorer": settledExplorer,
        ])
    }

    /// An HTTP 200 notes body carrying a vector CONF, with JSON fields that can lie about it.
    static func decisionBody(confName: String, jsonStatus: String = "settled", replayed: Bool = false,
                             error: String? = nil) -> Data {
        let c = conf(confName)
        return json([
            "noteId": (c["fields"] as! [String: Any])["noteIdHex"] as! String,
            "status": jsonStatus, "error": error.map { $0 as Any } ?? NSNull(), "errorCode": 0,
            "conf": Base64URL.encode(Vectors.hex(c["wireHex"])),
            "signature": "1111", "slot": 1, "blockTime": 1, "uploadedAt": 1,
            "explorer": "https://phishing.example/tx/1111", "replayed": replayed,
        ])
    }

    /// An HTTP 202 notes body (API-V1 section 5).
    static func pending(signature: String? = settledSignatureBase58, retryAfter: Int? = 2) -> StubReply {
        var body: [String: Any] = ["noteId": note(0).noteId.hex, "status": "pending",
                                   "signature": signature.map { $0 as Any } ?? NSNull()]
        if let retryAfter { body["retryAfter"] = retryAfter }
        return StubReply(status: 202, body: json(body))
    }

    static func settled(replayed: Bool = false) -> StubReply {
        StubReply(body: decisionBody(confName: "settled", replayed: replayed))
    }

    static func errorReply(_ status: Int, _ name: String, headers: [String: String] = [:]) -> StubReply {
        StubReply(status: status, headers: headers, body: json(["error": name, "message": "m"]))
    }

    static func bodyObject(_ request: URLRequest) -> [String: Any] {
        try! JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
    }

    static func decided(_ outcome: SettlementOutcome) throws -> SettlementDecision {
        guard case .decided(let decision) = outcome else {
            Issue.record("expected a decision, got \(outcome)")
            throw NotDecided()
        }
        return decision
    }
}

@Suite("settlement client: happy paths")
struct SettlementHappyPathTests {
    @Test("POST /v1/payers verifies the allowance and takes every number from it, not the JSON")
    func registerPayer() async throws {
        let stub = StubTransport([StubReply(status: 201, body: APIFixtures.payerBody(allowance: APIFixtures.wire("allowances", 0)))])
        let payerKey = APIFixtures.publicKey("payer")
        let reg = try await APIFixtures.client(stub).registerPayer(publicKey: payerKey)

        #expect(reg.certificate.allowanceId == 1001)
        #expect(reg.certificate.cap == 5_000_000)
        #expect(reg.certificate.offlineLimit == 3_000_000)
        #expect(reg.certificate.bond == 500_000)
        #expect(reg.certificate.payerKeyHash == P256Rules.keyHash(payerKey))
        #expect(reg.allowanceWire == APIFixtures.wire("allowances", 0))
        #expect(reg.created)
        #expect(reg.pool == "team")
        #expect(reg.explorer?.absoluteString == APIFixtures.settledExplorer)

        let request = try #require(stub.requests.first)
        #expect(stub.requests.count == 1)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://api.test.invalid/v1/payers")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.timeoutInterval == 20)
        let body = APIFixtures.bodyObject(request)
        #expect(body.count == 1)
        #expect(body["publicKey"] as? String == Base64URL.encode(payerKey))
    }

    @Test("the repeat payer call (HTTP 200) returns the same allowance, not created")
    func registerPayerRepeat() async throws {
        let stub = StubTransport([StubReply(status: 200, body: APIFixtures.payerBody(allowance: APIFixtures.wire("allowances", 1)))])
        let reg = try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("payer"))
        #expect(!reg.created)
        #expect(reg.certificate.allowanceId == 2002)
        #expect(reg.certificate.earmarks == [Vectors.hex((Vectors.keys["merchantA"] as! [String: Any])["keyHashHex"])])
    }

    @Test("POST /v1/merchants verifies the merchant certificate and sends the name in NFC")
    func registerMerchant() async throws {
        let stub = StubTransport([StubReply(status: 201, body: APIFixtures.merchantBody(merchant: APIFixtures.wire("merchants", 0)))])
        let key = APIFixtures.publicKey("merchantA")
        // "e" + combining acute: the client must send the precomposed form.
        let merchant = try await APIFixtures.client(stub).registerMerchant(publicKey: key, name: "Cafe\u{0301}")
        #expect(merchant.certificate.displayName == "Campus Coffee Cart")
        #expect(merchant.certificate.merchantKeyHash == P256Rules.keyHash(key))
        #expect(merchant.merchantWire == APIFixtures.wire("merchants", 0))
        #expect(merchant.created)
        #expect(merchant.explorer != nil)

        let request = try #require(stub.requests.first)
        #expect(request.url?.absoluteString == "https://api.test.invalid/v1/merchants")
        let body = APIFixtures.bodyObject(request)
        #expect(body["publicKey"] as? String == Base64URL.encode(key))
        #expect(Array((body["name"] as! String).utf8) == Array("Caf\u{00e9}".utf8))
    }

    @Test("POST /v1/notes sends note and ack, and returns the verified settled CONF")
    func settle() async throws {
        let stub = StubTransport([APIFixtures.settled()])
        let note = APIFixtures.note(0)
        let ack = try Ack.verify(wire: APIFixtures.wire("acks", 0), for: note)
        let decision = try APIFixtures.decided(try await APIFixtures.client(stub).settle(note: note, ack: ack))

        #expect(decision.status == .settled)
        #expect(decision.confirmation.noteId == note.noteId)
        #expect(decision.confirmation.slot == 412_345_678)
        #expect(decision.confirmationWire == Vectors.hex(APIFixtures.conf("settled")["wireHex"]))
        #expect(!decision.replayed)
        // The link comes from the signed transaction signature, not the JSON `explorer`.
        #expect(decision.explorer?.absoluteString == APIFixtures.settledExplorer)

        let request = try #require(stub.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://api.test.invalid/v1/notes")
        #expect(request.timeoutInterval == 20)
        let body = APIFixtures.bodyObject(request)
        #expect(body["note"] as? String == Base64URL.encode(note.wire))
        #expect(body["ack"] as? String == Base64URL.encode(ack.wire))
    }

    @Test("a note uploaded without an ack leaves the ack key out")
    func settleWithoutAck() async throws {
        let stub = StubTransport([APIFixtures.settled()])
        _ = try await APIFixtures.client(stub).settle(note: APIFixtures.note(0))
        let body = APIFixtures.bodyObject(try #require(stub.requests.first))
        #expect(Array(body.keys) == ["note"])
    }

    @Test("GET /v1/notes/{noteId} returns the verified decision")
    func fetchDecision() async throws {
        let stub = StubTransport([APIFixtures.settled()])
        let note = APIFixtures.note(0)
        let decision = try APIFixtures.decided(try await APIFixtures.client(stub).outcome(noteId: note.noteId))
        #expect(decision.status == .settled)
        let request = try #require(stub.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://api.test.invalid/v1/notes/\(note.noteId.hex)")
        #expect(request.httpBody == nil)
    }

    @Test("a later upload that adds an ack gets the same replayed decision and CONF")
    func replayedWithAddedAck() async throws {
        let stub = StubTransport([APIFixtures.settled(), APIFixtures.settled(replayed: true)])
        let client = APIFixtures.client(stub)
        let note = APIFixtures.note(0)
        let first = try APIFixtures.decided(try await client.settle(note: note))
        let ack = try Ack.verify(wire: APIFixtures.wire("acks", 0), for: note)
        let again = try APIFixtures.decided(try await client.settle(note: note, ack: ack))
        #expect(!first.replayed)
        #expect(again.replayed)
        #expect(again.confirmation == first.confirmation)
        #expect(again.confirmationWire == first.confirmationWire)
        #expect(APIFixtures.bodyObject(stub.requests[1])["ack"] as? String == Base64URL.encode(ack.wire))
    }
}

@Suite("settlement client: trusts signed bytes only")
struct SettlementTrustTests {
    @Test("status comes from the verified CONF byte, never the JSON string")
    func statusFromConfByte() async throws {
        // Qualified: Swift Testing also declares a `Confirmation` type.
        let cases: [(conf: String, lie: String, status: LokaPay.Confirmation.Status, code: UInt16)] = [
            ("settled", "failed", .settled, 0),
            ("failed_on_chain_serial_used", "settled", .failedOnChain, 6001),
        ]
        for c in cases {
            let stub = StubTransport([StubReply(body: APIFixtures.decisionBody(confName: c.conf, jsonStatus: c.lie,
                                                                               error: "shown_only"))])
            let decision = try APIFixtures.decided(try await APIFixtures.client(stub).settle(note: APIFixtures.note(0)))
            #expect(decision.status == c.status, "\(c.conf)")
            #expect(decision.confirmation.errorCode == c.code, "\(c.conf)")
            #expect(decision.explorer != nil, "\(c.conf)")
            #expect(decision.reason == "shown_only")
        }
    }

    @Test("a signed status-3 CONF in a 200 is a protocol violation, from either route")
    func refusedConfIsViolation() async throws {
        let body = APIFixtures.decisionBody(confName: "refused_off_chain", jsonStatus: "settled")
        let stub = StubTransport([StubReply(body: body), StubReply(body: body)])
        let client = APIFixtures.client(stub)
        let reads: [() async throws -> SettlementOutcome] = [
            { try await client.settle(note: APIFixtures.note(0)) },
            { try await client.outcome(noteId: APIFixtures.note(0).noteId) },
        ]
        for read in reads {
            do {
                _ = try await read()
                Issue.record("a status-3 CONF was accepted")
            } catch let SettlementError.protocolViolation(reason) {
                #expect(reason.contains("status 3"))
            }
        }
    }

    @Test("a genuinely signed CONF for a different note is rejected")
    func confForAnotherNote() async throws {
        // Vector CONFs are all for note 0; note 1 is a different, valid note.
        let other = APIFixtures.note(1)
        let stub = StubTransport([APIFixtures.settled(), APIFixtures.settled()])
        let client = APIFixtures.client(stub)
        await #expect(throws: SettlementError.confirmationMismatch) { try await client.settle(note: other) }
        await #expect(throws: SettlementError.confirmationMismatch) { try await client.outcome(noteId: other.noteId) }
    }

    @Test("a CONF with one byte changed fails the server signature")
    func tamperedConf() async throws {
        var conf = Vectors.hex(APIFixtures.conf("settled")["wireHex"])
        conf[136] = 2  // status byte
        let body = APIFixtures.json(["conf": Base64URL.encode(conf), "status": "settled", "replayed": false])
        let stub = StubTransport([StubReply(body: body)])
        await #expect(throws: SettlementError.verification(.badSignature)) {
            try await APIFixtures.client(stub).settle(note: APIFixtures.note(0))
        }
    }

    @Test("an allowance signed by a key other than the pinned server key is rejected")
    func allowanceWrongSigner() async throws {
        let v = Vectors.list("allowances")[0]
        let body = Vectors.hex(v["allowHex"])
        let list = Vectors.hex((v["fields"] as! [String: Any])["earmarkListHex"])
        let impostor = Curve25519.Signing.PrivateKey()
        let forged = body + (try impostor.signature(for: body)) + list
        let stub = StubTransport([StubReply(status: 201, body: APIFixtures.payerBody(allowance: forged))])
        await #expect(throws: SettlementError.verification(.badSignature)) {
            try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("payer"))
        }
    }

    @Test("a genuine allowance for a different payer key is rejected")
    func allowanceForAnotherPayer() async throws {
        let stub = StubTransport([StubReply(status: 201, body: APIFixtures.payerBody(allowance: APIFixtures.wire("allowances", 0)))])
        await #expect(throws: SettlementError.payerMismatch) {
            try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("merchantA"))
        }
    }

    @Test("a genuine merchant certificate for a different key is rejected")
    func merchantForAnotherKey() async throws {
        let stub = StubTransport([StubReply(status: 201, body: APIFixtures.merchantBody(merchant: APIFixtures.wire("merchants", 0)))])
        await #expect(throws: SettlementError.merchantMismatch) {
            try await APIFixtures.client(stub).registerMerchant(publicKey: APIFixtures.publicKey("merchantB"), name: "B")
        }
    }

    @Test("a 2xx body without its signed wire, or with padded base64url, is an invalid response")
    func malformedSuccessBodies() async throws {
        let conf = Base64URL.encode(Vectors.hex(APIFixtures.conf("settled")["wireHex"]))
        for body in [APIFixtures.json(["status": "settled"]), APIFixtures.json(["conf": conf + "="]), Data("<html>".utf8)] {
            let stub = StubTransport([StubReply(body: body)])
            do {
                _ = try await APIFixtures.client(stub).settle(note: APIFixtures.note(0))
                Issue.record("accepted \(String(decoding: body, as: UTF8.self))")
            } catch let SettlementError.invalidResponse(reason) {
                #expect(!reason.isEmpty)
            }
        }
    }

    @Test("a display field the server got wrong never discards a verified certificate")
    func badDisplayFieldKeepsCertificate() async throws {
        let allowance = Base64URL.encode(APIFixtures.wire("allowances", 0))
        let body = APIFixtures.json(["allowance": allowance, "openSignature": "not base58 0OIl"])
        let stub = StubTransport([StubReply(status: 201, body: body)])
        let reg = try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("payer"))
        #expect(reg.certificate.allowanceId == 1001)
        #expect(reg.openSignature == nil)
        #expect(reg.explorer == nil)
        #expect(reg.pool == nil)
    }

    @Test("display fields of the wrong type never discard a verified CONF or a pending body")
    func wrongTypedDisplayFields() async throws {
        let conf = Base64URL.encode(Vectors.hex(APIFixtures.conf("settled")["wireHex"]))
        // u64 fields sent as strings, a stringy flag, a numeric error, a fractional retryAfter.
        let decided = APIFixtures.json(["conf": conf, "slot": "412345678", "errorCode": "0", "blockTime": "x",
                                        "replayed": "yes", "error": 5, "status": 1])
        let pending = APIFixtures.json(["noteId": 7, "status": "pending", "signature": 9, "retryAfter": 2.5])
        let stub = StubTransport([StubReply(body: decided), StubReply(status: 202, body: pending)])
        let client = APIFixtures.client(stub)
        let decision = try APIFixtures.decided(try await client.settle(note: APIFixtures.note(0)))
        #expect(decision.status == .settled)
        #expect(decision.confirmation.slot == 412_345_678)
        #expect(!decision.replayed)
        #expect(decision.reason == nil)
        guard case .pending(let p) = try await client.outcome(noteId: APIFixtures.note(0).noteId) else {
            Issue.record("expected pending")
            return
        }
        #expect(p.signature == nil)
        #expect(p.retryAfter == nil)
    }
}

@Suite("settlement client: refusals and pending")
struct SettlementPendingTests {
    @Test("a 422 names the failed check and is not remembered: the intact note settles after it")
    func refusalThenIntact() async throws {
        let intact = APIFixtures.note(0)
        let broken = SignedNote(note: intact.note, noteBytes: intact.noteBytes,
                                signature: Data(repeating: 1, count: 64), payerPublicKey: intact.payerPublicKey)
        #expect(broken.noteId == intact.noteId)
        let stub = StubTransport([APIFixtures.errorReply(422, "bad_signature"), APIFixtures.settled()])
        let client = APIFixtures.client(stub)
        do {
            _ = try await client.settle(note: broken)
            Issue.record("a refused note was accepted")
        } catch let SettlementError.refused(check, _) {
            #expect(check == "bad_signature")
            #expect(PaymentError(rawValue: check) == .badSignature)
        }
        let decision = try APIFixtures.decided(try await client.settle(note: intact))
        #expect(decision.status == .settled)
        #expect(stub.requests.count == 2, "a 422 is never retried automatically")
    }

    @Test("a bad ack is a 422 refusal named bad_ack")
    func badAck() async throws {
        let stub = StubTransport([APIFixtures.errorReply(422, "bad_ack")])
        await #expect(throws: SettlementError.refused(check: "bad_ack", message: "m")) {
            try await APIFixtures.client(stub).settle(note: APIFixtures.note(0))
        }
    }

    @Test("identity refusals are 422s named by the check, never a protocol violation",
          arguments: ["unknown_allowance", "unknown_merchant", "payer_mismatch"])
    func identityRefusals(check: String) async throws {
        let stub = StubTransport([APIFixtures.errorReply(422, check)])
        await #expect(throws: SettlementError.refused(check: check, message: "m")) {
            try await APIFixtures.client(stub).settle(note: APIFixtures.note(0))
        }
        #expect(stub.requests.count == 1, "a 422 is never retried automatically")
    }

    @Test("HTTP 202 on upload or read is a pending result with the in-flight signature")
    func pendingResult() async throws {
        let stub = StubTransport([APIFixtures.pending(), APIFixtures.pending(signature: nil, retryAfter: nil),
                                  APIFixtures.pending(signature: "0OIl not base58")])
        let client = APIFixtures.client(stub)
        let note = APIFixtures.note(0)
        guard case .pending(let first) = try await client.settle(note: note) else {
            Issue.record("expected pending")
            return
        }
        #expect(first.noteId == note.noteId)
        #expect(first.signature == APIFixtures.settledSignatureBase58)
        #expect(first.explorer?.absoluteString == APIFixtures.settledExplorer)
        #expect(first.retryAfter == 2)
        guard case .pending(let second) = try await client.outcome(noteId: note.noteId) else {
            Issue.record("expected pending")
            return
        }
        #expect(second.signature == nil)
        #expect(second.explorer == nil)
        #expect(second.retryAfter == nil)
        guard case .pending(let third) = try await client.outcome(noteId: note.noteId) else {
            Issue.record("expected pending")
            return
        }
        #expect(third.signature == nil, "a malformed signature never becomes a link")
    }

    @Test("polling honours retryAfter and never waits more than 10 s between polls")
    func pollHonoursRetryAfter() async throws {
        let stub = StubTransport([APIFixtures.pending(retryAfter: 2), APIFixtures.pending(retryAfter: 2),
                                  APIFixtures.pending(retryAfter: 30), APIFixtures.settled()])
        let clock = FakeClock()
        let note = APIFixtures.note(0)
        let decision = try await APIFixtures.client(stub, clock: clock).waitForDecision(noteId: note.noteId, timeout: 60)
        #expect(decision.status == .settled)
        #expect(clock.sleeps == [2, 2, 10])
        #expect(stub.requests.count == 4)
        #expect(stub.requests.allSatisfy { $0.httpMethod == "GET" })
    }

    @Test("polling backs off 1, 2, 4, 8 and then holds at 10 s")
    func pollBacksOff() async throws {
        let stub = StubTransport(Array(repeating: APIFixtures.pending(retryAfter: nil), count: 6) + [APIFixtures.settled()])
        let clock = FakeClock()
        _ = try await APIFixtures.client(stub, clock: clock).waitForDecision(noteId: APIFixtures.note(0).noteId, timeout: 120)
        #expect(clock.sleeps == [1, 2, 4, 8, 10, 10])
    }

    @Test("polling stops when no further poll fits in the timeout, with the last pending body")
    func pollTimesOut() async throws {
        let stub = StubTransport(Array(repeating: APIFixtures.pending(retryAfter: 2), count: 3))
        let clock = FakeClock()
        let note = APIFixtures.note(0)
        do {
            _ = try await APIFixtures.client(stub, clock: clock).waitForDecision(noteId: note.noteId, timeout: 5)
            Issue.record("expected stillPending")
        } catch let SettlementError.stillPending(last) {
            #expect(last.noteId == note.noteId)
            #expect(last.signature == APIFixtures.settledSignatureBase58)
        }
        // Polls at 0, 2 and 4; a fourth would need 2 s of wait plus 1 s of budget after 4.
        #expect(clock.sleeps == [2, 2])
        #expect(clock.now <= 5)
        #expect(stub.requests.count == 3)
    }

    @Test("settleAndWait uploads once, then polls the in-flight note to its decision")
    func settleAndWait() async throws {
        let stub = StubTransport([APIFixtures.pending(retryAfter: 1), APIFixtures.settled()])
        let clock = FakeClock()
        let decision = try await APIFixtures.client(stub, clock: clock).settleAndWait(note: APIFixtures.note(0), timeout: 30)
        #expect(decision.status == .settled)
        #expect(stub.requests.map(\.httpMethod) == ["POST", "GET"])
        #expect(clock.sleeps == [1])
    }
}

@Suite("settlement client: one time budget")
struct SettlementBudgetTests {
    /// Every request started before the deadline and was given no more time than was left.
    func expectInsideBudget(_ stub: StubTransport, deadline: TimeInterval) {
        for start in stub.starts {
            #expect(start.at < deadline, "a request started at \(start.at), deadline \(deadline)")
            #expect(start.at + start.timeout <= deadline, "a request could run to \(start.at + start.timeout)")
            #expect(start.timeout <= SettlementClient.requestTimeout)
        }
    }

    @Test("settleAndWait spends one budget across the upload, the polls and their timeouts")
    func oneBudgetAcrossUploadAndPolls() async throws {
        let clock = FakeClock()
        // The upload takes 12 s and answers pending; the poll at 14 s would take 25 s.
        let stub = StubTransport([APIFixtures.pending(retryAfter: 2).delayed(12), APIFixtures.settled().delayed(25)],
                                 clock: clock)
        do {
            _ = try await APIFixtures.client(stub, clock: clock).settleAndWait(note: APIFixtures.note(0), timeout: 30)
            Issue.record("expected stillPending")
        } catch let SettlementError.stillPending(last) {
            #expect(last.signature == APIFixtures.settledSignatureBase58, "the last pending body is reported")
        }
        #expect(clock.now <= 30, "the call ran \(clock.now) s on a 30 s budget")
        #expect(stub.starts.map(\.timeout) == [20, 16])
        #expect(stub.requests.count == 2)
        expectInsideBudget(stub, deadline: 30)
    }

    @Test("a budget that runs out during the upload ends in stillPending without a signature")
    func budgetEndsDuringUpload() async throws {
        let clock = FakeClock()
        let stub = StubTransport([APIFixtures.settled().delayed(25)], clock: clock)
        let note = APIFixtures.note(0)
        await #expect(throws: SettlementError.stillPending(SettlementClient.unknownPending(note.noteId))) {
            try await APIFixtures.client(stub, clock: clock).settleAndWait(note: note, timeout: 10)
        }
        #expect(clock.now == 10)
        #expect(stub.starts.map(\.timeout) == [10])
    }

    @Test("a retry that cannot fit in the budget is not attempted; the failure is returned")
    func retryOutsideBudget() async throws {
        let clock = FakeClock()
        let stub = StubTransport([APIFixtures.errorReply(503, "chain_unavailable").delayed(4)], clock: clock)
        await #expect(throws: SettlementError.chainUnavailable(message: "m")) {
            try await APIFixtures.client(stub, clock: clock).settleAndWait(note: APIFixtures.note(0), timeout: 5)
        }
        #expect(stub.requests.count == 1)
        #expect(clock.now <= 5)
    }

    @Test("a retry inside the budget gets only the time that is left")
    func retryInsideBudget() async throws {
        let clock = FakeClock()
        let stub = StubTransport([StubReply(failure: URLError(.networkConnectionLost)).delayed(3),
                                  APIFixtures.settled().delayed(2)], clock: clock)
        let decision = try await APIFixtures.client(stub, clock: clock).settleAndWait(note: APIFixtures.note(0), timeout: 10)
        #expect(decision.status == .settled)
        // Upload fails at 3 s, waits 1 s, retries at 4 s with 6 s left.
        #expect(stub.starts.map(\.at) == [0, 4])
        #expect(stub.starts.map(\.timeout) == [10, 6])
        expectInsideBudget(stub, deadline: 10)
    }

    @Test("no request is started with no budget left")
    func noBudgetNoRequest() async throws {
        let stub = StubTransport([])
        let note = APIFixtures.note(0)
        await #expect(throws: SettlementError.stillPending(SettlementClient.unknownPending(note.noteId))) {
            try await APIFixtures.client(stub).waitForDecision(noteId: note.noteId, timeout: 0)
        }
        #expect(stub.requests.isEmpty)
    }
}

@Suite("URLSessionTransport: size cap and total timeout")
struct URLSessionTransportTests {
    func send(_ script: ScriptedURLProtocol.Script, timeout: TimeInterval = 20) async throws -> (Data, HTTPURLResponse) {
        let transport = URLSessionTransport(session: ScriptedURLProtocol.session())
        let request = URLRequest(url: ScriptedURLProtocol.register(script), timeoutInterval: timeout)
        return try await transport.send(request)
    }

    static let tooLarge = SettlementError.invalidResponse("response too large")
    static let kib = Data(repeating: 0x41, count: 1024)

    @Test("a normal body comes through whole")
    func smallBody() async throws {
        let (data, response) = try await send(.init(status: 200, headers: ["Content-Length": "5"],
                                                    chunks: [Data("hel".utf8), Data("lo".utf8)]))
        #expect(data == Data("hello".utf8))
        #expect(response.statusCode == 200)
    }

    @Test("a body over 64 KiB with no Content-Length is cut off")
    func noContentLength() async throws {
        await #expect(throws: Self.tooLarge) { try await send(.init(chunks: Array(repeating: Self.kib, count: 100))) }
    }

    @Test("a body over 64 KiB is cut off even when Content-Length claims it is small")
    func lyingContentLength() async throws {
        await #expect(throws: Self.tooLarge) {
            try await send(.init(headers: ["Content-Length": "10"], chunks: Array(repeating: Self.kib, count: 100)))
        }
    }

    @Test("a declared Content-Length over 64 KiB fails before the body is read")
    func declaredTooLarge() async throws {
        await #expect(throws: Self.tooLarge) {
            try await send(.init(headers: ["Content-Length": "1048576"], chunks: [Data("tiny".utf8)]))
        }
    }

    @Test("exactly 64 KiB is accepted")
    func atTheCap() async throws {
        let (data, _) = try await send(.init(chunks: Array(repeating: Self.kib, count: 64)))
        #expect(data.count == URLSessionTransport.defaultMaxResponseBytes)
    }

    @Test("timeoutInterval limits the whole exchange, even when bytes keep arriving")
    func totalTimeout() async throws {
        // One byte every 0.1 s for 3 s: URLSession's own timer restarts on every byte.
        let script = ScriptedURLProtocol.Script(chunks: Array(repeating: Data([0x41]), count: 30), interval: 0.1)
        let started = Date()
        await #expect(throws: URLError(.timedOut)) { try await send(script, timeout: 0.5) }
        let elapsed = Date().timeIntervalSince(started)
        #expect(elapsed < 2.5, "took \(elapsed) s on a 0.5 s timeout")
    }

    @Test("the default session bounds each exchange at 60 s and each body at 64 KiB")
    func defaults() {
        let transport = URLSessionTransport()
        #expect(transport.session.configuration.timeoutIntervalForResource == 60)
        #expect(transport.session.configuration.timeoutIntervalForRequest == 20)
        #expect(transport.maxResponseBytes == 64 * 1024)
    }
}

@Suite("settlement client: errors and retries")
struct SettlementErrorTests {
    @Test("API error bodies map to named cases")
    func errorMapping() async throws {
        let cases: [(StubReply, SettlementError)] = [
            (APIFixtures.errorReply(400, "bad_json"), .badJSON(message: "m")),
            (APIFixtures.errorReply(400, "bad_base64url"), .badBase64url(message: "m")),
            (APIFixtures.errorReply(400, "bad_pubkey"), .badPubkey(message: "m")),
            (APIFixtures.errorReply(400, "name_length"), .nameLength(message: "m")),
            (APIFixtures.errorReply(404, "unknown_note"), .unknownNote(message: "m")),
            (APIFixtures.errorReply(422, "bad_pubkey"), .refused(check: "bad_pubkey", message: "m")),
            (APIFixtures.errorReply(422, "high_s"), .refused(check: "high_s", message: "m")),
            (APIFixtures.errorReply(422, "bad_ack"), .refused(check: "bad_ack", message: "m")),
            (APIFixtures.errorReply(429, "rate_limited", headers: ["Retry-After": "30"]), .rateLimited(retryAfter: 30, message: "m")),
            (APIFixtures.errorReply(429, "budget_exhausted"), .budgetExhausted(message: "m")),
            (APIFixtures.errorReply(503, "chain_unavailable"), .chainUnavailable(message: "m")),
            (APIFixtures.errorReply(500, "something_new"), .http(status: 500, error: "something_new", message: "m")),
            (StubReply(status: 502, body: Data("<html>Bad Gateway</html>".utf8)), .http(status: 502, error: nil, message: nil)),
            (StubReply(failure: URLError(.notConnectedToInternet)), .network(.notConnectedToInternet)),
        ]
        for (reply, expected) in cases {
            let client = APIFixtures.client(StubTransport([reply]), retry: .never)
            await #expect(throws: expected) { try await client.outcome(noteId: APIFixtures.note(0).noteId) }
        }
    }

    @Test("a known error name on the wrong HTTP status is a protocol violation")
    func statusAndNameMustAgree() async throws {
        let cases: [(Int, String)] = [
            (429, "chain_unavailable"), (503, "rate_limited"), (400, "unknown_note"), (404, "bad_json"),
            (500, "budget_exhausted"), (422, "chain_unavailable"), (422, "name_length"),
        ]
        for (status, name) in cases {
            let client = APIFixtures.client(StubTransport([APIFixtures.errorReply(status, name)]), retry: .never)
            await #expect(throws: SettlementError.protocolViolation("HTTP \(status) with error \(name)")) {
                try await client.outcome(noteId: APIFixtures.note(0).noteId)
            }
        }
    }

    @Test("Retry-After is read as whole seconds")
    func retryAfterParsing() {
        func response(_ value: String?) -> HTTPURLResponse {
            HTTPURLResponse(url: APIFixtures.baseURL, statusCode: 429, httpVersion: nil,
                            headerFields: value.map { ["Retry-After": $0] } ?? [:])!
        }
        #expect(SettlementClient.retryAfter(response("30")) == 30)
        #expect(SettlementClient.retryAfter(response(" 5 ")) == 5)
        #expect(SettlementClient.retryAfter(response("0")) == 0)
        #expect(SettlementClient.retryAfter(response(nil)) == nil)
        #expect(SettlementClient.retryAfter(response("-1")) == nil)
        #expect(SettlementClient.retryAfter(response("Wed, 21 Oct 2026 07:28:00 GMT")) == nil)
    }

    @Test("a note upload retries chain_unavailable and a dropped connection with the same bytes")
    func retriesSameBytes() async throws {
        let stub = StubTransport([
            APIFixtures.errorReply(503, "chain_unavailable"),
            StubReply(failure: URLError(.networkConnectionLost)),
            APIFixtures.settled(replayed: true),
        ])
        let clock = FakeClock()
        let decision = try APIFixtures.decided(try await APIFixtures.client(stub, clock: clock).settle(note: APIFixtures.note(0)))
        #expect(decision.status == .settled)
        #expect(stub.requests.count == 3)
        #expect(Set(stub.requests.map { $0.httpBody! }).count == 1, "every attempt must send the same note bytes")
        #expect(clock.sleeps == [1, 2])
    }

    @Test("retries stop at the policy's attempt count and surface the last error")
    func retriesExhausted() async throws {
        let stub = StubTransport(Array(repeating: APIFixtures.errorReply(503, "chain_unavailable"), count: 3))
        await #expect(throws: SettlementError.chainUnavailable(message: "m")) {
            try await APIFixtures.client(stub).settle(note: APIFixtures.note(0))
        }
        #expect(stub.requests.count == 3)
    }

    @Test("other failures are not retried, and registration is never retried")
    func noRetry() async throws {
        let singles: [StubReply] = [
            APIFixtures.errorReply(422, "bad_signature"),
            APIFixtures.errorReply(429, "rate_limited", headers: ["Retry-After": "2"]),
            APIFixtures.errorReply(429, "budget_exhausted"),
            APIFixtures.errorReply(400, "bad_json"),
            StubReply(status: 502, body: Data()),
            StubReply(failure: URLError(.cancelled)),
            // A retryable name on the wrong status is not trusted, so not retried.
            APIFixtures.errorReply(429, "chain_unavailable", headers: ["Retry-After": "1"]),
            APIFixtures.errorReply(500, "chain_unavailable"),
        ]
        for reply in singles {
            let stub = StubTransport([reply])
            _ = try? await APIFixtures.client(stub).settle(note: APIFixtures.note(0))
            #expect(stub.requests.count == 1)
        }
        let stub = StubTransport([APIFixtures.errorReply(503, "chain_unavailable")])
        await #expect(throws: SettlementError.chainUnavailable(message: "m")) {
            try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("payer"))
        }
        #expect(stub.requests.count == 1)
    }
}

@Suite("base58 for explorer links")
struct Base58Tests {
    @Test("transaction signatures, program id and mint match the vectors")
    func vectors() {
        for c in Vectors.list("confs") {
            let f = c["fields"] as! [String: Any]
            let raw = Vectors.hex(f["txSignatureHex"])
            #expect(Base58.encode(raw) == f["txSignatureBase58"] as! String)
            #expect(Base58.decode(f["txSignatureBase58"] as! String, maxBytes: 64) == raw)
        }
        let k = Vectors.constants
        #expect(Base58.encode(Vectors.hex(k["programIdHex"])) == k["programIdBase58"] as! String)
        #expect(Base58.encode(Vectors.hex(k["mintHex"])) == k["mintBase58"] as! String)
        #expect(Base58.decode("0OIl", maxBytes: 64) == nil)
    }

    @Test("the largest 64-byte value takes exactly 88 characters and still decodes")
    func longestSignature() throws {
        #expect(Base58.maxLength(bytes: 64) == 88)
        #expect(Base58.maxLength(bytes: 32) == 44)
        let max = Data(repeating: 0xff, count: 64)
        let text = Base58.encode(max)
        #expect(text.utf8.count == 88)
        #expect(Base58.decode(text, maxBytes: 64) == max)
        let zeros = Data(repeating: 0, count: 64)
        #expect(Base58.decode(Base58.encode(zeros), maxBytes: 64) == zeros)
    }

    @Test("decoding is bounded: over-long text and over-size values are refused")
    func boundedDecode() {
        // 88 characters (within the length cap) whose value needs 65 bytes: the conversion bound.
        #expect(Base58.decode(String(repeating: "z", count: 88), maxBytes: 64) == nil)
        // 89 characters, and a large alphabet-valid string a hostile 202 body could carry.
        #expect(Base58.decode(String(repeating: "2", count: 89), maxBytes: 64) == nil)
        #expect(Base58.decode(String(repeating: "1", count: 89), maxBytes: 64) == nil)
        let huge = String(repeating: "z", count: 60_000)
        let started = Date()
        #expect(Base58.decode(huge, maxBytes: 64) == nil)
        #expect(SettlementClient.explorerURL(signature: huge, clusterId: 0) == nil)
        #expect(Date().timeIntervalSince(started) < 1)
    }

    @Test("an over-long signature in a 202 body is dropped, not decoded")
    func hostilePendingSignature() async throws {
        let body = APIFixtures.json(["status": "pending", "signature": String(repeating: "z", count: 60_000), "retryAfter": 1])
        let stub = StubTransport([StubReply(status: 202, body: body)])
        guard case .pending(let p) = try await APIFixtures.client(stub).outcome(noteId: APIFixtures.note(0).noteId) else {
            Issue.record("expected pending")
            return
        }
        #expect(p.signature == nil)
        #expect(p.explorer == nil)
    }

    @Test("explorer links are built only from a canonical 64-byte signature")
    func explorerLinks() {
        let sig = APIFixtures.settledSignatureBase58
        #expect(SettlementClient.explorerURL(signature: sig, clusterId: 0)?.absoluteString == APIFixtures.settledExplorer)
        #expect(SettlementClient.explorerURL(signature: "1111", clusterId: 0) == nil)
        #expect(SettlementClient.explorerURL(signature: sig + "?x=https://phishing.example", clusterId: 0) == nil)
    }
}

extension APIFixtures {
    static func keyHashHex(_ name: String) -> String { P256Rules.keyHash(publicKey(name)).hex }

    /// An HTTP 202 registration body (API-V1 sections 2 and 3). A nil kind or keyHash leaves it out.
    static func registrationPending(kind: String? = "payer", keyHash: String? = keyHashHex("payer"),
                                    signature: String? = settledSignatureBase58, retryAfter: Int? = 2) -> StubReply {
        var body: [String: Any] = ["status": "pending", "signature": signature.map { $0 as Any } ?? NSNull()]
        if let kind { body["kind"] = kind }
        if let keyHash { body["keyHash"] = keyHash }
        if let retryAfter { body["retryAfter"] = retryAfter }
        return StubReply(status: 202, body: json(body))
    }

    /// An error body that also carries a signature and a URL the client must not use.
    static func registrationFailed(status: Int = 409, name: String = "registration_failed",
                                   signature: Any? = settledSignatureBase58) -> StubReply {
        var body: [String: Any] = ["error": name, "message": "m", "explorer": "https://phishing.example/tx/1111"]
        if let signature { body["signature"] = signature }
        return StubReply(status: status, body: json(body))
    }

    /// What the client should report for a registrationPending body with these fields.
    static func pendingRegistration(_ kind: RegistrationKind, key: String, signature: String? = settledSignatureBase58,
                                    retryAfter: Int? = 2) -> PendingRegistration {
        PendingRegistration(kind: kind, keyHash: P256Rules.keyHash(publicKey(key)), signature: signature,
                            explorer: signature.map { _ in URL(string: settledExplorer)! }, retryAfter: retryAfter)
    }

    static var createdPayer: StubReply {
        StubReply(status: 201, body: payerBody(allowance: wire("allowances", 0)))
    }
}

@Suite("settlement client: registration pending and failure")
struct RegistrationPendingTests {
    /// Every attempt sent the same request: method, URL, headers and body bytes.
    func expectSameRequest(_ stub: StubTransport) {
        guard let first = stub.requests.first else { return }
        for request in stub.requests {
            #expect(request.httpMethod == "POST")
            #expect(request.url == first.url)
            #expect(request.allHTTPHeaderFields == first.allHTTPHeaderFields)
            #expect(request.httpBody == first.httpBody)
        }
    }

    @Test("a payer 202 then 201 returns the verified registration and reposts identical bytes")
    func payerPendingThenCreated() async throws {
        let stub = StubTransport([APIFixtures.registrationPending(retryAfter: 2),
                                  APIFixtures.registrationPending(retryAfter: 30), APIFixtures.createdPayer])
        let clock = FakeClock()
        let payerKey = APIFixtures.publicKey("payer")
        let reg = try await APIFixtures.client(stub, clock: clock).registerPayer(publicKey: payerKey)
        #expect(reg.created)
        #expect(reg.certificate.allowanceId == 1001)
        #expect(reg.certificate.payerKeyHash == P256Rules.keyHash(payerKey))
        #expect(reg.explorer?.absoluteString == APIFixtures.settledExplorer)
        #expect(stub.requests.count == 3)
        #expect(stub.requests.first?.url?.absoluteString == "https://api.test.invalid/v1/payers")
        expectSameRequest(stub)
        // The server's 2 s, then its 30 s capped at 10 s.
        #expect(clock.sleeps == [2, 10])
    }

    @Test("a merchant 202 then 200 returns the verified merchant and reposts identical bytes")
    func merchantPendingThenExisting() async throws {
        let key = APIFixtures.publicKey("merchantA")
        let pending = APIFixtures.registrationPending(kind: "merchant", keyHash: APIFixtures.keyHashHex("merchantA"),
                                                      signature: nil, retryAfter: nil)
        let stub = StubTransport([pending, StubReply(status: 200, body: APIFixtures.merchantBody(merchant: APIFixtures.wire("merchants", 0)))])
        let clock = FakeClock()
        let merchant = try await APIFixtures.client(stub, clock: clock).registerMerchant(publicKey: key, name: "Cafe\u{0301}")
        #expect(!merchant.created)
        #expect(merchant.certificate.merchantKeyHash == P256Rules.keyHash(key))
        #expect(stub.requests.count == 2)
        #expect(stub.requests.first?.url?.absoluteString == "https://api.test.invalid/v1/merchants")
        expectSameRequest(stub)
        #expect(clock.sleeps == [1], "with no retryAfter, the first backoff step")
    }

    @Test("202 until the deadline throws registrationPending with the last pending body")
    func pendingUntilDeadline() async throws {
        let stub = StubTransport([APIFixtures.registrationPending(signature: nil),
                                  APIFixtures.registrationPending(signature: "0OIl"),
                                  APIFixtures.registrationPending(signature: APIFixtures.settledSignatureBase58)])
        let clock = FakeClock()
        await #expect(throws: SettlementError.registrationPending(APIFixtures.pendingRegistration(.payer, key: "payer"))) {
            try await APIFixtures.client(stub, clock: clock).registerPayer(publicKey: APIFixtures.publicKey("payer"), timeout: 5)
        }
        // Posts at 0, 2 and 4; a fourth would need 2 s of wait plus 1 s of budget after 4.
        #expect(clock.sleeps == [2, 2])
        #expect(stub.requests.count == 3)
        #expect(clock.now <= 5)
        expectSameRequest(stub)
    }

    @Test("the default budget is 60 s, with reposts backing off to at most 10 s apart")
    func defaultBudget() async throws {
        let stub = StubTransport(Array(repeating: APIFixtures.registrationPending(retryAfter: 2), count: 10))
        let clock = FakeClock()
        do {
            _ = try await APIFixtures.client(stub, clock: clock).registerPayer(publicKey: APIFixtures.publicKey("payer"))
            Issue.record("expected registrationPending")
        } catch SettlementError.registrationPending(_) {}
        #expect(SettlementClient.registrationTimeout == 60)
        #expect(clock.sleeps == [2, 2, 4, 8, 10, 10, 10, 10, 3])
        #expect(stub.requests.count == 10)
        for start in stub.starts {
            #expect(start.at + start.timeout <= 60)
            #expect(60 - start.at >= SettlementClient.minRequestBudget)
        }
    }

    @Test("a 202 naming another kind or another key is a protocol violation and is not posted again")
    func pendingMustNameTheRequest() async throws {
        let cases: [(StubReply, String)] = [
            (APIFixtures.registrationPending(kind: "merchant"), "kind"),
            (APIFixtures.registrationPending(kind: nil), "kind"),
            (APIFixtures.registrationPending(kind: "PAYER"), "kind"),
            (APIFixtures.registrationPending(keyHash: APIFixtures.keyHashHex("merchantA")), "key hash"),
            (APIFixtures.registrationPending(keyHash: nil), "key hash"),
            (APIFixtures.registrationPending(keyHash: APIFixtures.keyHashHex("payer").uppercased()), "key hash"),
        ]
        for (reply, field) in cases {
            let stub = StubTransport([reply])
            do {
                _ = try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("payer"))
                Issue.record("accepted a 202 with the wrong \(field)")
            } catch let SettlementError.protocolViolation(reason) {
                #expect(reason.contains(field), "\(reason)")
            }
            #expect(stub.requests.count == 1)
        }
        // The merchant route: a payer body for the merchant's key, and a merchant body for another key.
        let merchantCases: [(StubReply, String)] = [
            (APIFixtures.registrationPending(kind: "payer", keyHash: APIFixtures.keyHashHex("merchantA")), "kind"),
            (APIFixtures.registrationPending(kind: "merchant", keyHash: APIFixtures.keyHashHex("payer")), "key hash"),
        ]
        for (reply, field) in merchantCases {
            let stub = StubTransport([reply])
            do {
                _ = try await APIFixtures.client(stub).registerMerchant(publicKey: APIFixtures.publicKey("merchantA"), name: "A")
                Issue.record("accepted a merchant 202 with the wrong \(field)")
            } catch let SettlementError.protocolViolation(reason) {
                #expect(reason.contains(field), "\(reason)")
            }
            #expect(stub.requests.count == 1)
        }
    }

    @Test("a 202 with an over-long or malformed signature is accepted but has no explorer link")
    func pendingHostileSignature() async throws {
        let signatures = [String(repeating: "z", count: 60_000), "0OIl not base58",
                          APIFixtures.settledSignatureBase58 + "?x=https://phishing.example"]
        for signature in signatures {
            let stub = StubTransport([APIFixtures.registrationPending(signature: signature, retryAfter: 2)])
            // One post fits in 2.5 s; a second would need 2 s of wait plus 1 s of budget.
            let expected = APIFixtures.pendingRegistration(.payer, key: "payer", signature: nil)
            await #expect(throws: SettlementError.registrationPending(expected)) {
                try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("payer"), timeout: 2.5)
            }
            #expect(stub.requests.count == 1)
        }
    }

    @Test("409 registration_failed maps to registrationFailed with the link built from the signature")
    func registrationFailed() async throws {
        let expected = SettlementError.registrationFailed(signature: APIFixtures.settledSignatureBase58,
                                                          explorer: URL(string: APIFixtures.settledExplorer)!, message: "m")
        let payer = StubTransport([APIFixtures.registrationFailed()])
        await #expect(throws: expected) {
            try await APIFixtures.client(payer).registerPayer(publicKey: APIFixtures.publicKey("payer"))
        }
        #expect(payer.requests.count == 1, "a 409 is never retried")
        let merchant = StubTransport([APIFixtures.registrationFailed()])
        await #expect(throws: expected) {
            try await APIFixtures.client(merchant).registerMerchant(publicKey: APIFixtures.publicKey("merchantA"), name: "A")
        }
        #expect(merchant.requests.count == 1, "a 409 is never retried")
    }

    @Test("a 409 whose signature is missing, malformed or the wrong type has no link")
    func registrationFailedWithoutValidSignature() async throws {
        let signatures: [Any?] = [nil, NSNull(), "1111", "0OIl", String(repeating: "z", count: 60_000), 42]
        for signature in signatures {
            let stub = StubTransport([APIFixtures.registrationFailed(signature: signature)])
            await #expect(throws: SettlementError.registrationFailed(signature: nil, explorer: nil, message: "m")) {
                try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("payer"))
            }
        }
    }

    @Test("409 with another name, or registration_failed on another status, is a protocol violation")
    func registrationFailedStatusAgreement() async throws {
        let cases: [(Int, String)] = [
            (409, "bad_json"), (409, "chain_unavailable"), (409, "something_new"),
            (400, "registration_failed"), (422, "registration_failed"), (500, "registration_failed"),
            (503, "registration_failed"),
        ]
        for (status, name) in cases {
            let stub = StubTransport([APIFixtures.registrationFailed(status: status, name: name)])
            await #expect(throws: SettlementError.protocolViolation("HTTP \(status) with error \(name)")) {
                try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("payer"))
            }
            #expect(stub.requests.count == 1)
        }
    }

    @Test("no registration request starts with no budget left")
    func noBudgetNoRequest() async throws {
        let stub = StubTransport([])
        let payer = SettlementClient.unknownRegistration(.payer, P256Rules.keyHash(APIFixtures.publicKey("payer")))
        await #expect(throws: SettlementError.registrationPending(payer)) {
            try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("payer"), timeout: 0)
        }
        let merchant = SettlementClient.unknownRegistration(.merchant, P256Rules.keyHash(APIFixtures.publicKey("merchantA")))
        await #expect(throws: SettlementError.registrationPending(merchant)) {
            try await APIFixtures.client(stub).registerMerchant(publicKey: APIFixtures.publicKey("merchantA"), name: "A",
                                                                timeout: -1)
        }
        #expect(stub.requests.isEmpty)
    }

    @Test("a budget that ends during a repost ends in registrationPending with the last body")
    func budgetEndsDuringRepost() async throws {
        let clock = FakeClock()
        // The first post takes 1 s and answers pending; the repost at 3 s would take 30 s.
        let stub = StubTransport([APIFixtures.registrationPending(retryAfter: 2).delayed(1),
                                  APIFixtures.createdPayer.delayed(30)], clock: clock)
        await #expect(throws: SettlementError.registrationPending(APIFixtures.pendingRegistration(.payer, key: "payer"))) {
            try await APIFixtures.client(stub, clock: clock).registerPayer(publicKey: APIFixtures.publicKey("payer"), timeout: 10)
        }
        #expect(stub.starts.map(\.at) == [0, 3])
        #expect(stub.starts.map(\.timeout) == [10, 7])
        #expect(clock.now == 10)
        for start in stub.starts { #expect(start.at + start.timeout <= 10) }
    }

    @Test("a budget that ends during the first post ends in registrationPending without a body")
    func budgetEndsDuringFirstPost() async throws {
        let clock = FakeClock()
        let stub = StubTransport([APIFixtures.createdPayer.delayed(25)], clock: clock)
        let unknown = SettlementClient.unknownRegistration(.payer, P256Rules.keyHash(APIFixtures.publicKey("payer")))
        await #expect(throws: SettlementError.registrationPending(unknown)) {
            try await APIFixtures.client(stub, clock: clock).registerPayer(publicKey: APIFixtures.publicKey("payer"), timeout: 10)
        }
        #expect(stub.starts.map(\.timeout) == [10])
        #expect(clock.now == 10)
    }

    @Test("a network error, chain_unavailable or rate limit is not retried, on the first post or a repost")
    func failuresNotRetried() async throws {
        let cases: [([StubReply], SettlementError)] = [
            ([StubReply(failure: URLError(.timedOut))], .network(.timedOut)),
            ([StubReply(failure: URLError(.networkConnectionLost))], .network(.networkConnectionLost)),
            ([APIFixtures.errorReply(503, "chain_unavailable")], .chainUnavailable(message: "m")),
            ([APIFixtures.registrationPending(), StubReply(failure: URLError(.timedOut))], .network(.timedOut)),
            ([APIFixtures.registrationPending(), APIFixtures.errorReply(503, "chain_unavailable")],
             .chainUnavailable(message: "m")),
            ([APIFixtures.registrationPending(), APIFixtures.errorReply(429, "rate_limited")],
             .rateLimited(retryAfter: nil, message: "m")),
        ]
        for (replies, expected) in cases {
            let stub = StubTransport(replies)
            await #expect(throws: expected) {
                try await APIFixtures.client(stub).registerPayer(publicKey: APIFixtures.publicKey("payer"))
            }
            #expect(stub.requests.count == replies.count)
        }
    }
}
