import Foundation

/// The HTTP seam. The app uses `URLSessionTransport`; tests pass a stub, so they never touch
/// the network. A transport must finish, or throw `URLError(.timedOut)`, within
/// `request.timeoutInterval` seconds: the client puts its remaining time budget there.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// URLSession with no cookies and no cache: the API has no login (protocol/API-V1.md section 1).
/// It caps every response body and treats `timeoutInterval` as a limit on the whole exchange,
/// which URLSession alone does not (its request timeout restarts with every packet).
public struct URLSessionTransport: HTTPTransport {
    /// The largest response body accepted. The largest legitimate body (a registration with 16
    /// earmarks) is under 2 KB.
    public static let defaultMaxResponseBytes = 64 * 1024
    /// Bound on any one exchange in the default session (URLSession's own default is 7 days).
    public static let resourceTimeout: TimeInterval = 60

    let session: URLSession
    let maxResponseBytes: Int

    public init(session: URLSession? = nil, maxResponseBytes: Int = URLSessionTransport.defaultMaxResponseBytes) {
        self.maxResponseBytes = maxResponseBytes
        if let session {
            self.session = session
            return
        }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = SettlementClient.requestTimeout
        config.timeoutIntervalForResource = Self.resourceTimeout
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config)
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let limit = min(max(request.timeoutInterval, 0), 86_400)
        return try await withThrowingTaskGroup(of: (Data, HTTPURLResponse).self) { group in
            group.addTask { try await self.receive(request) }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(limit * 1_000_000_000))
                throw URLError(.timedOut)
            }
            // Whichever finishes first wins; the other is cancelled (a cancelled download stops).
            defer { group.cancelAll() }
            guard let first = try await group.next() else { throw URLError(.timedOut) }
            return first
        }
    }

    /// Reads the body with a running count, so a missing or false Content-Length cannot make it
    /// buffer more than `maxResponseBytes`.
    func receive(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else {
            bytes.task.cancel()
            throw SettlementError.invalidResponse("not an HTTP response")
        }
        // A declared length over the cap fails early; -1 (unknown) passes to the running count.
        guard http.expectedContentLength <= Int64(maxResponseBytes) else {
            bytes.task.cancel()
            throw SettlementError.invalidResponse("response too large")
        }
        var data = Data()
        for try await byte in bytes {
            guard data.count < maxResponseBytes else {
                bytes.task.cancel()
                throw SettlementError.invalidResponse("response too large")
            }
            data.append(byte)
        }
        return (data, http)
    }
}

/// Monotonic time and sleep for retries, polling and the overall budget, injectable so tests
/// run instantly.
public struct SettlementClock: Sendable {
    public let now: @Sendable () -> TimeInterval
    public let sleep: @Sendable (TimeInterval) async throws -> Void

    public init(now: @escaping @Sendable () -> TimeInterval,
                sleep: @escaping @Sendable (TimeInterval) async throws -> Void) {
        self.now = now
        self.sleep = sleep
    }

    public static let system = SettlementClock(
        now: { ProcessInfo.processInfo.systemUptime },
        sleep: { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) })
}

/// Every way a settlement call can fail. API errors keep the server's `message` for logs;
/// screens show their own copy.
public enum SettlementError: Error, Equatable, Sendable {
    // The `error` names of protocol/API-V1.md section 1, each with the HTTP status it requires.
    case badJSON(message: String)
    case badBase64url(message: String)
    case badPubkey(message: String)
    case nameLength(message: String)
    case unknownNote(message: String)
    /// HTTP 422: the note or ack failed a stateless check. `check` is a PAYMENT-V1 section 6
    /// name (`PaymentError(rawValue:)` maps it) or `bad_ack`. Unsigned and not remembered by the
    /// server: a corrected upload of the same note is checked from scratch.
    case refused(check: String, message: String)
    /// `retryAfter` is the Retry-After header in seconds; nil when absent or not an integer.
    case rateLimited(retryAfter: Int?, message: String)
    case budgetExhausted(message: String)
    case chainUnavailable(message: String)
    /// A non-2xx response whose body is not one of the names above.
    case http(status: Int, error: String?, message: String?)

    // Transport.
    case network(URLError.Code)
    case transport(String)
    /// A 2xx body that is not the JSON the contract describes, or a body over the size cap.
    case invalidResponse(String)

