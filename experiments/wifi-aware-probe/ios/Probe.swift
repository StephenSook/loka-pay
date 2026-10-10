import SwiftUI
import Network
import WiFiAware
import DeviceDiscoveryUI
import CryptoKit

@main struct ProbeApp: App {
    var body: some Scene { WindowGroup { ProbeView() } }
}

@MainActor final class Probe: ObservableObject {
    @Published var status = "Select the Android test publisher."
    @Published var connected = false
    @Published var busy = false
    private var connection: NetworkConnection<TCP>?
    private var operation: Task<Void, Never>?
    private var timeout: Task<Void, Never>?
    private var generation = UUID()
    private let run = UUID().uuidString
    private let began = ProcessInfo.processInfo.systemUptime
    let logURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("events.jsonl")
    init() { event("capability", ["supported": WACapabilities.supportedFeatures.contains(.wifiAware), "os": ProcessInfo.processInfo.operatingSystemVersionString]) }
    func event(_ name: String, _ fields: [String: Any] = [:]) {
        var row = fields
        row["schema"] = 1; row["run"] = run; row["event"] = name
        row["captured_at"] = ISO8601DateFormatter().string(from: Date())
        row["elapsed_ms"] = (ProcessInfo.processInfo.systemUptime - began) * 1000
        do {
            var data = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]); data.append(10)
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
            let file = try FileHandle(forWritingTo: logURL); defer { try? file.close() }
            try file.seekToEnd(); try file.write(contentsOf: data)
            status = name.replacingOccurrences(of: "_", with: " ")
        } catch { status = "Could not save test results" }
    }
    func connect(_ endpoint: WAEndpoint) {
        stop(); event("endpoint_selected"); busy = true
        let candidate = NetworkConnection(to: endpoint) { TCP() }; connection = candidate
        let token = generation
        armTimeout(30)
        operation = Task {
            do {
                try await candidate.send(Data([0x4c, 0x41, 0x50, 0x31]))
                let response = try await candidate.receive(exactly: 4).content
                let path = try await candidate.currentPath?.wifiAware
                guard response == Data([0x4c, 0x41, 0x50, 0x31]), path != nil, !Task.isCancelled else { throw ProbeError.invalid }
                timeout?.cancel(); connected = true; busy = false
                armTimeout(30)
                event("aware_tcp_connected", ["native_aware_path": true])
            } catch { if generation == token { fail(error) } }
        }
    }
    private func armTimeout(_ seconds: Double) {
        timeout?.cancel()
        timeout = Task { try? await Task.sleep(for: .seconds(seconds)); guard !Task.isCancelled else { return }; event("timeout"); stop() }
    }
    func benchmark(large: Bool) {
        guard connected, !busy, let connection else { return }; busy = true
        let sizes = large ? [1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000] : Array(repeating: 1_000, count: 30)
        event("benchmark_started", ["mode": large ? "size_sweep" : "rtt_30", "synthetic_only": true])
        let token = generation
        operation = Task {
            do {
                var bytes = [UInt8](repeating: 0, count: 16_384)
                guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw ProbeError.invalid }
                let block = Data(bytes)
                for (trial, size) in sizes.enumerated() {
                    try Task.checkCancellation(); armTimeout(120)
                    let start = ProcessInfo.processInfo.systemUptime
                    var header = UInt32(size).bigEndian
                    try await connection.send(withUnsafeBytes(of: &header) { Data($0) })
                    var digest = SHA256(); var remaining = size
                    while remaining > 0 {
                        let chunk = block.prefix(min(remaining, block.count)); digest.update(data: chunk)
                        try await connection.send(Data(chunk)); remaining -= chunk.count
                    }
                    let ack = try await connection.receive(exactly: 32).content
                    guard ack == Data(digest.finalize()) else { throw ProbeError.invalid }
                    let uploadEnd = ProcessInfo.processInfo.systemUptime
                    digest = SHA256(); remaining = size
                    while remaining > 0 {
                        let n = min(remaining, block.count)
                        let chunk = try await connection.receive(exactly: n).content
                        guard chunk.count == n else { throw ProbeError.invalid }
                        digest.update(data: chunk); remaining -= n
                    }
                    try await connection.send(Data(digest.finalize()))
                    let end = ProcessInfo.processInfo.systemUptime
                    event("transfer", ["trial": trial, "bytes_each_direction": size,
                        "upload_with_ack_ms": (uploadEnd - start) * 1000,
                        "download_with_ack_ms": (end - uploadEnd) * 1000,
                        "round_trip_transfer_ms": (end - start) * 1000,
                        "integrity_verified": true, "native_aware_path": true,
                        "mode": large ? "size_sweep" : "rtt_30"])
                    timeout?.cancel()
                }
                event("benchmark_complete"); busy = false; armTimeout(30)
            } catch { if generation == token { fail(error) } }
        }
    }
    private func fail(_ error: Error) {
        event("operation_failed", ["error_type": String(describing: type(of: error))]); stop()
    }
    func stop() { generation = UUID(); operation?.cancel(); operation = nil; timeout?.cancel(); timeout = nil; connection = nil; connected = false; busy = false }
    enum ProbeError: Error { case invalid }
}

