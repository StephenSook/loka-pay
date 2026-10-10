import Foundation
import CoreBluetooth
import SwiftUI
import UIKit

/// Local transport with best-effort background restoration. Never grants contact trust.
protocol LocalPacketTransport: AnyObject {
    var onFrame: ((Data) -> Void)? { get set }
    func send(frame: Data) throws
    func stop()
}

final class BleLink: NSObject, ObservableObject, LocalPacketTransport, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let service = CBUUID(string: "9ebc1000-6ec2-4f17-97ef-48594c4f4b41")
    static let rxID = CBUUID(string: "9ebc1001-6ec2-4f17-97ef-48594c4f4b41")
    static let txID = CBUUID(string: "9ebc1002-6ec2-4f17-97ef-48594c4f4b41")
    @Published var status = "Local connections are stopped" {
        didSet {
            #if DEBUG
            NSLog("LOKA BLE status: \(status)")
            #endif
        }
    }
    @Published private(set) var bluetoothState: CBManagerState = .unknown
    @Published var peers: [CBPeripheral] = []
    private var peerSeenAt: [UUID: Date] = [:]
    private var peerSignals: [UUID: Int] = [:]
    func nearbySignalValue(_ peer: CBPeripheral, at now: Date) -> Int? {
        if peer === selected, let measured = signalMeasuredAt, now.timeIntervalSince(measured) < 30,
           let signalDBm, (-127 ... -1).contains(signalDBm) { return signalDBm }
        guard now.timeIntervalSince(peerSeenAt[peer.identifier] ?? .distantPast) < 30,
              let dbm = peerSignals[peer.identifier], (-127 ... -1).contains(dbm) else { return nil }
        return dbm
    }
    func nearbySignal(_ peer: CBPeripheral, at now: Date) -> String {
        guard let dbm = nearbySignalValue(peer, at: now) else { return "Signal unavailable" }
        return dbm >= -60 ? "Strong signal" : dbm >= -75 ? "Fair signal" : "Weak signal"
    }
    func nearbyDevices(at now: Date) -> [CBPeripheral] {
        guard enabled else { return [] }
        var visible = peers.filter { ($0 === selected && connected) || now.timeIntervalSince(peerSeenAt[$0.identifier] ?? .distantPast) < 30 }
        if connected, let selected, !visible.contains(where: { $0.identifier == selected.identifier }) { visible.append(selected) }
        return visible
    }
    @Published var connected = false
    @Published var probeConfirmed = false
    @Published var probing = false
    @Published private(set) var checkingApproval = false
    @Published private(set) var enabled = false
    @Published private(set) var connecting = false
    @Published private(set) var signalDBm: Int?
    @Published private(set) var signalMeasuredAt: Date?
    private var signalRequestedAt: Date?
    func refreshSignal() {
        guard connected, let selected, selected.state == .connected, signalRequestedAt.map { Date().timeIntervalSince($0) >= 10 } ?? true else { return }
        signalRequestedAt = Date(); selected.readRSSI()
    }
    func peripheral(_ peripheral: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
        guard peripheral === selected else { return }
        signalRequestedAt = nil
        guard error == nil, (-127 ... -1).contains(RSSI.intValue) else { signalDBm = nil; signalMeasuredAt = nil; return }
        signalDBm = RSSI.intValue; signalMeasuredAt = Date()
    }
    private var approvalChecks = LinkApprovalChecks()
    private var approvalTimer: Timer?
    private var recovery = LinkRecovery()
    private var passiveRecoveryRequested = false
    private var setupDeadline = LinkSetupDeadline()
    private var reconnectTask: DispatchWorkItem?
    private var scanTimeout: DispatchWorkItem?
    private var scanID: UUID?
    private var candidates = NearbyCandidatePolicy()
    var onFrame: ((Data) -> Void)?
    var onLinkChanged: ((Bool) -> Void)?
    var onProbeConfirmed: (() -> Void)?
    var onTransferOpportunity: (() -> Void)?
    var onAdditionalPeer: ((UUID) -> Void)?
    private var lastNearbyScan: TimeInterval = -30
    func continueBackgroundDiscovery() {
        guard started, manager.state == .poweredOn else { return }
        // Leave a service-filtered scan with Core Bluetooth; no timer is needed
        // to keep the registration alive while the process is suspended.
        stopScanning()
        manager.scanForPeripherals(withServices: [Self.service], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }
    func discoverNearby() {
        guard started, manager.state == .poweredOn, UIApplication.shared.applicationState == .active,
              ProcessInfo.processInfo.systemUptime - lastNearbyScan >= 30 else { return }
        lastNearbyScan = ProcessInfo.processInfo.systemUptime
        scanForCurrentPhones()
    }
    private var transferTask: UIBackgroundTaskIdentifier = .invalid
    private var backgroundBudgetExhausted = false
    private func finishTransferTask() {
        guard transferTask != .invalid else { return }
        let task = transferTask; transferTask = .invalid
        UIApplication.shared.endBackgroundTask(task)
    }
    private func protectTransfer() {
        guard transferTask == .invalid, !backgroundBudgetExhausted else { return }
        transferTask = UIApplication.shared.beginBackgroundTask(withName: "Finish local message transfer") { [weak self] in
            self?.backgroundBudgetExhausted = true
            self?.finishTransferTask()
        }
    }
    private var manager: CBCentralManager!
    var peopleHandle: String? { selected.map { "ble:" + $0.identifier.uuidString } }
    private var selected: CBPeripheral?
    private var rx: CBCharacteristic?
    var queuedBytes: Int { outgoing.reduce(0) { $0 + $1.count } }
    private var outgoing: [Data] = []
    private var writing = false
    private var writeTimeout: DispatchWorkItem?
    private var writeStartedAt: TimeInterval?
    private var writeToken: UUID?
    private var assembler = BleFrameAssembler()
    private var started = false
    private var timeout: DispatchWorkItem?
    private var probeTimeout: DispatchWorkItem?
    private let preferences = UserDefaults.standard
    override init() {
        super.init()
        // Existing permission is consent to resume discovery, unless explicitly turned off.
        started = preferences.object(forKey: "loka.localConnection.enabled") as? Bool ?? (CBManager.authorization == .allowedAlways)
        enabled = started
        manager = CBCentralManager(delegate: self, queue: .main, options: [CBCentralManagerOptionShowPowerAlertKey: true, CBCentralManagerOptionRestoreIdentifierKey: "org.loka.local.central.v1"])
    }
    private var rememberedPeer: UUID? { preferences.string(forKey: "loka.localConnection.peer").flatMap(UUID.init(uuidString:)) }
    var canChooseAnotherPhone: Bool { rememberedPeer != nil || connecting }
    func chooseAnotherPhone() {
        stopConnection(); preferences.removeObject(forKey: "loka.localConnection.peer")
        candidates.reset(); peers.removeAll()
        recovery.reset(); passiveRecoveryRequested = false; start()
    }
    func resume() {
        if UIApplication.shared.applicationState == .active { backgroundBudgetExhausted = false }
        guard started else { return }
        recovery.reset()
        candidates.reset()
        passiveRecoveryRequested = false
        if connected, selected?.state == .connected {
            if let began = writeStartedAt, ProcessInfo.processInfo.systemUptime - began >= 12 {
                fail("Connection interrupted. Reconnecting automatically…"); return
            }
            if !probeConfirmed && !checkingApproval { checkConnection() }
            return
        }
        if connected {
            stopConnection(); scheduleReconnect(); return
        }
        if connecting {
            if setupDeadline.expired(now: ProcessInfo.processInfo.systemUptime) { fail("Your nearby phone is unavailable. Reconnecting automatically…") }
            return
        }
        if selected != nil {
            // Cancel an OS-owned waiting request before submitting a new bounded attempt.
            stopConnection(); scheduleReconnect(); return
        }
        start()
    }
    func start() {
        preferences.set(true, forKey: "loka.localConnection.enabled")
        started = true; enabled = true
        guard manager.state == .poweredOn else { centralManagerDidUpdateState(manager); return }
        guard !connected && !connecting else { return }
        // A cached identifier is only a hint. Prefer a currently connected matching
        // peripheral, otherwise discover a live local route without identifying a friend.
        if let id = rememberedPeer,
           let peer = manager.retrieveConnectedPeripherals(withServices: [Self.service]).first(where: { $0.identifier == id }),
           candidates.take(id, now: ProcessInfo.processInfo.systemUptime) {
            connect(peer, recovering: true); return
        }
        status = "Looking for a nearby LOKA connection…"
        scanForCurrentPhones()
    }
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        bluetoothState = central.state
        #if DEBUG
        NSLog("LOKA BLE radio state: \(central.state.rawValue), enabled: \(started)")
        #endif
        if central.state == .poweredOn {
            recovery.reset(); passiveRecoveryRequested = false
            if started {
                if let peer = selected, peer.state == .connected, !connected {
                    connecting = true; armSetupTimeout(for: peer); peer.discoverServices([Self.service])
                } else { start() }
            }
        } else {
            stopConnection(); peers.removeAll()
            status = central.state == .unauthorized ? "Allow Bluetooth access in iPhone Settings" : "Bluetooth is unavailable. Enable Bluetooth to connect locally."
        }
    }
    private func stopScanning() {
        scanID = nil; scanTimeout?.cancel(); scanTimeout = nil; manager.stopScan()
    }
    private func scanForCurrentPhones() {
        guard started, manager.state == .poweredOn else { return }
        stopScanning(); peers.removeAll()
        let id = UUID(); scanID = id
        manager.scanForPeripherals(withServices: [Self.service], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        guard UIApplication.shared.applicationState == .active else { return }
        let task = DispatchWorkItem { [weak self] in
            guard let self, self.scanID == id else { return }
            self.stopScanning()
            if !self.connected && !self.connecting { self.scheduleReconnect() }
        }
        scanTimeout = task; DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: task)
    }
    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        guard started,
              let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral],
              let peer = restored.first(where: { $0.identifier == rememberedPeer }) else { return }
        guard peer.state == .connected else {
            // Cancel obsolete pending handles; powered-on callback starts fresh discovery.
            central.cancelPeripheralConnection(peer)
            status = "Finding a current local connection…"
            return
        }
        selected = peer; peer.delegate = self
        status = "Restoring your local connection…"
        if central.state == .poweredOn {
            connecting = true; armSetupTimeout(for: peer); peer.discoverServices([Self.service])
        }
    }
    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        #if DEBUG
        NSLog("LOKA BLE discovered: remembered=\(peripheral.identifier == rememberedPeer), selected=\(peripheral === selected)")
        #endif
        peerSeenAt = peerSeenAt.filter { Date().timeIntervalSince($0.value) < 30 }
        if peerSeenAt.count < 32 || peerSeenAt[peripheral.identifier] != nil { peerSeenAt[peripheral.identifier] = Date() }
        peerSignals = peerSignals.filter { peerSeenAt[$0.key] != nil }
        if peerSeenAt[peripheral.identifier] != nil, (-127 ... -1).contains(RSSI.intValue) { peerSignals[peripheral.identifier] = RSSI.intValue }
        peers.removeAll { $0 !== selected && Date().timeIntervalSince(peerSeenAt[$0.identifier] ?? .distantPast) >= 30 }
        if !peers.contains(where: { $0.identifier == peripheral.identifier }) && peers.count < 32 { peers.append(peripheral) }
        if started, (connected || connecting), peripheral.identifier != selected?.identifier { onAdditionalPeer?(peripheral.identifier) }
        if started, !connected, !connecting,
           candidates.take(peripheral.identifier, now: ProcessInfo.processInfo.systemUptime) {
            connect(peripheral, recovering: true)
        }
    }
    func connect(_ peer: CBPeripheral, recovering: Bool = false) {
        stopConnection()
        if !recovering { recovery.reset(); passiveRecoveryRequested = false; preferences.removeObject(forKey: "loka.localConnection.peer") }
        started = true; enabled = true; preferences.set(true, forKey: "loka.localConnection.enabled")
        stopScanning()
        connecting = true
        selected = peer; peer.delegate = self
        status = "Connecting locally…"; manager.connect(peer)
        armSetupTimeout(for: peer)
        if recovering {
            status = "Connecting to a nearby LOKA route…"
        }
    }
    private func armSetupTimeout(for peer: CBPeripheral) {
        timeout?.cancel()
        setupDeadline.begin(now: ProcessInfo.processInfo.systemUptime)
        let task = DispatchWorkItem { [weak self] in
            guard let self, self.selected === peer, self.connecting,
                  self.setupDeadline.expired(now: ProcessInfo.processInfo.systemUptime) else { return }
            self.fail("Your nearby phone is unavailable. Messages are waiting for a connection.")
        }
        timeout = task; DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: task)
    }
    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard selected === peripheral else { central.cancelPeripheralConnection(peripheral); return }
        connecting = true; armSetupTimeout(for: peripheral)
        #if DEBUG
        NSLog("LOKA BLE connected; discovering service")
        #endif
        peripheral.discoverServices([Self.service])
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard selected === peripheral else { return }; stopConnection(); status = "Could not connect. Try again."; scheduleReconnect()
    }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard selected === peripheral else { return }; stopConnection(); status = "Local connection lost"; scheduleReconnect()
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard selected === peripheral else { return }
        guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == Self.service }) else { fail("LOKA service unavailable"); return }
        peripheral.discoverCharacteristics([Self.rxID, Self.txID], for: service)
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard selected === peripheral else { return }
        guard error == nil,
            let write = service.characteristics?.first(where: { $0.uuid == Self.rxID && $0.properties.contains(.write) }),
            let read = service.characteristics?.first(where: { $0.uuid == Self.txID && $0.properties.contains(.indicate) }) else { fail("LOKA characteristics unavailable"); return }
        rx = write
        // Restored subscriptions may already be active and produce no new callback.
        if read.isNotifying { subscriptionReady() }
        else { peripheral.setNotifyValue(true, for: read) }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard selected === peripheral else { return }
        guard characteristic.uuid == Self.txID else { return }
        guard error == nil && characteristic.isNotifying else { fail("Could not receive local packets"); return }
        subscriptionReady()
    }
    private func subscriptionReady() {
        #if DEBUG
        NSLog("LOKA BLE subscription ready")
        #endif
        stopScanning()
        timeout?.cancel(); timeout = nil; setupDeadline.cancel(); connecting = false; connected = true
        checkConnection()
    }
    /// Checks only the user-selected phone. Never selects a radio peer or grants trust.
    func checkConnection() {
        guard connected, !checkingApproval, !probeConfirmed else { return }
        approvalChecks.begin(now: ProcessInfo.processInfo.systemUptime)
        checkingApproval = true
        approvalTimer?.invalidate()
        approvalTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.checkApprovalTick() }
        checkApprovalTick()
    }
    private func finishApprovalChecks() {
        approvalChecks.cancel(); approvalTimer?.invalidate(); approvalTimer = nil; checkingApproval = false
    }
    private func checkApprovalTick() {
        guard connected, !probeConfirmed else { finishApprovalChecks(); return }
        guard !probing, !writing, outgoing.isEmpty else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard approvalChecks.active(now: now) else {
            finishApprovalChecks()
            fail("This local route did not respond. Looking for another…")
            return
        }
        if approvalChecks.takeAttempt(now: now) { probe() }
    }
    private func probe() {
        guard connected, !probing, !writing, outgoing.isEmpty else { return }
        probeConfirmed = false; probing = true; onLinkChanged?(false)
        let task = DispatchWorkItem { [weak self] in
            guard let self = self, self.probing else { return }
            if self.writing {
                self.fail("Connection stalled. Looking for another local route…")
            } else {
                self.probing = false
                self.status = "Checking the local connection…"
            }
        }
        probeTimeout?.cancel(); probeTimeout = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: task)
        outgoing.append(Data([0x7f,0x4c,0x4f,0x4b,0x41,1])); pump()
        status = "Checking the local connection…"
    }
    func send(frame: Data) throws { try send(frame: frame, urgent: false) }
    func send(frame: Data, urgent: Bool) throws {
        guard connected, probeConfirmed else { throw NSError(domain: "LOKA", code: 1, userInfo: [NSLocalizedDescriptionKey: "Waiting for a local connection"]) }
        try BleSendQueue.enqueue(frame, queue: &outgoing, urgent: urgent, inFlight: writing)
        protectTransfer()
        pump()
    }
    private func pump() {
        guard !writing, let peer = selected, let rx = rx, let first = outgoing.first, connected else { return }
        let token = UUID(); writeToken = token; writeStartedAt = ProcessInfo.processInfo.systemUptime
        let task = DispatchWorkItem { [weak self] in
            guard let self, self.selected === peer, self.writing, self.writeToken == token else { return }
            self.fail("Connection interrupted. Reconnecting automatically…")
        }
        writeTimeout?.cancel(); writeTimeout = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: task)
        writing = true; peer.writeValue(first, for: rx, type: .withResponse)
    }
    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard selected === peripheral, characteristic === rx, writing else { return }
        writeTimeout?.cancel(); writeTimeout = nil; writeStartedAt = nil; writeToken = nil
        writing = false
        guard error == nil else {
            outgoing.removeAll(); finishTransferTask(); probeTimeout?.cancel(); probing = false; probeConfirmed = false; onLinkChanged?(false)
            if checkingApproval {
                status = "Checking the local connection…"
            } else {
                status = "Connection interrupted. Checking the local route…"
                checkConnection()
            }
            return
        }
        if !outgoing.isEmpty { outgoing.removeFirst() }
        pump()
        if outgoing.isEmpty {
            finishTransferTask()
            // A Bluetooth wake can drain pending ciphertext even when UI timers are suspended.
            onTransferOpportunity?()
        }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard selected === peripheral, characteristic.uuid == Self.txID, error == nil, let bytes = characteristic.value else { return }
        if bytes == Data([0x7f,0x4c,0x4f,0x4b,0x41,2]) {
            guard probing else { return }
            probeTimeout?.cancel(); probing = false
            finishApprovalChecks(); recovery.reset(); passiveRecoveryRequested = false
            preferences.set(peripheral.identifier.uuidString, forKey: "loka.localConnection.peer")
            probeConfirmed = true; refreshSignal(); onProbeConfirmed?()
            if UIApplication.shared.applicationState != .active { continueBackgroundDiscovery() }
            status = "Local connection is on. Open a friend’s chat to say hello."; return
        }
        do {
            if let frame = try assembler.accept(bytes, now: ProcessInfo.processInfo.systemUptime) { onFrame?(frame) }
        } catch { status = "Malformed local frame rejected" }

    }
    private func fail(_ text: String) { stopConnection(); status = text; scheduleReconnect() }
    private func scheduleReconnect() {
        guard manager.state == .poweredOn, started else { return }
        guard let delay = recovery.nextDelay(enabled: started, canDiscover: true) else {
            status = "Waiting for a nearby LOKA connection. Messages retry when a route is available."
            // One passive service-filtered scan; no endless rapid retry loop.
            guard !passiveRecoveryRequested else { return }
            passiveRecoveryRequested = true
            stopScanning()
            manager.scanForPeripherals(withServices: [Self.service], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
            return
        }
        status = "Looking for another local connection…"
        let task = DispatchWorkItem { [weak self] in
            guard let self, self.started, !self.connected, !self.connecting else { return }
            self.start()
        }
        reconnectTask = task; DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: task)
    }
    private func stopConnection() {
        signalDBm = nil; signalMeasuredAt = nil; signalRequestedAt = nil
        reconnectTask?.cancel(); reconnectTask = nil
        let wasConnected = connected
        connecting = false; finishApprovalChecks()
        timeout?.cancel(); timeout = nil; setupDeadline.cancel()
        probeTimeout?.cancel(); probeTimeout = nil; probing = false
        if let peer = selected { selected = nil; manager.cancelPeripheralConnection(peer) }
        rx = nil; connected = false; probeConfirmed = false; outgoing.removeAll(); assembler = BleFrameAssembler(); writing = false
        writeTimeout?.cancel(); writeTimeout = nil; writeStartedAt = nil; writeToken = nil
        finishTransferTask()
        if wasConnected { onLinkChanged?(false) }
    }
    func stop() { preferences.set(false, forKey: "loka.localConnection.enabled"); started = false; enabled = false; stopScanning(); stopConnection(); peers.removeAll(); status = "Local connections are stopped" }
}