    // Signed bytes in a 2xx body that do not check out.
    /// A server signature, deployment or structure check failed (the PAYMENT-V1 checks).
    case verification(PaymentError)
    /// The confirmation is genuinely signed but names a different note.
    case confirmationMismatch
    /// The allowance certificate is genuinely signed but for a different payer key.
    case payerMismatch
    /// The merchant certificate is genuinely signed but for a different merchant key.
    case merchantMismatch
    /// A response API v1 never sends: a 200 carrying a status-3 CONF, or an error name with
    /// the wrong HTTP status. Never retried.
    case protocolViolation(String)

    /// The time budget of `waitForDecision` or `settleAndWait` ran out with no decision. The
    /// pending body is the last one the server sent; without one (the budget ended during the
    /// upload) its signature is nil and the server may not have the note, so uploading the same
    /// note again is the way to find out (it is idempotent by note id).
    case stillPending(PendingSettlement)
}

extension SettlementError {
    /// Failures where resending the same request cannot do harm and may succeed: the chain was
    /// not reached (`chain_unavailable`: nothing was signed), or the request may never have
    /// arrived. A cancelled request is not retried.
    var isRetryable: Bool {
        switch self {
        case .chainUnavailable: return true
        case .network(let code): return Self.transientNetworkCodes.contains(code)
        default: return false
        }
    }

    static let transientNetworkCodes: [URLError.Code] = [
        .timedOut, .networkConnectionLost, .notConnectedToInternet,
        .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed,
    ]
}

/// Ends a budgeted call; `waitForDecision` and `settleAndWait` turn it into `.stillPending`.
struct BudgetSpent: Error {}

/// How `settle` and the note reads resend after a retryable failure. Registration is never
/// retried automatically.
public struct RetryPolicy: Equatable, Sendable {
    /// Total attempts, the first one included.
    public let maxAttempts: Int
    /// Wait before the second attempt; it doubles after each further failure.
    public let baseDelaySeconds: Double

    public init(maxAttempts: Int, baseDelaySeconds: Double) {
        precondition(maxAttempts >= 1 && baseDelaySeconds >= 0)
        self.maxAttempts = maxAttempts
        self.baseDelaySeconds = baseDelaySeconds
    }

    public static let standard = RetryPolicy(maxAttempts: 3, baseDelaySeconds: 1)
    public static let never = RetryPolicy(maxAttempts: 1, baseDelaySeconds: 0)
}

/// A payer registration whose allowance certificate verified with the pinned server key and
/// names the registered key. Every number on screen comes from `certificate`.
public struct VerifiedRegistration: Equatable, Sendable {
    public let certificate: AllowanceCertificate
    /// The allowance wire as received, for the mesh (`A` content, PAYMENT-V1 section 5).
    public let allowanceWire: Data
    /// HTTP 201 (a new allowance) rather than 200 (the repeat call). Unsigned.
    public let created: Bool
    /// "team" or "public". Unsigned, display only.
    public let pool: String?
    /// The open_allowance transaction and its explorer page. Unsigned (the certificate does not
    /// carry it); nil when the server sent no valid base58 signature.
    public let openSignature: String?
    public let explorer: URL?
}

/// A merchant registration whose certificate verified with the pinned server key and names the
/// registered key.
public struct VerifiedMerchant: Equatable, Sendable {
    public let certificate: MerchantCertificate
    /// The merchant wire as received, for the mesh (`C` content).
    public let merchantWire: Data
    /// HTTP 201 (new) rather than 200 (existing). Unsigned.
    public let created: Bool
    /// The register_merchant transaction and its explorer page. Unsigned; nil when not valid.
    public let registerSignature: String?
    public let explorer: URL?
}

/// A decision on chain whose CONF verified with the pinned server key and names the expected
/// note. Status, slot, times and error code come only from `confirmation` (PAYMENT-V1 4.9).
public struct SettlementDecision: Equatable, Sendable {
    public let confirmation: Confirmation
    /// The CONF wire as received, for receipts (`Bundles.receipt`).
    public let confirmationWire: Data
    /// Built from the signed transaction signature.
    public let explorer: URL?
    /// True only when the server said it had already decided this note. Unsigned.
    public let replayed: Bool
    /// The program's error name when the transaction failed. Unsigned, display only; the signed
    /// code is `confirmation.errorCode`.
    public let reason: String?

