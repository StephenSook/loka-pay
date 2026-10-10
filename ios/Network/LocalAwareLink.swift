import Foundation
import Network
import WiFiAware
import SwiftUI
import DeviceDiscoveryUI

/// Opt-in paired Wi-Fi Aware experiment. Pairing never grants LOKA contact trust.
@MainActor final class LocalAwareLink: ObservableObject {
    @Published private(set) var ready = false
    @Published private(set) var status = "Not connected"
    var canStart: () -> Bool = { false }
    var onFrame: ((Data) -> Void)?
    var onReady: ((Bool) -> Void)?
    init() {
        #if DEBUG
        // Capability-only diagnostic created by this build; no keys, contacts or messages.
        let report: [String: Any] = ["supported": Self.supported, "enabledInBuild": Self.enabledInBuild,
                                     "os": ProcessInfo.processInfo.operatingSystemVersionString]
        if let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("loka-aware-capability.json"),
           let data = try? JSONSerialization.data(withJSONObject: report) { try? data.write(to: url, options: .atomic) }
        #endif
    }
    var queuedBytes: Int { if #available(iOS 26, *) { return (driver as? AwareSession)?.queuedBytes ?? 0 }; return 0 }
    private var driver: AnyObject?
    private(set) var handle = "aware:" + UUID().uuidString
    static var supported: Bool {
        if #available(iOS 26, *) { return WACapabilities.supportedFeatures.contains(.wifiAware) }
        return false
    }
    static var enabledInBuild: Bool { Bundle.main.object(forInfoDictionaryKey: "LOKAWiFiAwareEnabled") as? String == "YES" }
    var available: Bool { Self.supported && Self.enabledInBuild }
    private func session() -> AnyObject? {
        guard available, canStart() else { return nil }
        if #available(iOS 26, *) {
            if driver == nil {
                let value = AwareSession()
                value.frame = { [weak self] data in self?.onFrame?(data) }
                value.state = { [weak self] up, status in
                    guard let self else { return }
                    self.status = status
                    if self.ready != up {
                        self.ready = up; self.onReady?(up)
                        if !up { self.handle = "aware:" + UUID().uuidString }
                    }
                }
                driver = value
            }
        }
        return driver
    }
    @discardableResult func enableForOnboarding() -> Bool {
        guard available, canStart() else { return false }
        UserDefaults.standard.set(true, forKey: "loka.aware.enabled")
        resume()
        return true
    }
    func resume() {
        guard UserDefaults.standard.bool(forKey: "loka.aware.enabled") else { return }
        if #available(iOS 26, *), let driver = session() as? AwareSession {
            driver.start(host: UserDefaults.standard.bool(forKey: "loka.aware.host"))
        }
    }
    func host() { guard canStart() else { return }; UserDefaults.standard.set(true, forKey: "loka.aware.enabled"); UserDefaults.standard.set(true, forKey: "loka.aware.host"); resume() }
    @available(iOS 26, *) func connect(_ endpoint: WAEndpoint) {
        guard canStart() else { return }
        UserDefaults.standard.set(true, forKey: "loka.aware.enabled"); UserDefaults.standard.set(false, forKey: "loka.aware.host")
        (session() as? AwareSession)?.connect(endpoint)
    }
    func stop() { if #available(iOS 26, *) { (driver as? AwareSession)?.stop() } }
    func disable() { UserDefaults.standard.set(false, forKey: "loka.aware.enabled"); stop() }
    func send(_ frame: Data) throws {
        guard ready else { throw LokaProtocolError.invalid }
        if #available(iOS 26, *), let driver = driver as? AwareSession { try driver.send(frame) }
        else { throw LokaProtocolError.invalid }
    }
}