struct ConnectionsView: View {
    @ObservedObject var link: BleLink
    @EnvironmentObject private var chat: ChatStore
    @AppStorage("loka.nearby.explained") private var explainedNearby = false
    @State private var explainNearby = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                AwareConnectionCard(link: chat.aware, localEnabled: link.enabled)
                VStack(alignment: .leading, spacing: 12) {
                    Image(systemName: chat.localConnectionReady ? "checkmark.circle" : "antenna.radiowaves.left.and.right").font(.largeTitle)
                    Text(chat.localConnectionReady ? "You’re connected locally" : "Closer, even offline").font(.title.bold())
                    Text("Connect nearby phones to send messages without Internet. Keep both apps open during this preview.").font(.subheadline)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(24).foregroundStyle(LokaStyle.green)
                    .background(LokaStyle.mint).clipShape(RoundedRectangle(cornerRadius: 24))
                VStack(alignment: .leading, spacing: 20) {
                    Text("LOKA automatically finds nearby local routes. Only verified friends can deliver private messages to you.").font(.subheadline)
                    if !link.enabled {
                        Button("Turn on local connection") {
                            if explainedNearby { link.start() } else { explainNearby = true }
                        }.buttonStyle(.borderedProminent)
                    }
                    HStack(alignment: .top, spacing: 10) {
                        if !chat.localConnectionReady && (link.checkingApproval || link.connecting) { ProgressView() }
                        Text(chat.localConnectionReady ? "A local connection is available. Delivery is confirmed for each message." : link.status).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if link.enabled && !chat.localConnectionReady && !link.connecting {
                        Button("Try again") { link.resume() }.buttonStyle(.bordered)
                    }
                    Text("Add each other using your LOKA QR codes, then open a chat. Pending messages retry automatically for up to five minutes.").font(.subheadline)
                    NavigationLink { AddFriendView() } label: { Label("Add someone", systemImage: "person.badge.plus") }
                }.padding(20).background(LokaStyle.surface).clipShape(RoundedRectangle(cornerRadius: 20))
                VStack(alignment: .leading, spacing: 12) {
                    Text("What you can send").font(.headline)
                    Text("Text · available in this version\nVoice notes · up to 60 seconds\nPhotos · resized for local delivery\nLive calls · not available yet").font(.subheadline)
                    TimelineView(.periodic(from: .now, by: 5)) { context in
                        if link.connected, let dbm = link.signalDBm, let measured = link.signalMeasuredAt, (0..<30).contains(context.date.timeIntervalSince(measured)) {
                            Text("Nearby signal: \(dbm >= -60 ? "Strong" : dbm >= -75 ? "Fair" : "Weak")").font(.subheadline.weight(.semibold))
                        } else { Text("Nearby signal: not measured").font(.subheadline) }
                    }
                    Button("Check signal") { link.refreshSignal() }.disabled(!link.connected)
                    Text("Signal is an estimate for this nearby link, not your friend’s full route. Both phones need an updated LOKA app. Call quality and end-to-end speed have not been measured.").font(.footnote).foregroundStyle(.secondary)
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(LokaStyle.surface).clipShape(RoundedRectangle(cornerRadius: 20))
                VStack(alignment: .leading, spacing: 12) {
                    Text("Your connection stays on").font(.headline)
                    Text("LOKA discovers available local routes automatically. Keep local connection on. Background delivery depends on your phone; connections never add friends automatically.").font(.subheadline).foregroundStyle(.secondary)
                    if link.enabled { Button("Turn off local connection", role: .destructive) { link.stop() } }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(LokaStyle.surface).clipShape(RoundedRectangle(cornerRadius: 20))
            }.padding(20)
        }.background(LokaStyle.background).navigationTitle("Local connection").navigationBarTitleDisplayMode(.inline)
        .onAppear { link.refreshSignal() }
        .alert("Stay connected locally", isPresented: $explainNearby) {
            Button("Allow Nearby Devices") { explainedNearby = true; link.start() }
            Button("Not now", role: .cancel) {}
        } message: {
            Text("Allow Nearby Devices so LOKA can find and communicate with nearby phones without requiring Internet.")
        }
    }
    private func step(_ number: String, _ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(number)  \(title)").font(.headline)
            Text(detail).font(.subheadline).foregroundStyle(.secondary)
        }
    }
}