    /// Settled or failed on chain; API v1 never returns a refused CONF.
    public var status: Confirmation.Status { confirmation.status }
}

/// HTTP 202: the server holds an attempt for this note id that the chain has not decided yet.
/// Nothing here is signed; it only says when to ask again.
public struct PendingSettlement: Equatable, Sendable {
    /// The note id this client asked about.
    public let noteId: Data
    /// The in-flight transaction once sent, and its explorer page. Unsigned.
    public let signature: String?
    public let explorer: URL?
    /// The server's suggested wait in seconds before the next poll.
    public let retryAfter: Int?
}

/// A note upload or read: decided on chain, or still in flight.
public enum SettlementOutcome: Equatable, Sendable {
    case decided(SettlementDecision)
    case pending(PendingSettlement)
}

/// Client for the settlement API (protocol/API-V1.md). It trusts no JSON field for status or
/// money: each signed wire is verified with the pinned server key and bound to the key or note
/// this client sent.
public struct SettlementClient: Sendable {
    public static let defaultBaseURL = URL(string: "https://api.zerobars.us")!
    public static let requestTimeout: TimeInterval = 20
    /// The longest wait between polls (API-V1 section 5).
    public static let maxPollInterval: TimeInterval = 10
    /// The least time a request inside an overall budget is started with.
    public static let minRequestBudget: TimeInterval = 1

    public let baseURL: URL
    public let deployment: Deployment
    public let serverPublicKey: Data
    public let retryPolicy: RetryPolicy
    private let transport: any HTTPTransport
    private let clock: SettlementClock

    /// `deployment` and `serverPublicKey` come from config/pins.json. The deployment is needed
    /// because certificates bind program id, cluster and mint.
    public init(deployment: Deployment, serverPublicKey: Data, baseURL: URL = SettlementClient.defaultBaseURL,
                transport: any HTTPTransport = URLSessionTransport(), retryPolicy: RetryPolicy = .standard,
                clock: SettlementClock = .system) {
        precondition(serverPublicKey.count == 32, "the server Ed25519 public key is 32 bytes")
        self.deployment = deployment
        self.serverPublicKey = serverPublicKey
        self.baseURL = baseURL
        self.transport = transport
        self.retryPolicy = retryPolicy
        self.clock = clock
    }

    /// `POST /v1/payers`: opens (or returns) the allowance for this compressed P-256 key.
    /// Not retried automatically; the endpoint is idempotent by key, so the caller may repeat it.
    public func registerPayer(publicKey: Data) async throws -> VerifiedRegistration {
        let request = try post("v1/payers", SettlementAPI.PublicKeyRequest(publicKey: Base64URL.encode(publicKey)))
        let (data, response) = try await perform(request)
        let body = try decode(SettlementAPI.PayerResponse.self, data)
        let wire = try wireField("allowance", body.allowance)
        let certificate = try verified {
            try AllowanceCertificate.verify(wire: wire, deployment: deployment, serverPublicKey: serverPublicKey)
        }
        guard certificate.payerKeyHash == P256Rules.keyHash(publicKey) else { throw SettlementError.payerMismatch }
        let explorer = body.openSignature.flatMap { Self.explorerURL(signature: $0, clusterId: deployment.clusterId) }
        return VerifiedRegistration(certificate: certificate, allowanceWire: wire, created: response.statusCode == 201,
                                    pool: body.pool, openSignature: explorer == nil ? nil : body.openSignature,
                                    explorer: explorer)
    }

    /// `POST /v1/merchants`. The name is sent in NFC; on a repeat call the certificate keeps the
    /// first name, so it is not compared. Not retried automatically (idempotent by key).
    public func registerMerchant(publicKey: Data, name: String) async throws -> VerifiedMerchant {
        let body = SettlementAPI.MerchantRequest(publicKey: Base64URL.encode(publicKey),
                                                 name: name.precomposedStringWithCanonicalMapping)
        let (data, response) = try await perform(try post("v1/merchants", body))
        let reply = try decode(SettlementAPI.MerchantResponse.self, data)
        let wire = try wireField("merchant", reply.merchant)
        let certificate = try verified {
            try MerchantCertificate.verify(wire: wire, deployment: deployment, serverPublicKey: serverPublicKey)
        }
        guard certificate.merchantKeyHash == P256Rules.keyHash(publicKey) else { throw SettlementError.merchantMismatch }
        let explorer = reply.registerSignature.flatMap { Self.explorerURL(signature: $0, clusterId: deployment.clusterId) }
        return VerifiedMerchant(certificate: certificate, merchantWire: wire, created: response.statusCode == 201,
                                registerSignature: explorer == nil ? nil : reply.registerSignature, explorer: explorer)
    }