struct ProbeView: View {
    @StateObject private var probe = Probe()
    @State private var showingPublisher = false
    @State private var showOtherDirection = false
    @State private var launchedTest = false
    @Environment(\.scenePhase) private var scenePhase
    private func openPublisher() {
        guard WACapabilities.supportedFeatures.contains(.wifiAware),
              WAPublishableService.allServices["_loka-probe._tcp"] != nil else {
            probe.event("publisher_unavailable"); return
        }
        probe.stop(); probe.event("reverse_publisher_opened"); showingPublisher = true
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("1. Let Android find this iPhone") {
                    Button("Make iPhone discoverable", action: openPublisher)
                    Text("Keep the next screen open. On Android tap Find and pair with iPhone, then Continue. This iPhone waits for that request. A code appears only if the phones complete the first pairing step.")
                }
                Section("Isolated test") {
                    Text("Synthetic data only. This app does not access LOKA chats, contacts, or keys.")
                    Text(probe.status).monospaced()
                }
                Section {
                    Toggle("Other direction: iPhone finds Android", isOn: $showOtherDirection)
                    Text("Leave this off for the current test. Both phones searching at once cannot pair.")
                }
                if showOtherDirection, WACapabilities.supportedFeatures.contains(.wifiAware), let service = WASubscribableService.allServices["_loka-probe._tcp"] {
                    Section("1. Pair and connect") {
                        DevicePicker(.wifiAware(.connecting(to: .userSpecifiedDevices, from: service))) { endpoint in
                            probe.connect(endpoint)
                        } label: { Label("Select Android probe", systemImage: "antenna.radiowaves.left.and.right") }
                        fallback: { Text("System pairing is currently unavailable.") }
                        Text("Start pairing on Android once, then tap Select Android probe here. Choose LOKA test phone. The iPhone’s system screen handles code entry after discovery. If no phone or code-entry screen appears, pairing has not reached that step—there is no separate code box in this app.")
                    }
                    Section("2. Measure") {
                        Button("30 small round trips") { probe.benchmark(large: false) }.disabled(!probe.connected || probe.busy)
                        Button("1 KB through 100 MB, both directions") { probe.benchmark(large: true) }.disabled(!probe.connected || probe.busy)
                        Text("The large test transfers 222 MB total. Keep both test apps open. Turn mobile data off and disconnect from routers first; leave Wi-Fi on.")
                        Button("Stop") { probe.event("user_stopped"); probe.stop() }
                    }
                } else if !WACapabilities.supportedFeatures.contains(.wifiAware) { Text("Wi-Fi Aware is unavailable on this device.") }
                Section { ShareLink("Export test log", item: probe.logURL) }
            }.navigationTitle("LOKA Aware Probe")
            .sheet(isPresented: $showingPublisher, onDismiss: { probe.event("reverse_publisher_closed") }) {
                NavigationStack {
                    Group {
                    if let service = WAPublishableService.allServices["_loka-probe._tcp"] {
                        DevicePairingView(.wifiAware(.connecting(to: service, from: .userSpecifiedDevices))) {
                            Text("Waiting for Android. Tap Find and pair with iPhone → Continue on Android. Keep this screen open. If no request appears, we will inspect the test logs.").padding()
                        } fallback: {
                            Text("The system cannot start pairing discovery right now.").padding()
                                .onAppear { probe.event("publisher_system_unavailable") }
                        }
                        .onAppear { probe.event("publisher_view_presented") }
                    } else { Text("The test service is not configured.").onAppear { probe.event("publisher_service_missing") } }
                    }
                .navigationTitle("Find this iPhone")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { showingPublisher = false } } }
                }
                .task { try? await Task.sleep(for: .seconds(300)); if !Task.isCancelled { showingPublisher = false } }
            }
            .task {
                guard !launchedTest else { return }; launchedTest = true
                if ProcessInfo.processInfo.arguments.contains("--publish-test") { openPublisher() }
            }
            .onChange(of: scenePhase) { _, phase in
                probe.event("app_state", ["state": phase == .active ? "active" : phase == .background ? "background" : "inactive"])
            }
        }
    }
}