/// Apple peripheral role. Radio subscriptions never authorize a contact.
/// Uses the existing BLE v1 framing and public probe; no identity in advertisements.
final class AppleBlePeripheral: NSObject, CBPeripheralManagerDelegate {
    var onFrame: ((Data, String) -> Void)?
    var onReady: ((String, Bool) -> Void)?
    var onDrain: (() -> Void)?
    private var manager: CBPeripheralManager!
    private var enabled = UserDefaults.standard.bool(forKey: "loka.localConnection.enabled")
    private var publishing = false
    private var restoredPublication = false
    private var tx: CBMutableCharacteristic?
    private var rx: CBMutableCharacteristic?
    private struct Peer {
        let central: CBCentral
        var assembler = BleFrameAssembler()
        var queue: [Data] = []
        var ready = false
        var budget = BleAdmissionBudget()
    }
    func queuedBytes(_ target: String) -> Int { peers.values.first(where: { handle($0.central.identifier) == target })?.queue.reduce(0) { $0 + $1.count } ?? 0 }
    private var peers: [UUID: Peer] = [:]
    var handles: [String] { peers.values.filter(\.ready).map { handle($0.central.identifier) } }
    private func handle(_ id: UUID) -> String { "ble:in:" + id.uuidString }
    override init() {
        super.init()
        manager = CBPeripheralManager(delegate: self, queue: .main,
            options: [CBPeripheralManagerOptionShowPowerAlertKey: false,
                      CBPeripheralManagerOptionRestoreIdentifierKey: "org.loka.local.peripheral.v1"])
    }
    func peripheralManager(_ peripheral: CBPeripheralManager, willRestoreState dict: [String: Any]) {
        guard enabled else { peripheral.stopAdvertising(); peripheral.removeAllServices(); return }
        guard let services = dict[CBPeripheralManagerRestoredStateServicesKey] as? [CBMutableService],
              let service = services.first(where: { $0.uuid == BleLink.service }),
              let incoming = service.characteristics?.first(where: { $0.uuid == BleLink.rxID }) as? CBMutableCharacteristic,
              let outgoing = service.characteristics?.first(where: { $0.uuid == BleLink.txID }) as? CBMutableCharacteristic else { return }
        rx = incoming; tx = outgoing; publishing = true; restoredPublication = true
        // Restore subscriptions without granting contact trust or restoring a
        // partial frame. The existing probe and signed profile exchange run again.
        for central in (outgoing.subscribedCentrals ?? []).prefix(4) {
            peers[central.identifier] = Peer(central: central)
        }
    }
    func start() { enabled = true; publish() }
    func stop() {
        enabled = false
        manager.stopAdvertising()
        if manager.state == .poweredOn { manager.removeAllServices() }
        publishing = false; restoredPublication = false; tx = nil; rx = nil
        clearPeers()
    }
    private func clearPeers() {
        let old = handles; peers.removeAll()
        old.forEach { onReady?($0, false) }
    }
    private func publish() {
        guard enabled, manager.state == .poweredOn, !publishing else { return }
        publishing = true
        let incoming = CBMutableCharacteristic(type: BleLink.rxID, properties: [.write], value: nil, permissions: [.writeable])
        let outgoing = CBMutableCharacteristic(type: BleLink.txID, properties: [.indicate], value: nil, permissions: [])
        rx = incoming; tx = outgoing
        let service = CBMutableService(type: BleLink.service, primary: true)
        service.characteristics = [incoming, outgoing]
        manager.add(service)
    }
    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if peripheral.state == .poweredOn {
            publish()
            if enabled && restoredPublication && !peripheral.isAdvertising {
                peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [BleLink.service]])
            }
        }
        else { publishing = false; restoredPublication = false; tx = nil; rx = nil; clearPeers() }
    }
    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        guard enabled, service.characteristics?.contains(where: { $0 === rx }) == true else { return }
        guard error == nil else { publishing = false; return }
        // Only public service presence is advertised; names come from signed LP1.
        peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [BleLink.service]])
    }
    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        #if DEBUG
        NSLog("LOKA Apple BLE advertising: %@", error == nil ? "started" : "failed")
        #endif
    }
    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        guard enabled, characteristic === tx, peers[central.identifier] == nil, peers.count < 4 else { return }
        peers[central.identifier] = Peer(central: central)
    }
    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        guard characteristic === tx else { return }
        let old = peers.removeValue(forKey: central.identifier)
        if old?.ready == true { onReady?(handle(central.identifier), false) }
    }
    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        guard let first = requests.first else { return }
        guard enabled, requests.count <= 32, var peer = peers[first.central.identifier] else {
            peripheral.respond(to: first, withResult: .insufficientResources); return
        }
        var frames: [Data] = []
        let wasReady = peer.ready
        do {
            // Validate the complete batch on a copy: no partial delivery on rejection.
            for request in requests {
                guard request.central.identifier == first.central.identifier, request.characteristic === rx,
                      request.offset == 0, let bytes = request.value else { throw BleFrameError.invalid }
                if bytes == Data([0x7f, 0x4c, 0x4f, 0x4b, 0x41, 1]) {
                    guard peer.budget.take(now: ProcessInfo.processInfo.systemUptime), peer.queue.count < 2048 else { throw BleFrameError.invalid }
                    peer.queue.insert(Data([0x7f, 0x4c, 0x4f, 0x4b, 0x41, 2]), at: 0)
                    peer.ready = true
                } else {
                    guard peer.ready else { throw BleFrameError.invalid }
                    if let frame = try peer.assembler.accept(bytes, now: ProcessInfo.processInfo.systemUptime) {
                        guard peer.budget.take(now: ProcessInfo.processInfo.systemUptime) else { throw BleFrameError.invalid }
                        frames.append(frame)
                    }
                }
            }
        } catch {
            // Discard partial assembly after a rejected batch; preserve other peers.
            peers[first.central.identifier]?.assembler = BleFrameAssembler()
            peripheral.respond(to: first, withResult: .unlikelyError); return
        }
        peers[first.central.identifier] = peer
        peripheral.respond(to: first, withResult: .success)
        pump()
        let id = handle(first.central.identifier)
        if !wasReady && peer.ready { onReady?(id, true) }
        frames.forEach { onFrame?($0, id) }
    }
    func send(_ frame: Data, to target: String? = nil, urgent: Bool = false) throws {
        var accepted = false
        for id in Array(peers.keys) {
            guard var peer = peers[id], peer.ready, target == nil || target == handle(id) else { continue }
            do {
                try BleSendQueue.enqueue(frame, queue: &peer.queue, urgent: urgent, inFlight: false)
                peers[id] = peer; accepted = true
            } catch { continue }
        }
        guard accepted else { throw BleFrameError.invalid }
        pump()
    }
    private func pump() {
        guard enabled, manager.state == .poweredOn, let tx else { return }
        // Round-robin across bounded peers; retain the exact chunk on backpressure.
        var progressed = true
        while progressed {
            progressed = false
            for id in Array(peers.keys) {
                guard let peer = peers[id], let chunk = peer.queue.first else { continue }
                guard manager.updateValue(chunk, for: tx, onSubscribedCentrals: [peer.central]) else { return }
                peers[id]?.queue.removeFirst(); progressed = true
            }
        }
    }
    func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        pump()
        if peers.values.allSatisfy({ $0.queue.isEmpty }) { onDrain?() }
    }
}