    /// `POST /v1/notes`: uploads one note (and the merchant's ack when there is one). Answers
    /// `.pending` while an attempt for that note id is in flight (HTTP 202); a stateless refusal
    /// throws `.refused` (HTTP 422).
    /// Retried only on `chain_unavailable` and transient network failures. That is safe because
    /// the server holds one attempt per note id: the request is built once and every attempt
    /// sends the SAME bytes, so a repeat gets the pending body or the first decision back
    /// (`replayed: true`), and the chain refuses a used serial anyway. Never retry with re-signed
    /// or different note bytes. Adding an ack to a decided note changes neither decision nor CONF.
    public func settle(note: SignedNote, ack: Ack? = nil) async throws -> SettlementOutcome {
        try await settle(note: note, ack: ack, deadline: nil)
    }

    /// `GET /v1/notes/{noteId}`: one read, to recover a decision after a dropped connection.
    public func outcome(noteId: Data) async throws -> SettlementOutcome {
        try await outcome(noteId: noteId, deadline: nil)
    }

    /// Polls `GET /v1/notes/{noteId}` until the chain decides, within `timeout` seconds in all,
    /// retries included. Waits the server's `retryAfter`, backing off (1, 2, 4, 8 s) to at most
    /// 10 s between polls, and throws `.stillPending` once no further poll fits in the budget.
    public func waitForDecision(noteId: Data, timeout: TimeInterval,
                                first: PendingSettlement? = nil) async throws -> SettlementDecision {
        try await poll(noteId: noteId, deadline: clock.now() + timeout, first: first)
    }

    /// Uploads a note and, while it is in flight, polls until the chain decides. `timeout` is one
    /// budget for the upload, every poll and every retry; `.stillPending` when it runs out.
    public func settleAndWait(note: SignedNote, ack: Ack? = nil, timeout: TimeInterval) async throws -> SettlementDecision {
        let deadline = clock.now() + timeout
        let first: PendingSettlement
        do {
            switch try await settle(note: note, ack: ack, deadline: deadline) {
            case .decided(let decision): return decision
            case .pending(let pending): first = pending
            }
        } catch is BudgetSpent {
            throw SettlementError.stillPending(Self.unknownPending(note.noteId))
        }
        return try await poll(noteId: note.noteId, deadline: deadline, first: first)
    }

    // MARK: - Budgeted calls

    private func settle(note: SignedNote, ack: Ack?, deadline: TimeInterval?) async throws -> SettlementOutcome {
        let body = SettlementAPI.NoteRequest(note: Base64URL.encode(note.wire), ack: ack.map { Base64URL.encode($0.wire) })
        let request = try post("v1/notes", body)
        let (data, response) = try await performWithRetry(request, deadline: deadline)
        return try outcome(data: data, response: response, noteId: note.noteId)
    }

    private func outcome(noteId: Data, deadline: TimeInterval?) async throws -> SettlementOutcome {
        precondition(noteId.count == 32, "a note id is 32 bytes")
        var request = URLRequest(url: baseURL.appendingPathComponent("v1/notes/\(noteId.hex)"),
                                 cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: Self.requestTimeout)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await performWithRetry(request, deadline: deadline)
        return try outcome(data: data, response: response, noteId: noteId)
    }

