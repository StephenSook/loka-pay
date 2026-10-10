import Foundation
import Network
import dnssd

/// Bounded concurrent same-network routes. Bonjour discovery never grants contact trust.
final class LocalWifiLink {
    var onFrame: ((Data, String) -> Void)?
    var onReady: ((String, Bool) -> Void)?
    var onDrain: (() -> Void)?
    var onPermissionBlocked: ((Bool) -> Void)?
    private var browser: NWBrowser?
    private var endpoints: Set<NWEndpoint> = []
    private final class Session {
        let endpoint: NWEndpoint
        let connection: NWConnection
        let handle = "wifi:" + UUID().uuidString
        var ready = false
        var pending = 0
        var queuedBytes = 0
        init(_ endpoint: NWEndpoint, _ connection: NWConnection) { self.endpoint = endpoint; self.connection = connection }
    }
    private var sessions: [NWEndpoint: Session] = [:]
    private var retry: DispatchWorkItem?
    private var cooldown: [NWEndpoint: TimeInterval] = [:]
    var handles: [String] { sessions.values.filter(\.ready).map(\.handle) }
    var ready: Bool { !handles.isEmpty }
    func queuedBytes(_ handle: String) -> Int { sessions.values.first { $0.handle == handle }?.queuedBytes ?? 0 }
    func start() {
        guard browser == nil else { return }
        let parameters = NWParameters.tcp; parameters.requiredInterfaceType = .wifi
        let browser = NWBrowser(for: .bonjour(type: "_loka-v0._tcp", domain: "local."), using: parameters)
        self.browser = browser
        browser.browseResultsChangedHandler = { [weak self, weak browser] results, _ in
            guard let self, self.browser === browser else { return }
            self.endpoints = Set(results.map(\.endpoint).sorted { String(describing: $0) < String(describing: $1) }.prefix(8))
            // A brief Bonjour disappearance must not tear down a working socket.
            self.cooldown = self.cooldown.filter { self.endpoints.contains($0.key) }
            self.connect()
        }
        browser.stateUpdateHandler = { [weak self, weak browser] state in
            guard let self, self.browser === browser else { return }
            switch state {
            case .waiting(let error), .failed(let error):
                if case .dns(let code) = error, code == kDNSServiceErr_PolicyDenied { self.onPermissionBlocked?(true) }
            case .ready: self.onPermissionBlocked?(false)
            default: break
            }
        }
        browser.start(queue: .main)
    }
    private func current(_ session: Session) -> Bool { sessions[session.endpoint] === session }
    private func connect() {
        guard browser != nil else { return }
        let now = ProcessInfo.processInfo.systemUptime
        for endpoint in endpoints.sorted(by: { String(describing: $0) < String(describing: $1) }) {
            guard sessions.count < 4 else { break }
            guard sessions[endpoint] == nil, (cooldown[endpoint] ?? 0) <= now else { continue }
            let parameters = NWParameters.tcp; parameters.requiredInterfaceType = .wifi
            let connection = NWConnection(to: endpoint, using: parameters)
            let session = Session(endpoint, connection); sessions[endpoint] = session
            connection.stateUpdateHandler = { [weak self, weak session] state in
                guard let self, let session, self.current(session) else { return }
                switch state {
                case .ready:
                    // Never send discovery-selected packets to a public Internet address.
                    guard case let .hostPort(host, _) = connection.currentPath?.remoteEndpoint,
                          case let .ipv4(address) = host,
                          LocalWifiFraming.isPrivateIPv4(address.rawValue) else { self.failed(session); return }
                    connection.send(content: Data([0x4c,0x57,0x46,0x30]), completion: .contentProcessed { [weak self, weak session] error in
                        guard let self, let session, self.current(session) else { return }
                        guard error == nil else { self.failed(session); return }
                        self.read(4, session) { [weak self, weak session] data in
                            guard let self, let session, self.current(session) else { return }
                            guard data == Data([0x4c,0x57,0x46,0x30]) else { self.failed(session); return }
                            session.ready = true; self.onReady?(session.handle, true); self.readFrame(session)
                        }
                    })
                case .waiting:
                    if connection.currentPath?.unsatisfiedReason == .localNetworkDenied { self.onPermissionBlocked?(true) }
                case .failed, .cancelled: self.failed(session)
                default: break
                }
            }
            connection.start(queue: .main)
            DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self, weak session] in
                guard let self, let session, self.current(session), !session.ready else { return }; self.failed(session)
            }
        }
        if endpoints.contains(where: { sessions[$0] == nil }) { scheduleRetry() }
    }
    private func read(_ count: Int, _ session: Session, completion: @escaping (Data) -> Void) {
        session.connection.receive(minimumIncompleteLength: count, maximumLength: count) { [weak self, weak session] data, _, complete, error in
            guard let self, let session, self.current(session) else { return }
            guard error == nil, let data, data.count == count else { self.failed(session); return }
            completion(data)
            if complete { self.failed(session) }
        }
    }
    private func readFrame(_ session: Session) {
        read(4, session) { [weak self, weak session] header in
            guard let self, let session, self.current(session) else { return }
            guard let count = try? LocalWifiFraming.length(header) else { self.failed(session); return }
            self.read(count, session) { [weak self, weak session] frame in
                guard let self, let session, self.current(session) else { return }
                self.onFrame?(frame, session.handle)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.063) { [weak self, weak session] in
                    guard let self, let session, self.current(session) else { return }; self.readFrame(session)
                }
            }
        }
    }
    func send(_ frame: Data, to handle: String) throws {
        guard let session = sessions.values.first(where: { $0.handle == handle && $0.ready }),
              session.pending < 32, (1...16384).contains(frame.count) else { throw LokaProtocolError.invalid }
        let header = try LocalWifiFraming.header(frame.count)
        session.pending += 1; session.queuedBytes += frame.count + header.count
        session.connection.send(content: header + frame, completion: .contentProcessed { [weak self, weak session] error in
            guard let self, let session, self.current(session) else { return }
            session.pending -= 1; session.queuedBytes -= frame.count + header.count
            if error != nil { self.failed(session) }
            else if session.pending == 0 { self.onDrain?() }
        })
    }
    private func failed(_ session: Session) {
        guard current(session) else { return }
        sessions.removeValue(forKey: session.endpoint)
        session.connection.stateUpdateHandler = nil; session.connection.cancel()
        cooldown[session.endpoint] = ProcessInfo.processInfo.systemUptime + 5
        if session.ready { onReady?(session.handle, false) }
        if browser != nil { scheduleRetry() }
    }
    private func scheduleRetry() {
        guard retry == nil else { return }
        let task = DispatchWorkItem { [weak self] in self?.retry = nil; self?.connect() }; retry = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: task)
    }
    func stop() {
        browser?.stateUpdateHandler = nil; browser?.cancel(); browser = nil
        endpoints.removeAll(); retry?.cancel(); retry = nil
        for session in Array(sessions.values) { failed(session) }
        cooldown.removeAll()
    }
}