/// Additional outgoing links keep a restored Android route from monopolizing discovery.
/// Three extra peers, existing 20-byte BLE framing, no contact trust from radio identity.
final class NearbyBleConnections: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var onFrame: ((Data, String) -> Void)?
    var onReady: ((String, Bool) -> Void)?
    var onDrain: (() -> Void)?
    var onDiagnostic: ((String) -> Void)?
    private var manager: CBCentralManager!
    private var enabled = UserDefaults.standard.bool(forKey: "loka.localConnection.enabled")
    private var candidates = NearbyCandidatePolicy()
    private final class Session {
        let peer: CBPeripheral
        var rx: CBCharacteristic?
        var ready = false
        var writing = false
        var queue: [Data] = []
        var assembler = BleFrameAssembler()
        var deadline: TimeInterval
        init(_ peer: CBPeripheral) { self.peer = peer; deadline = ProcessInfo.processInfo.systemUptime + 20 }
    }
    func queuedBytes(_ target: String) -> Int { sessions.values.first(where: { handle($0.peer.identifier) == target })?.queue.reduce(0) { $0 + $1.count } ?? 0 }
    private var sessions: [UUID: Session] = [:]
    var handles: [String] { sessions.values.filter(\.ready).map { handle($0.peer.identifier) } }
    private func handle(_ id: UUID) -> String { "ble:extra:" + id.uuidString }
    override init() {
        super.init()
        manager = CBCentralManager(delegate: self, queue: .main, options: [
            CBCentralManagerOptionShowPowerAlertKey: false,
            CBCentralManagerOptionRestoreIdentifierKey: "org.loka.local.extra-central.v1"])
    }
    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        guard let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] else { return }
        for peer in restored {
            guard enabled, sessions.count < 3, peer.state == .connected || peer.state == .connecting else {
                central.cancelPeripheralConnection(peer); continue
            }
            sessions[peer.identifier] = Session(peer); peer.delegate = self
            if central.state == .poweredOn && peer.state == .connected { peer.discoverServices([BleLink.service]) }
        }
    }
    func start() { enabled = true }
    func stop() { enabled = false; for id in Array(sessions.keys) { remove(id) }; candidates.reset() }
    func discover(_ id: UUID) {
        guard enabled, manager.state == .poweredOn, sessions.count < 3, sessions[id] == nil,
              candidates.take(id, now: ProcessInfo.processInfo.systemUptime),
              let peer = manager.retrievePeripherals(withIdentifiers: [id]).first else { return }
        onDiagnostic?("extra connect " + String(id.uuidString.prefix(8)))
        sessions[id] = Session(peer); peer.delegate = self; manager.connect(peer)
    }
    func tick() {
        let now = ProcessInfo.processInfo.systemUptime
        for (id, session) in sessions where (!session.ready || session.writing) && now >= session.deadline { remove(id) }
    }
    private func remove(_ id: UUID) {
        guard let session = sessions.removeValue(forKey: id) else { return }
        onDiagnostic?("extra removed " + String(id.uuidString.prefix(8)) + " ready=\(session.ready) state=\(session.peer.state.rawValue)")
        session.peer.delegate = nil; manager.cancelPeripheralConnection(session.peer)
        if session.ready { onReady?(handle(id), false) }
    }
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            for session in sessions.values where enabled && !session.ready && session.peer.state == .connected {
                session.peer.discoverServices([BleLink.service])
            }
        } else { for id in Array(sessions.keys) { remove(id) } }
    }
    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard sessions[peripheral.identifier] != nil else { central.cancelPeripheralConnection(peripheral); return }
        onDiagnostic?("extra connected " + String(peripheral.identifier.uuidString.prefix(8)))
        peripheral.discoverServices([BleLink.service])
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) { remove(peripheral.identifier) }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) { remove(peripheral.identifier) }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard sessions[peripheral.identifier] != nil else { return }
        guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == BleLink.service }) else { remove(peripheral.identifier); return }
        peripheral.discoverCharacteristics([BleLink.rxID, BleLink.txID], for: service)
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let session = sessions[peripheral.identifier] else { return }
        guard error == nil,
              let rx = service.characteristics?.first(where: { $0.uuid == BleLink.rxID && $0.properties.contains(.write) }),
              let tx = service.characteristics?.first(where: { $0.uuid == BleLink.txID && $0.properties.contains(.indicate) }) else { remove(peripheral.identifier); return }
        session.rx = rx
        if tx.isNotifying { probe(session) } else { peripheral.setNotifyValue(true, for: tx) }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard let session = sessions[peripheral.identifier], characteristic.uuid == BleLink.txID else { return }
        guard error == nil, characteristic.isNotifying else { onDiagnostic?("extra subscription error=\(String(describing: error)) notifying=\(characteristic.isNotifying)"); remove(peripheral.identifier); return }
        probe(session)
    }
    private func probe(_ session: Session) {
        guard !session.ready, session.queue.isEmpty, !session.writing else { return }
        session.queue.append(Data([0x7f, 0x4c, 0x4f, 0x4b, 0x41, 1])); pump(session)
    }
    private func pump(_ session: Session) {
        guard !session.writing, let rx = session.rx, let bytes = session.queue.first else { return }
        session.writing = true; session.deadline = ProcessInfo.processInfo.systemUptime + 12
        session.peer.writeValue(bytes, for: rx, type: .withResponse)
    }
    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let session = sessions[peripheral.identifier], characteristic === session.rx, session.writing else { return }
        guard error == nil else { onDiagnostic?("extra write error=\(String(describing: error))"); remove(peripheral.identifier); return }
        session.writing = false
        if !session.queue.isEmpty { session.queue.removeFirst() }
        pump(session)
        if session.ready && !session.writing && session.queue.isEmpty { onDrain?() }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let session = sessions[peripheral.identifier], characteristic.uuid == BleLink.txID else { return }
        guard error == nil, let bytes = characteristic.value else { remove(peripheral.identifier); return }
        if bytes == Data([0x7f, 0x4c, 0x4f, 0x4b, 0x41, 2]) {
            if !session.ready {
                session.ready = true
                #if DEBUG
                NSLog("LOKA additional BLE route: probe confirmed")
                #endif
                onReady?(handle(peripheral.identifier), true)
            }
            return
        }
        guard session.ready else { return }
        do { if let frame = try session.assembler.accept(bytes, now: ProcessInfo.processInfo.systemUptime) { onFrame?(frame, handle(peripheral.identifier)) } }
        catch { remove(peripheral.identifier) }
    }
    func send(_ frame: Data, to target: String? = nil, urgent: Bool = false) throws {
        var accepted = false
        for session in sessions.values where session.ready && (target == nil || target == handle(session.peer.identifier)) {
            do { try BleSendQueue.enqueue(frame, queue: &session.queue, urgent: urgent, inFlight: session.writing); accepted = true; pump(session) }
            catch { continue }
        }
        guard accepted else { throw BleFrameError.invalid }
    }
}