    private func poll(noteId: Data, deadline: TimeInterval, first: PendingSettlement?) async throws -> SettlementDecision {
        var pending = first
        var backoff: TimeInterval = 1
        while true {
            if let current = pending {
                // Wait before the next poll, never shorter than the server asked and never so long
                // that the poll would start with less than `minRequestBudget` left.
                let hint = min(max(0, TimeInterval(current.retryAfter ?? 0)), Self.maxPollInterval)
                let wait = min(Self.maxPollInterval, max(hint, backoff))
                let next = min(wait, deadline - clock.now() - Self.minRequestBudget)
                guard next >= hint else { throw SettlementError.stillPending(current) }
                if next > 0 { try await clock.sleep(next) }
                backoff = min(backoff * 2, Self.maxPollInterval)
            }
            do {
                switch try await outcome(noteId: noteId, deadline: deadline) {
                case .decided(let decision): return decision
                case .pending(let p): pending = p
                }
            } catch is BudgetSpent {
                throw SettlementError.stillPending(pending ?? Self.unknownPending(noteId))
            }
        }
    }

    static func unknownPending(_ noteId: Data) -> PendingSettlement {
        PendingSettlement(noteId: noteId, signature: nil, explorer: nil, retryAfter: nil)
    }

    // MARK: - Verification

    private func outcome(data: Data, response: HTTPURLResponse, noteId: Data) throws -> SettlementOutcome {
        if response.statusCode == 202 {
            let body = try decode(SettlementAPI.PendingResponse.self, data)
            let explorer = body.signature.flatMap { Self.explorerURL(signature: $0, clusterId: deployment.clusterId) }
            return .pending(PendingSettlement(noteId: noteId, signature: explorer == nil ? nil : body.signature,
                                              explorer: explorer, retryAfter: body.retryAfter ?? Self.retryAfter(response)))
        }
        let body = try decode(SettlementAPI.DecisionResponse.self, data)
        let wire = try wireField("conf", body.conf)
        let conf = try verified { try Confirmation.verify(wire: wire, serverPublicKey: serverPublicKey) }
        guard conf.noteId == noteId else { throw SettlementError.confirmationMismatch }
        guard conf.status != .refusedOffChain else {
            throw SettlementError.protocolViolation("API v1 never signs a refused CONF (status 3)")
        }
        let explorer = conf.txSignature.contains(where: { $0 != 0 })
            ? Self.explorerURL(signature: Base58.encode(conf.txSignature), clusterId: deployment.clusterId) : nil
        return .decided(SettlementDecision(confirmation: conf, confirmationWire: wire, explorer: explorer,
                                           replayed: body.replayed == true, reason: body.error))
    }

    private func verified<T>(_ check: () throws -> T) throws -> T {
        do {
            return try check()
        } catch let error as PaymentError {
            throw SettlementError.verification(error)
        }
    }

    private func wireField(_ name: String, _ text: String) throws -> Data {
        do {
            return try Base64URL.decode(text)
        } catch {
            throw SettlementError.invalidResponse("\(name) is not canonical base64url")
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch let error as DecodingError {
            throw SettlementError.invalidResponse("\(type): \(Self.describe(error))")
        } catch {
            throw SettlementError.invalidResponse("\(type): \(error)")
        }
    }

    static func describe(_ error: DecodingError) -> String {
        func path(_ keys: [CodingKey]) -> String { keys.map(\.stringValue).joined(separator: ".") }
        switch error {
        case .keyNotFound(let key, let c): return "missing \(path(c.codingPath + [key]))"
        case .valueNotFound(_, let c): return "null \(path(c.codingPath))"
        case .typeMismatch(_, let c): return "wrong type at \(path(c.codingPath))"
        case .dataCorrupted(let c): return "not JSON \(path(c.codingPath))"
        @unknown default: return "\(error)"
        }
    }

    /// `https://explorer.solana.com/tx/<base58>?cluster=devnet` (API-V1 section 1), only for a
    /// canonical base58 string of a 64-byte signature, so no server text becomes a link as is.
    /// This is the one place base58 is decoded from server text, and the decode is bounded.
    static func explorerURL(signature: String, clusterId: UInt8) -> URL? {
        guard let raw = Base58.decode(signature, maxBytes: 64), raw.count == 64,
              Base58.encode(raw) == signature else { return nil }
        return URL(string: "https://explorer.solana.com/tx/\(signature)" + (clusterId == 0 ? "?cluster=devnet" : ""))
    }

    // MARK: - HTTP

    private func post<Body: Encodable>(_ path: String, _ body: Body) throws -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path),
                                 cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: Self.requestTimeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    private func performWithRetry(_ request: URLRequest, deadline: TimeInterval?) async throws -> (Data, HTTPURLResponse) {
        var attempt = 1
        while true {
            do {
                return try await perform(request, deadline: deadline)
            } catch let error as SettlementError where error.isRetryable {
                // The budget ran out during the request: report that, not the timeout it caused.
                if let deadline, clock.now() >= deadline { throw BudgetSpent() }
                guard attempt < retryPolicy.maxAttempts else { throw error }
                let delay = retryPolicy.baseDelaySeconds * pow(2, Double(attempt - 1))
                // No room for the delay and one more request: the failure itself is the answer.
                if let deadline, clock.now() + delay + Self.minRequestBudget > deadline { throw error }
                if delay > 0 { try await clock.sleep(delay) }
                attempt += 1
            }
        }
    }