@available(iOS 26, *) @MainActor private final class AwareSession {
    var queuedBytes: Int { inFlightBytes + queue.reduce(0) { $0 + $1.count } }
    static let service = "_loka-v0._tcp"
    var frame: ((Data) -> Void)?
    var state: ((Bool, String) -> Void)?
    private var discovery: Task<Void, Never>?
    private var reader: Task<Void, Never>?
    private var writer: Task<Void, Never>?
    private var timeout: Task<Void, Never>?
    private var writeTimeout: Task<Void, Never>?
    private var connection: NetworkConnection<TCP>?
    private var queue: [Data] = []
    private var inFlightBytes = 0
    private var ready = false
    private var generation = UUID()
    private var hosting = false
    private var active = false
    private var retry: Task<Void, Never>?
    func start(host: Bool) {
        guard !active else { return }; active = true; hosting = host
        discovery = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled && self.active {
                do {
                    if host {
                        guard let service = WAPublishableService.allServices[Self.service] else { throw LokaProtocolError.invalid }
                        let listener = try NetworkListener(for: .wifiAware(.connecting(to: service, from: .allPairedDevices))) { TCP() }
                        try await listener.run { [weak self] connection in self?.accept(connection) }
                    } else {
                        guard let service = WASubscribableService.allServices[Self.service] else { throw LokaProtocolError.invalid }
                        let browser = NetworkBrowser(for: .wifiAware(.connecting(to: .allPairedDevices, from: service)))
                        try await browser.run { [weak self] endpoints in
                            guard let self, self.connection == nil, let endpoint = endpoints.first else { return }
                            self.accept(NetworkConnection(to: endpoint) { TCP() })
                        }
                    }
                } catch { if !Task.isCancelled { self.state?(self.ready, "Nearby Wi-Fi is unavailable. Other connections can still work.") } }
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
    }
    func connect(_ endpoint: WAEndpoint) {
        stop(); active = true; hosting = false
        accept(NetworkConnection(to: endpoint) { TCP() })
    }
    private func accept(_ candidate: NetworkConnection<TCP>) {
        guard active, connection == nil else { return }
        connection = candidate; generation = UUID(); let token = generation
        state?(false, "Connecting nearby…")
        timeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)); guard let self, self.generation == token, !self.ready else { return }; self.failed(token) } catch {}
        }
        reader = Task { [weak self] in
            guard let self else { return }
            do {
                try await candidate.send(Data([0x4c, 0x57, 0x46, 0x30]))
                let hello = try await candidate.receive(exactly: 4).content
                let awarePath = try await candidate.currentPath?.wifiAware
                guard hello == Data([0x4c, 0x57, 0x46, 0x30]), self.generation == token, !Task.isCancelled, awarePath != nil else { throw LokaProtocolError.invalid }
                self.timeout?.cancel(); self.timeout = nil; self.ready = true; self.state?(true, "Connected nearby")
                while !Task.isCancelled && self.generation == token {
                    let header = try await candidate.receive(exactly: 4).content
                    let length = try LocalWifiFraming.length(header)
                    self.timeout = Task { [weak self] in
                        do { try await Task.sleep(for: .seconds(15)); self?.failed(token) } catch {}
                    }
                    let data = try await candidate.receive(exactly: length).content
                    self.timeout?.cancel(); self.timeout = nil
                    guard data.count == length, self.generation == token, !Task.isCancelled else { throw LokaProtocolError.invalid }
                    self.frame?(data)
                }
            } catch { self.failed(token) }
        }
    }
    func send(_ data: Data) throws {
        guard ready, connection != nil, queue.count < 32, (1...16384).contains(data.count) else { throw LokaProtocolError.invalid }
        queue.append(try LocalWifiFraming.header(data.count) + data)
        guard writer == nil, let connection else { return }; let token = generation
        writer = Task { [weak self] in
            guard let self else { return }
            do {
                while !self.queue.isEmpty && self.generation == token && !Task.isCancelled {
                    self.writeTimeout = Task { [weak self] in
                        do { try await Task.sleep(for: .seconds(15)); self?.failed(token) } catch {}
                    }
                    let frame = self.queue.removeFirst(); self.inFlightBytes = frame.count
                    try await connection.send(frame)
                    guard self.generation == token else { return }
                    self.inFlightBytes = 0
                    self.writeTimeout?.cancel(); self.writeTimeout = nil
                }
                if self.generation == token { self.writer = nil }
            } catch { self.failed(token) }
        }
    }
    private func failed(_ token: UUID) {
        guard generation == token else { return }
        clear()
        if active && !hosting {
            discovery?.cancel(); discovery = nil
            retry?.cancel()
            retry = Task { [weak self] in
                do {
                    try await Task.sleep(for: .seconds(5))
                    guard let self, self.active else { return }
                    self.active = false; self.start(host: false)
                } catch {}
            }
        }
    }
    private func clear() {
        generation = UUID(); reader?.cancel(); reader = nil; writer?.cancel(); writer = nil; timeout?.cancel(); timeout = nil
        writeTimeout?.cancel(); writeTimeout = nil; connection = nil; queue = []; inFlightBytes = 0; ready = false; state?(false, "Not connected")
    }
    func stop() { active = false; retry?.cancel(); retry = nil; discovery?.cancel(); discovery = nil; clear() }
}

struct AwareConnectionCard: View {
    @ObservedObject var link: LocalAwareLink
    let localEnabled: Bool
    @State private var pairing = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Phone-to-phone Wi-Fi").font(.headline)
            if !localEnabled {
                Text("Turn on nearby messaging to use this option.").font(.subheadline).foregroundStyle(.secondary)
            } else if !LocalAwareLink.supported {
                Text("This iPhone doesn’t offer this connection option. Your other nearby connections still work.").font(.subheadline).foregroundStyle(.secondary)
            } else if !LocalAwareLink.enabledInBuild {
                Text("This option needs an Apple-authorized test build.").font(.subheadline).foregroundStyle(.secondary)
            } else if #available(iOS 26, *), let service = WASubscribableService.allServices["_loka-v0._tcp"] {
                Text("Connect phones without Internet. Follow the phone’s pairing steps once.").font(.subheadline)
                Text(link.status).font(.caption).foregroundStyle(.secondary)
                DevicePicker(.wifiAware(.connecting(to: .userSpecifiedDevices, from: service))) { endpoint in link.connect(endpoint) } label: {
                    Label("Connect a phone", systemImage: "iphone.gen3.radiowaves.left.and.right")
                } fallback: { Text("Pairing isn’t available right now.") }
                Button("Let another phone connect") { link.stop(); pairing = true }
                Button("Turn off this option") { link.disable() }
                Text("Preview: Android pairing support is still being integrated.").font(.caption).foregroundStyle(.secondary)
            }
        }.padding(20).background(Color(.secondarySystemGroupedBackground)).clipShape(RoundedRectangle(cornerRadius: 20))
        .sheet(isPresented: $pairing, onDismiss: { link.host() }) {
            if #available(iOS 26, *), let service = WAPublishableService.allServices["_loka-v0._tcp"] {
                NavigationStack {
                    DevicePairingView(.wifiAware(.connecting(to: service, from: .userSpecifiedDevices))) {
                        Text("Keep both phones close and follow the pairing steps.").padding()
                    } fallback: { Text("Pairing isn’t available right now.") }
                    .navigationTitle("Connect a phone")
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { pairing = false } } }
                }
            }
        }
    }
}