    private func perform(_ request: URLRequest, deadline: TimeInterval? = nil) async throws -> (Data, HTTPURLResponse) {
        var request = request
        if let deadline {
            // Never start a request with no budget left, and never let one outlive the budget.
            let remaining = deadline - clock.now()
            guard remaining > 0 else { throw BudgetSpent() }
            request.timeoutInterval = min(Self.requestTimeout, remaining)
        }
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch let error as URLError {
            throw SettlementError.network(error.code)
        } catch let error as SettlementError {
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw SettlementError.transport(String(describing: error))
        }
        guard (200..<300).contains(response.statusCode) else {
            throw Self.apiError(status: response.statusCode, data: data, response: response)
        }
        return (data, response)
    }

    /// The HTTP status each error name must come with (API-V1 section 1).
    static let errorStatus: [String: Int] = [
        "bad_json": 400, "bad_base64url": 400, "bad_pubkey": 400, "name_length": 400,
        "unknown_note": 404, "rate_limited": 429, "budget_exhausted": 429, "chain_unavailable": 503,
    ]

    /// The names a 422 may carry: the PAYMENT-V1 section 6 checks, and `bad_ack`.
    static let refusalChecks: Set<String> = [
        "length", "prefix", "cluster", "currency", "amount_zero", "wrong_program", "wrong_mint",
        "bad_pubkey", "high_s", "bad_signature", "bad_ack",
    ]

    static func apiError(status: Int, data: Data, response: HTTPURLResponse) -> SettlementError {
        guard let body = try? JSONDecoder().decode(SettlementAPI.ErrorBody.self, from: data) else {
            return .http(status: status, error: nil, message: nil)
        }
        let name = body.error
        let message = body.message
        // Status and name are matched together, so a known name on the wrong status (a 429 that
        // says chain_unavailable) is never trusted and never retried.
        if status == 422 {
            guard refusalChecks.contains(name) else { return .protocolViolation("HTTP 422 with error \(name)") }
            return .refused(check: name, message: message)
        }
        guard let expected = errorStatus[name] else { return .http(status: status, error: name, message: message) }
        guard expected == status else { return .protocolViolation("HTTP \(status) with error \(name)") }
        switch name {
        case "bad_json": return .badJSON(message: message)
        case "bad_base64url": return .badBase64url(message: message)
        case "bad_pubkey": return .badPubkey(message: message)
        case "name_length": return .nameLength(message: message)
        case "unknown_note": return .unknownNote(message: message)
        case "rate_limited": return .rateLimited(retryAfter: retryAfter(response), message: message)
        case "budget_exhausted": return .budgetExhausted(message: message)
        case "chain_unavailable": return .chainUnavailable(message: message)
        default: return .http(status: status, error: name, message: message)
        }
    }

    /// Retry-After as whole seconds. The HTTP-date form is not parsed (nil).
    static func retryAfter(_ response: HTTPURLResponse) -> Int? {
        guard let text = response.value(forHTTPHeaderField: "Retry-After")?.trimmingCharacters(in: .whitespaces),
              let seconds = Int(text), seconds >= 0 else { return nil }
        return seconds
    }
}

/// JSON bodies of protocol/API-V1.md, field names exactly as written there. Only the signed wire
/// field of each response is required. The other fields this client reads are display only and
/// decode leniently (absent, null or the wrong type read as nil), so a server-side slip in one of
/// them never discards a verified certificate or confirmation. Fields the contract lists that are
/// mirrors of signed bytes (allowanceId, payerKeyHash, capUnits, offlineLimitUnits, bondUnits,
/// expiry, earmarks, merchantKeyHash, noteId, status, errorCode, slot, blockTime, uploadedAt,
/// explorer) are not decoded at all: the client takes those values from the verified wire.
enum SettlementAPI {
    struct PublicKeyRequest: Codable, Equatable {
        let publicKey: String
    }

    struct MerchantRequest: Codable, Equatable {
        let publicKey: String
        let name: String
    }

    /// `ack` is left out of the JSON when nil.
    struct NoteRequest: Codable, Equatable {
        let note: String
        let ack: String?
    }

    struct PayerResponse: Codable, Equatable {
        let allowance: String
        let pool: String?
        let openSignature: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            allowance = try c.decode(String.self, forKey: .allowance)
            pool = c.lenient(.pool)
            openSignature = c.lenient(.openSignature)
        }
    }

    struct MerchantResponse: Codable, Equatable {
        let merchant: String
        let registerSignature: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            merchant = try c.decode(String.self, forKey: .merchant)
            registerSignature = c.lenient(.registerSignature)
        }
    }

    /// HTTP 200 for `POST /v1/notes` and `GET /v1/notes/{noteId}`.
    struct DecisionResponse: Codable, Equatable {
        let conf: String
        let error: String?
        let replayed: Bool?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            conf = try c.decode(String.self, forKey: .conf)
            error = c.lenient(.error)
            replayed = c.lenient(.replayed)
        }
    }

    /// HTTP 202 for the same two routes. Nothing in it is signed, so nothing is required.
    struct PendingResponse: Codable, Equatable {
        let signature: String?
        let retryAfter: Int?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            signature = c.lenient(.signature)
            retryAfter = c.lenient(.retryAfter)
        }
    }

    struct ErrorBody: Codable, Equatable {
        let error: String
        let message: String
    }
}

extension KeyedDecodingContainer {
    /// A display field: absent, null or the wrong type all read as nil.
    func lenient<T: Decodable>(_ key: Key) -> T? {
        try? decodeIfPresent(T.self, forKey: key)
    }
}

/// Bitcoin-alphabet base58, for Solana transaction signatures in explorer links.
enum Base58 {
    static let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".utf8)

    static func encode(_ data: Data) -> String {
        let bytes = [UInt8](data)
        let zeros = bytes.prefix(while: { $0 == 0 }).count
        var digits: [UInt8] = []  // base 58, least significant first
        for byte in bytes {
            var carry = Int(byte)
            for i in digits.indices {
                carry += Int(digits[i]) << 8
                digits[i] = UInt8(carry % 58)
                carry /= 58
            }
            while carry > 0 {
                digits.append(UInt8(carry % 58))
                carry /= 58
            }
        }
        let out = [UInt8](repeating: alphabet[0], count: zeros) + digits.reversed().map { alphabet[Int($0)] }
        return String(decoding: out, as: UTF8.self)
    }

    /// The longest base58 text `byteCount` bytes encode to: ceil(byteCount x log 256 / log 58),
    /// so 88 characters for a 64-byte signature.
    static func maxLength(bytes byteCount: Int) -> Int { (byteCount * 1366 + 999) / 1000 }

    /// Nil for a character outside the alphabet or a value over `maxBytes` bytes. Text longer
    /// than `maxBytes` can encode to is refused before any work, and the output is bounded during
    /// the conversion, so server text cannot make this slow.
    static func decode(_ text: String, maxBytes: Int) -> Data? {
        guard text.utf8.count <= maxLength(bytes: maxBytes) else { return nil }
        let chars = Array(text.utf8)
        let zeros = chars.prefix(while: { $0 == alphabet[0] }).count
        var bytes: [UInt8] = []  // base 256, least significant first
        for c in chars {
            guard let value = alphabet.firstIndex(of: c) else { return nil }
            var carry = value
            for i in bytes.indices {
                carry += Int(bytes[i]) * 58
                bytes[i] = UInt8(carry & 0xff)
                carry >>= 8
            }
            while carry > 0 {
                bytes.append(UInt8(carry & 0xff))
                carry >>= 8
            }
            guard zeros + bytes.count <= maxBytes else { return nil }
        }
        return Data([UInt8](repeating: 0, count: zeros) + bytes.reversed())
    }
}
