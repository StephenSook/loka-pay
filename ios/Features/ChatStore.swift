import Foundation
import SwiftUI
import Combine
import UIKit

@MainActor final class ChatStore: ObservableObject {
    @Published private(set) var messages: [LokaMessage] = []
    @Published private(set) var ready = false
    @Published private(set) var localConnectionReady = false
    @Published private(set) var localWifiAccessBlocked = false
    @Published private(set) var typingUntil: [String: Int64] = [:]
    @Published private(set) var nearbyPeople: [NearbyProfile] = []
    @Published private(set) var chatRequests: [ContactConsentBook.Entry] = []
    @Published private(set) var peopleVisible = UserDefaults.standard.object(forKey: "loka.people.visible") as? Bool ?? true
    private var people: NearbyPeople?
    private var blePeopleHandle: String?
    private var localRoutes = LocalRouteState()
    @Published private(set) var notice: String?
    @Published private(set) var sending: Set<String> = []
    @Published private(set) var preparingMessageIDs: Set<String> = []
    @Published var openFriend: String?
    let aware = LocalAwareLink()
    private let wifi = LocalWifiLink()
    private let applePeripheral = AppleBlePeripheral()
    private let additionalBle = NearbyBleConnections()
    let link: BleLink
    private let contacts: ContactStore
    private var resetting = false
    private let encounterTrace = EncounterTrace()
    private let encounterHistory = EncounterHistory()
    private var savedEncounters: [EncounterHistory.Record]?
    private var encounterStorageAvailable = true
    private var quiz: QuickQuiz?
    @Published private(set) var quizSession: QuizSession?
    @Published private(set) var quizQuestions: [QuizQuestion] = []
    @Published private(set) var quizStatus = "Loading games…"
    @Published private(set) var quizCanAnswer = false
    @Published private(set) var quizPaused = false
    @Published private(set) var partyError:String?
    @Published private(set) var partySession: PartySession?
    @Published private(set) var partyGames: [PartyGame] = []
    @Published private(set) var partyCard: PartyCard?
    @Published private(set) var partyStatus = "Loading cards…"
    @Published private(set) var partyCanAct = false
    @Published private(set) var partyPaused = false
    private var party: PartyCards?
    private var partyKeys: [String:Data] = [:]
    private var partyPackets: [String:String] = [:]
    private var partyHash = ""
    private struct PartyArchive: Codable { var state: String; var keys: [String:Data] }
    private var mesh: LokaMesh?
    private var lastSaved: MessageArchive.State?
    private var archive: MessageArchive?
    private var replyActions: [String] = []
    private var acknowledged = ReceiptWindow()
    private let assembly = VoiceAssembly()
    private var subscriptions: Set<AnyCancellable> = []
    private var inbox: [Data] = []
    private var inboxURL: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("loka-locked-inbox.json") }
    @Published var carryEvents: [String] = []
    private func meshEvent(_ text: String) {
        carryEvents = Array((carryEvents + ["\(Int(Date().timeIntervalSince1970)) \(text.prefix(240))"]).suffix(500))
        if let data = try? JSONEncoder().encode(carryEvents), let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("loka-carry-events.json") { try? data.write(to: url, options: .atomic) }
        if !text.hasPrefix("CARRY ") { notice = text }
    }
    private func saveRouteDiagnostic() {
        #if DEBUG
        if let data = try? JSONEncoder().encode(encounterTrace.snapshot()), let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("loka-encounter-trace.json") { try? data.write(to: url, options: [.atomic, .completeFileProtection]) }
        #endif
        let state: [String: Any] = ["time": Int(Date().timeIntervalSince1970), "ready": ready,
            "unlocked": UIApplication.shared.isProtectedDataAvailable, "appState": UIApplication.shared.applicationState.rawValue,
            "own": contacts.publicKey.map { String(ContactCode.fingerprint($0).prefix(8)) } ?? "unknown",
            "localEnabled": link.enabled,
            "testSendStarted": debugSendStarted,
            "testBleOnly": debugBleOnly,
            "shadowEncounterRecords": encounterHistory.snapshot(now: Int64(Date().timeIntervalSince1970 * 1000)).count,
            "testTargetPresent": debugArgument("--loka-test-to") != nil,
            "testTextPresent": debugArgument("--loka-test-text") != nil,
            "testTargetTrusted": contacts.contacts.contains { $0.id == debugArgument("--loka-test-to") },
            "testExcluded": debugExcludedPeer.map { String($0.prefix(8)) } ?? "",
            "trusted": contacts.contacts.map { String($0.id.prefix(8)) },
            "pending": mesh?.diagnostic() ?? [],
            "party": ["phase": partySession?.phase ?? "none", "revision": partySession?.revision ?? 0, "members": partySession?.members.count ?? 0, "canAct": partyCanAct, "paused": partyPaused, "pendingPackets": Array(partyPackets.keys)] as [String:Any],
            "carryProtection": archive?.carryProtection ?? "unconfigured",
            "peers": nearbyPeople.map { ["id": String($0.id.prefix(8)), "version": $0.carryVersion,
                "route": $0.handle.components(separatedBy: ":").first ?? "unknown"] as [String: Any] }]
        if let data = try? JSONSerialization.data(withJSONObject: state), let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("loka-route-state.json") { try? data.write(to: url, options: .atomic) }
    }
    private var debugSendStarted = false
    private let debugSendDeadline = Date().addingTimeInterval(60)
    private func debugArgument(_ flag: String) -> String? {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
        #else
        return nil
        #endif
    }
    private var debugBleOnly: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("--loka-test-ble-only")
        #else
        return false
        #endif
    }
    private var debugExcludedPeer: String? { debugArgument("--loka-test-exclude") }
    private func runDebugSend() {
        #if DEBUG
        guard !debugSendStarted, Date() < debugSendDeadline, ready, !nearbyPeople.isEmpty,
              let peer = debugArgument("--loka-test-to"), let text = debugArgument("--loka-test-text"),
              text.hasPrefix("LOKA relay test "), text.utf8.count <= 140,
              let contact = contacts.contacts.first(where: { $0.id == peer }) else { return }
        debugSendStarted = true
        Task { @MainActor in _ = await self.send(to: contact, text: text) }
        #endif
    }
    private var routeCache: [String: LocalRouteEvidence] = [:]
    private func observeRoute(_ packet: LokaPacket, handle: String?, outgoing: Bool) {
        guard !outgoing || packet.source == contacts.publicKey.map(ContactCode.fingerprint) else { return }
        let route = LocalRouteEvidence(transport: LocalRouteEvidence.transport(handle), carrier: packet.carrier,
            at: Int64(Date().timeIntervalSince1970 * 1000), expiresAt: packet.expiresAt)
        if routeCache.count >= 256 { routeCache.removeAll() }
        routeCache[packet.id] = route
        guard outgoing, let index = messages.firstIndex(where: { $0.outgoing && $0.packetIDs.contains(packet.id) }) else { return }
        if messages[index].route?.transport == route.transport && messages[index].route?.carrier == route.carrier { return }
        messages[index].route = route; try? persist()
    }
    init(contacts: ContactStore, link: BleLink = BleLink()) {
        self.contacts = contacts; self.link = link
        LocalNotifications.shared.configure()
        LocalNotifications.shared.decideRequest = { [weak self] id, accept in
            guard let self else { return false }; self.configure(); return self.decideChat(id, accept: accept)
        }
        LocalNotifications.shared.open = { [weak self] id in self?.openFriend = id }
        LocalNotifications.shared.reply = { [weak self] id, text, token in
            guard let self else { return false }
            self.configure()
            guard let friend = self.contacts.contacts.first(where: { $0.id == id }) else { return false }
            if self.replyActions.contains(token) { return true }
            let saved = await self.send(to: friend, text: text)
            if saved { self.replyActions = Array((self.replyActions + [token]).suffix(128)); try? self.persist() }
            return saved
        }
        link.onAdditionalPeer = { [weak self] id in self?.additionalBle.discover(id) }
        additionalBle.onDiagnostic = { [weak self] text in self?.meshEvent("CARRY BLE " + text) }
        additionalBle.onDrain = { [weak self] in self?.mesh?.retry() }
        additionalBle.onFrame = { [weak self] frame, handle in self?.receiveFrame(frame, handle: handle) }
        additionalBle.onReady = { [weak self] handle, up in
            guard let self else { return }
            self.people?.link(handle, up: up)
            _ = self.localRoutes.updateAdditional(ready: !self.additionalBle.handles.isEmpty)
            self.localConnectionReady = self.localRoutes.available
            self.syncMeshLinks()
            if up { self.mesh?.retry() }
        }
        applePeripheral.onFrame = { [weak self] frame, handle in self?.receiveFrame(frame, handle: handle) }
        applePeripheral.onReady = { [weak self] handle, up in
            guard let self else { return }
            self.people?.link(handle, up: up)
            _ = self.localRoutes.updatePeripheral(ready: !self.applePeripheral.handles.isEmpty)
            self.localConnectionReady = self.localRoutes.available
            self.syncMeshLinks()
            if up { self.mesh?.retry() }
        }
        applePeripheral.onDrain = { [weak self] in self?.mesh?.retry() }
        aware.canStart = { [weak self] in self?.link.enabled == true && self?.debugBleOnly != true }
        aware.onFrame = { [weak self] frame in self?.receiveFrame(frame, handle: self?.aware.handle) }
        aware.onReady = { [weak self] up in
            guard let self else { return }
            self.people?.link(self.aware.handle, up: up)
            _ = self.localRoutes.updateAware(ready: up)
            self.localConnectionReady = self.localRoutes.available
            self.syncMeshLinks()
            if up { self.mesh?.retry() }
        }
        link.onFrame = { [weak self] frame in self?.receiveFrame(frame, handle: self?.blePeopleHandle) }
        link.onLinkChanged = { [weak self] up in self?.updateBleRoute(up: up) }
        link.onProbeConfirmed = { [weak self] in self?.updateBleRoute(up: true) }
        link.onTransferOpportunity = { [weak self] in self?.mesh?.retry() }
        wifi.onPermissionBlocked = { [weak self] blocked in self?.localWifiAccessBlocked = blocked }
        wifi.onFrame = { [weak self] frame, handle in self?.receiveFrame(frame, handle: handle) }
        wifi.onDrain = { [weak self] in self?.mesh?.retry() }
        wifi.onReady = { [weak self] handle, up in
            guard let self else { return }
            self.people?.link(handle, up: up)
            _ = self.localRoutes.update(wifi: true, ready: self.wifi.ready)
            self.localConnectionReady = self.localRoutes.available
            self.syncMeshLinks()
            if up { self.mesh?.retry() }
        }
        link.$enabled.removeDuplicates().sink { [weak self] enabled in
            if enabled { self?.additionalBle.start() } else { self?.additionalBle.stop() }
            if enabled { self?.applePeripheral.start() } else { self?.applePeripheral.stop() }
            if enabled && self?.debugBleOnly != true { self?.aware.resume() } else { self?.aware.stop() }
            if enabled && self?.debugBleOnly != true && UserDefaults.standard.bool(forKey: "loka.wifi.explained") { self?.wifi.start() } else { self?.wifi.stop() }
        }.store(in: &subscriptions)
        contacts.$publicKey.sink { [weak self] value in
            guard value != nil else { return }; DispatchQueue.main.async { self?.configure() }
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification).sink { [weak self] _ in
            self?.link.continueBackgroundDiscovery()
            self?.mesh?.retry(); self?.updateWaitingNotifications()
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification).sink { [weak self] _ in
            guard let self else { return }
            LocalNotifications.shared.clearWaiting()
            self.configure(); self.link.resume(); self.additionalBle.tick()
            self.syncMeshLinks(); self.mesh?.retry(); self.drainInbox()
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: UIApplication.protectedDataDidBecomeAvailableNotification).sink { [weak self] _ in
            Task { @MainActor in self?.contacts.reloadIdentity(); self?.configure(); self?.drainInbox() }
        }.store(in: &subscriptions)
        Timer.publish(every: 2, on: .main, in: .common).autoconnect().sink { [weak self] _ in
            guard let self else { return }
            self.saveRouteDiagnostic(); self.updateWaitingNotifications(); self.runDebugSend()
            self.link.discoverNearby(); self.additionalBle.tick()
            self.observeEncounters()
            // Already encrypted, signed packets do not require unlocked private keys.
            self.mesh?.retry()
            guard UIApplication.shared.isProtectedDataAvailable else { return }
            self.people?.tick(); try? self.quiz?.tick(); self.publishQuiz(); try? self.party?.tick(); self.publishParty(); self.retryReadReceipts(); self.saveOrReport()
        }.store(in: &subscriptions)
        if let bytes = try? Data(contentsOf: inboxURL), bytes.count <= 3_000_000,
           let frames = try? JSONDecoder().decode([Data].self, from: bytes), frames.count <= 128 { inbox = frames }
    }
    private func updateBleRoute(up: Bool) {
        let handle = link.peopleHandle
        let usable = up && link.probeConfirmed
        if blePeopleHandle != (usable ? handle : nil), let old = blePeopleHandle { people?.link(old, up: false) }
        blePeopleHandle = usable ? handle : nil
        if usable, let handle { people?.link(handle, up: true) }
        _ = localRoutes.update(wifi: false, ready: up)
        localConnectionReady = localRoutes.available
        syncMeshLinks()
        if up { mesh?.retry() }
    }
    func retryLocalWifiAccess() {
        guard localWifiAccessBlocked, link.enabled, UserDefaults.standard.bool(forKey: "loka.wifi.explained") else { return }
        wifi.stop(); wifi.start()
    }
    func enableLocalWifi() {
        UserDefaults.standard.set(true, forKey: "loka.wifi.explained")
        if link.enabled { wifi.start() }
    }
    private func observeEncounters() {
        let peers = Set(nearbyPeople.filter { localHandles.contains($0.handle) }.map { $0.id })
        let observedAt = Int64(Date().timeIntervalSince1970 * 1000)
        encounterHistory.observe(peers, now: observedAt)
        #if DEBUG
        encounterTrace.observe(peers, now: observedAt)
        #endif
        guard encounterStorageAvailable, UIApplication.shared.isProtectedDataAvailable, let archive else { return }
        let now = Int64(Date().timeIntervalSince1970 * 1000), records = encounterHistory.saved(now: Int64(Date().timeIntervalSince1970 * 1000))
        guard records != savedEncounters else { return }
        do { try archive.saveEncounters(records, now: now); savedEncounters = records }
        catch { encounterStorageAvailable = false; meshEvent("Encounter history could not be saved; shadow tracking remains temporary") }
    }
    private var localHandles: Set<String> {
        var handles = Set(additionalBle.handles + applePeripheral.handles + wifi.handles)
        if aware.ready { handles.insert(aware.handle) }
        if link.probeConfirmed, let handle = blePeopleHandle { handles.insert(handle) }
        if debugBleOnly { handles = Set(handles.filter { $0.hasPrefix("ble:") }) }
        return handles
    }
    private func syncMeshLinks() {
        observeEncounters()
        mesh?.setLinks(localHandles)
        updateWaitingNotifications()
    }
    private func sendLocal(_ frame: Data, to handle: String, urgent: Bool) throws {
        guard !debugBleOnly || handle.hasPrefix("ble:") else { throw LokaProtocolError.invalid }
        if additionalBle.handles.contains(handle) { try additionalBle.send(frame, to: handle, urgent: urgent) }
        else if applePeripheral.handles.contains(handle) { try applePeripheral.send(frame, to: handle, urgent: urgent) }
        else if aware.ready && handle == aware.handle { try aware.send(frame) }
        else if wifi.handles.contains(handle) { try wifi.send(frame, to: handle) }
        else if link.probeConfirmed && handle == blePeopleHandle { try link.send(frame: frame, urgent: urgent) }
        else { throw LokaProtocolError.invalid }
    }
    private func configure() {
        guard !resetting, mesh == nil, UIApplication.shared.isProtectedDataAvailable, let identity = contacts.messageIdentity else { return }
        do {
            let storage = try MessageArchive(); let state = try storage.load()
            archive = storage; messages = state.messages; replyActions = state.replyActions
            do { try encounterHistory.restore(storage.loadEncounters(now: Int64(Date().timeIntervalSince1970 * 1000)), now: Int64(Date().timeIntervalSince1970 * 1000)) }
            catch { encounterStorageAvailable = false; meshEvent("Encounter history unavailable; shadow tracking remains temporary") }
            let directory = try NearbyPeople(crypto: LokaCrypto(identity: identity),
                name: { UserDefaults.standard.string(forKey: "loka.profile.displayName") ?? "LOKA user" },
                visible: { UserDefaults.standard.object(forKey: "loka.people.visible") as? Bool ?? true },
                send: { [weak self] handle, frame in
                    guard let self else { throw LokaProtocolError.invalid }
                    if self.additionalBle.handles.contains(handle) { try self.additionalBle.send(frame, to: handle, urgent: true) }
                    else if self.applePeripheral.handles.contains(handle) { try self.applePeripheral.send(frame, to: handle, urgent: true) }
                    else if handle == self.aware.handle && self.aware.ready { try self.aware.send(frame) }
                    else if self.wifi.handles.contains(handle) { try self.wifi.send(frame, to: handle) }
                    else if handle == self.blePeopleHandle && self.link.probeConfirmed { try self.link.send(frame: frame, urgent: true) }
                    else { throw LokaProtocolError.invalid }
                }, save: storage.saveNearby,
                authorize: { [weak self] key, name in
                    guard let self else { throw LokaProtocolError.invalid }
                    if !self.contacts.contacts.contains(where: { $0.publicKey == key }) { try self.contacts.add(key, name: name) }
                }, changed: { [weak self] profiles, requests in
                    let defaults=UserDefaults.standard
                    var avatars=(defaults.data(forKey:"loka.appearance.remoteAvatars").flatMap { try? JSONDecoder().decode([String:String].self,from:$0) }) ?? [:]
                    let friendIDs=Set(self?.contacts.contacts.map(\.id) ?? [])
                    avatars=avatars.filter { friendIDs.contains($0.key) }
                    for p in NearbyPeople.displayProfiles(profiles) where p.avatarShared && friendIDs.contains(p.id) { avatars[p.id]=p.avatarID }
                    let encoder=JSONEncoder(); encoder.outputFormatting = .sortedKeys
                    if let data=try? encoder.encode(avatars), data != defaults.data(forKey:"loka.appearance.remoteAvatars") { defaults.set(data,forKey:"loka.appearance.remoteAvatars") }
                    for p in profiles where p.carryVersion >= 3 && self?.contacts.contacts.contains(where: { $0.id == p.id }) == true { UserDefaults.standard.set(3, forKey: "carry-v3-" + p.id) }
                    self?.nearbyPeople = profiles; self?.chatRequests = requests; self?.mesh?.retry(); LocalNotifications.shared.syncRequests(requests) },
                avatar: { let selected=UserDefaults.standard.integer(forKey:"loka.appearance.avatar"); return "avatar_\(selected)" })
            directory.trusted = { [weak self] id in self?.contacts.contacts.contains { $0.id == id } == true }
            directory.typingChanged = { [weak self] id, until in
                guard let self else { return }; self.typingUntil = self.typingUntil.filter { $0.value > Int64(Date().timeIntervalSince1970 * 1000) }
                self.typingUntil[id] = until > 0 ? until : nil
            }
            directory.onFailure = { [weak self] in self?.notice = "Could not save chat requests. Your existing chats are safe." }
            do { try directory.restore(storage.loadNearby()); people = directory }
            catch { notice = "Could not open chat requests. Your existing chats are safe." }
            contacts.beforeRemove = { [weak self] id in guard let directory = self?.people else { throw LokaProtocolError.invalid }; try directory.block(id) }
            for handle in additionalBle.handles { people?.link(handle, up: true) }
            for handle in applePeripheral.handles { people?.link(handle, up: true) }
            if aware.ready { people?.link(aware.handle, up: true) }
            if let handle = blePeopleHandle { people?.link(handle, up: true) }
            for handle in wifi.handles { people?.link(handle, up: true) }
            mesh = LokaMesh(crypto: LokaCrypto(identity: identity), trusted: { [weak self] id in self?.contacts.contacts.contains { $0.id == id } == true },
                sendFrame: { _ in throw LokaProtocolError.invalid },
                message: { [weak self] packet, text in try self?.receiveContent(packet, text: text) },
                event: { [weak self] text in self?.meshEvent(text) }, retryDuplicates: true,
                sendTo: { [weak self] handle, frame, urgent in guard let self else { throw LokaProtocolError.invalid }; try self.sendLocal(frame, to: handle, urgent: urgent) }, saveCarry: storage.saveCarry)
            mesh?.routePreference = { handle in
                // Only break equal-backlog ties among links already ready and verified.
                handle.hasPrefix("wifi:") || handle.hasPrefix("aware:") ? 0 : 1
            }
            mesh?.routeLoad = { [weak self] handle in
                guard let self else { return 0 }
                if self.additionalBle.handles.contains(handle) { return self.additionalBle.queuedBytes(handle) }
                if self.applePeripheral.handles.contains(handle) { return self.applePeripheral.queuedBytes(handle) }
                if self.wifi.handles.contains(handle) { return self.wifi.queuedBytes(handle) }
                if handle == self.aware.handle { return self.aware.queuedBytes }
                return self.link.queuedBytes
            }
            people?.routeLoad = { [weak self] handle in self?.mesh?.routeLoad(handle) ?? 0 }
            people?.routePreference = { [weak self] handle in self?.mesh?.routePreference(handle) ?? 0 }
            mesh?.observeRoute = { [weak self] packet, handle, outgoing in self?.observeRoute(packet, handle: handle, outgoing: outgoing) }
            mesh?.carryPeer = { [weak self] handle in self?.nearbyPeople.first(where: { $0.handle == handle && $0.carryVersion >= 2 && $0.id != self?.debugExcludedPeer })?.id }
            mesh?.carryVersion = { [weak self] id in max(self?.contacts.contacts.contains(where: { $0.id == id }) == true ? UserDefaults.standard.integer(forKey: "carry-v3-" + id) : 0, self?.nearbyPeople.filter { $0.id == id }.map { $0.carryVersion }.max() ?? 0) }
            do {
                let catalog = try PartyCatalog.load(); partyHash = catalog.hash; partyGames = catalog.games
                mesh?.applicationPeer = { [weak self] id in
                    guard let self, !self.partyHash.isEmpty else { return false }
                    return self.nearbyPeople.contains { $0.id == id } || (self.partySession.map { $0.expires > Int64(Date().timeIntervalSince1970 * 1000) && $0.members.contains(id) } ?? false)
                }
                mesh?.applicationContent = { [weak self] id, text in self?.partyTraffic(id,text) == true }
                mesh?.applicationPacket = { [weak self] packet in self?.partyPackets[packet.id] == packet.destination }
                let game = try PartyCards(own: ContactCode.fingerprint(identity.publicKey), pack: catalog.hash, cards: catalog.games.flatMap(\.cards), clock: { Int64(Date().timeIntervalSince1970 * 1000) },
                    save: { [weak self] raw in
                        guard let self, !self.resetting, UIApplication.shared.isProtectedDataAvailable else { throw QuizError.invalid }
                        let keys = self.partyKeys.filter { self.party?.peers.contains($0.key) == true }
                        let data = try JSONEncoder().encode(PartyArchive(state: raw, keys: keys))
                        try storage.saveParty(String(decoding: data, as: UTF8.self))
                    }, send: { [weak self] id, text in
                        guard let self, !self.resetting, let mesh = self.mesh, try mesh.queued().count < 96,
                            let key = self.partyKeys[id] ?? self.nearbyPeople.first(where: { $0.id == id })?.key else { throw QuizError.invalid }
                        let event=try PartyEvent.decode(text)
                        let packet=try mesh.send(recipient:key,text:text,automatic:true,lifetimeMs:event.expires-Int64(Date().timeIntervalSince1970*1000))
                        self.traceParty(event,packet,true);return packet.id
                    }, discard: { [weak self] id in self?.mesh?.discard([id]) })
                party = game
                if let raw = try storage.loadParty() {
                    let saved = try JSONDecoder().decode(PartyArchive.self, from: Data(raw.utf8)); guard saved.keys.count <= 3 else { throw QuizError.invalid }
                    for (id, key) in saved.keys { try ContactCode.validate(key); guard ContactCode.fingerprint(key) == id else { throw QuizError.invalid } }
                    if stalePartyCatalog(saved.state,pack:catalog.hash){partyError="The saved nearby round uses an older card pack. Start a new round."}
                    else{try game.restore(saved.state);guard Set(saved.keys.keys).isSubset(of:game.peers) else{throw QuizError.invalid};partyKeys=saved.keys}
                }
                publishParty()
            } catch { party = nil; partyStatus = "Could not open saved cards. Existing data was preserved.";partyError=partyStatus }
            let carryFrames = try storage.loadCarry().filter { frame in
                let packet=try LokaPacket.decode(frame)
                return packet.source != ContactCode.fingerprint(identity.publicKey) || contacts.contacts.contains{$0.id==packet.destination} || partyPackets[packet.id]==packet.destination
            }
            try mesh?.restoreCarry(carryFrames)
            // Migrate only the sealed ciphertext queue while unlocked, preserving every frame.
            try storage.saveCarry(carryFrames)
            for frame in state.outbox where (try? LokaPacket.decode(frame).version) == 0 { try? mesh?.restore(frame) }
            _ = localRoutes.updateAdditional(ready: !additionalBle.handles.isEmpty)
            _ = localRoutes.updatePeripheral(ready: !applePeripheral.handles.isEmpty)
            _ = localRoutes.updateAware(ready: aware.ready)
            _ = localRoutes.update(wifi: false, ready: link.probeConfirmed)
            _ = localRoutes.update(wifi: true, ready: wifi.ready)
            localConnectionReady = localRoutes.available
            do {
                let (pack, hash) = try QuizPack.load()
                let game = try QuickQuiz(own: ContactCode.fingerprint(identity.publicKey), pack: hash, answers: pack.questions.map(\.answer),
                    clock: { Int64(Date().timeIntervalSince1970 * 1000) },
                    save: { [weak self] raw in
                        guard self?.resetting == false, UIApplication.shared.isProtectedDataAvailable else { throw QuizError.invalid }
                        try storage.saveGame(raw)
                    }, send: { [weak self] id, text in
                        guard let self, !self.resetting, let mesh = self.mesh, let contact = self.contacts.contacts.first(where: { $0.id == id }), QuickQuiz.canQueue(try mesh.queued().count) else { throw QuizError.invalid }
                        return try mesh.send(recipient: contact.publicKey, text: text, automatic: true, lifetimeMs: try GameEvent.decode(text).expires - Int64(Date().timeIntervalSince1970 * 1000)).id
                    }, discard: { [weak self] id in self?.mesh?.discard([id]) })
                if let raw = try storage.loadGame() { try game.restore(raw) }
                quiz = game; quizQuestions = pack.questions; publishQuiz()
            } catch { quizStatus = "Could not open saved games. Existing game data was preserved." }
            syncMeshLinks(); ready = true; drainInbox()
        } catch { mesh = nil; ready = false; contacts.error = error.localizedDescription }
    }
    func typing(_ id: String, active: Bool) { people?.typing(id, active: active) }
    func requestChat(_ id: String) {
        do { guard let people else { throw LokaProtocolError.invalid }; try people.request(id) }
        catch { notice = "Could not send the request. Please try again shortly." }
    }
    @discardableResult func decideChat(_ id: String, accept: Bool) -> Bool {
        guard let entry = chatRequests.first(where: { $0.request.id == id && !$0.outgoing && $0.phase == .incoming && $0.request.expires > Int64(Date().timeIntervalSince1970 * 1000) }) else {
            notice = "This request is no longer available."; return false
        }
        do {
            guard let people else { throw LokaProtocolError.invalid }
            try people.decide(id, accept: accept)
            if accept, contacts.contacts.contains(where: { $0.id == entry.peer }) { openFriend = entry.peer }
            return true
        } catch { notice = "Could not save your choice. Please try again."; return false }
    }
    func showNearbyName(_ value: Bool) { UserDefaults.standard.set(value, forKey: "loka.people.visible"); peopleVisible = value; people?.visibilityChanged() }
    private func receiveFrame(_ frame: Data, handle: String? = nil) {
        guard !resetting else { return }
        if NearbyPeople.controls(frame) {
            if UIApplication.shared.isProtectedDataAvailable, let handle { people?.receive(handle, frame) }
            return
        }
        // Verify ciphertext before locked-screen notification/storage; never decrypt a relay here.
        do {
            let packet = try LokaPacket.decode(frame); try packet.validate(now: Int64(Date().timeIntervalSince1970 * 1000)); try packet.verify()
            if packet.version > 0 { meshEvent("CARRY \(packet.id.prefix(8)) frame received hops=\(packet.hops) carrier=\(packet.carrier.prefix(8))") }
            if packet.version == 1 && packet.destination == contacts.publicKey.map(ContactCode.fingerprint) && packet.hops == 6 { meshEvent("CARRY \(packet.id.prefix(8)) direct bypass ignored"); return }
            guard let ownID = contacts.publicKey.map(ContactCode.fingerprint) else { return }
            if packet.destination != ownID {
                // Foreign payload admission never decrypts or reads private history.
                // The mesh verifies sender authorization and persists before forwarding.
                if mesh?.receive(frame, from: handle) != true {
                    meshEvent("CARRY \(packet.id.prefix(8)) relay admission unavailable")
                } else if !UIApplication.shared.isProtectedDataAvailable {
                    meshEvent("CARRY \(packet.id.prefix(8)) locked relay frame handled")
                }
                mesh?.retry()
                return
            }
            guard contacts.contacts.contains(where: { $0.id == packet.source }) else { return }
            if UIApplication.shared.isProtectedDataAvailable, mesh?.receive(frame, from: handle) == true { saveOrReport(); return }
            guard inbox.count < 128, !inbox.contains(frame) else { return }
            inbox.append(frame); try saveInbox()
            LocalNotifications.shared.show(friend: packet.source, name: "LOKA", id: packet.id, detail: "Local activity · unlock to check messages", allowReply: false)
        } catch { notice = "Could not verify or save an incoming message" }
    }
    private func saveInbox() throws {
        try FileManager.default.createDirectory(at: inboxURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(inbox).write(to: inboxURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var url = inboxURL; var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
    }
    private func drainInbox() {
        guard ready, UIApplication.shared.isProtectedDataAvailable else { return }
        inbox = inbox.filter { frame in
            guard let packet = try? LokaPacket.decode(frame), packet.expiresAt > Int64(Date().timeIntervalSince1970 * 1000) else { return false }
            return mesh?.receive(frame) != true
        }
        try? saveInbox(); saveOrReport()
    }
    @discardableResult func send(to contact: LokaContact, text: String, voice: Data? = nil, image: Data? = nil) async -> Bool {
        guard !sending.contains(contact.id) else { return false }
        sending.insert(contact.id); defer { sending.remove(contact.id) }
        do {
            guard ready, let mesh, UIApplication.shared.isProtectedDataAvailable else { throw ContactCodeError(text: "Unlock your iPhone to send messages") }
            guard contacts.contacts.contains(where: { $0.id == contact.id }) else { throw LokaProtocolError.invalid }
            let id = UUID().uuidString.lowercased()
            let parts: [ChatContent]
            guard voice == nil || image == nil else { throw LokaProtocolError.invalid }
            if let image { parts = try ChatContent.image(id: id, data: image) }
            else if let voice { parts = try ChatContent.voice(id: id, data: voice) }
            else {
                guard (1...1400).contains(text.utf8.count), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ContactCodeError(text: "This message is too long. Try a shorter one.") }
                parts = [ChatContent(kind: "T", id: id, data: Data(text.utf8))]
            }
            guard try mesh.queued().count + parts.count <= 120 else { throw ContactCodeError(text: "Your queue is full. Wait for a connection or message expiry.") }
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            try append(LokaMessage(id: id, friendID: contact.id, text: image?.base64EncodedString() ?? voice?.base64EncodedString() ?? text, outgoing: true, timestamp: now, expiresAt: now + 3_600_000, image: image != nil, voice: voice != nil))
            preparingMessageIDs.insert(id)
            defer { preparingMessageIDs.remove(id) }
            // Render the persisted bubble before RSA encryption/packet preparation.
            await Task.yield()
            var packetIDs: [String] = []
            for part in parts {
                packetIDs.append(try mesh.send(recipient: contact.publicKey, text: part.encode(), automatic: true).id)
                meshEvent("CARRY \(packetIDs.last!.prefix(8)) outgoing kind=\(part.kind) logical=\(id.prefix(8)) dst=\(contact.id.prefix(8))")
                if let index = messages.firstIndex(where: { $0.id == id }) { messages[index].packetIDs = packetIDs }
                try persist(); await Task.yield()
            }
            if let index = messages.firstIndex(where: { $0.id == id }) {
                messages[index].packetIDs = packetIDs
                messages[index].route = packetIDs.compactMap { routeCache[$0] }.last
                if messages[index].delivered { mesh.discard(packetIDs) }
            }
            try persist(); updateWaitingNotifications(); return true
        } catch { contacts.error = error.localizedDescription; return false }
    }
    private func updateWaitingNotifications() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let waiting = Set(messages.filter { $0.outgoing && !$0.delivered && $0.expiresAt > now }.map(\.friendID))
        for contact in contacts.contacts {
            if waiting.contains(contact.id) && !localConnectionReady {
                LocalNotifications.shared.waitingToSend(friend: contact.id, name: contact.name)
            } else { LocalNotifications.shared.clearWaiting(contact.id) }
        }
    }
    func markRead(_ id: String) {
        guard UIApplication.shared.applicationState == .active,
              let index = messages.firstIndex(where: { $0.id == id && !$0.outgoing }) else { return }
        guard LocalNotifications.shared.visibleFriend == messages[index].friendID else { return }
        if messages[index].readAt == nil {
            let previous = messages[index]; messages[index].readAt = Int64(Date().timeIntervalSince1970 * 1000)
            do { try persist() } catch { messages[index] = previous; return }
        }
        retryReadReceipts()
    }
    private func retryReadReceipts() {
        guard let mesh, UIApplication.shared.isProtectedDataAvailable else { return }
        let ids = messages.filter { !$0.outgoing && $0.readAt != nil && $0.readReceiptQueued != true }.prefix(4).map(\.id)
        for id in ids {
            guard let index = messages.firstIndex(where: { $0.id == id }), let contact = contacts.contacts.first(where: { $0.id == messages[index].friendID }) else { continue }
            do {
                guard try mesh.queued().count < 120 else { return }
                _ = try mesh.send(recipient: contact.publicKey, text: ChatContent(kind: "B", id: id, data: Data(String(messages[index].readAt!).utf8)).encode(), urgent: true, automatic: true)
                let previous = messages[index]; messages[index].readReceiptQueued = true
                do { try persist() } catch { messages[index] = previous; throw error }
            } catch { notice = "Read confirmation is waiting to send." }
        }
    }
    func react(to message: LokaMessage, emoji: String) {
        guard ChatContent.reactions.contains(emoji), let mesh,
              let contact = contacts.contacts.first(where: { $0.id == message.friendID }),
              let index = messages.firstIndex(where: { $0.id == message.id }) else { return }
        do {
            guard try mesh.queued().count < 120 else { throw LokaProtocolError.invalid }
            let id = UUID().uuidString.lowercased()
            let content = ChatContent(kind: "R", id: id, data: Data("\(message.id)|\(emoji)".utf8))
            let packet = try mesh.send(recipient: contact.publicKey, text: content.encode(), automatic: true)
            let previous = messages[index]
            messages[index].myReaction = "\(packet.createdAt)|\(id)|\(emoji)"
            messages[index].reactionPacket = packet.id
            do { try persist() } catch { messages[index] = previous; mesh.discard([packet.id]); throw error }
            if let old = previous.reactionPacket { mesh.discard([old]) }; try persist()
        } catch { notice = "Could not save your reaction. Try again." }
    }
    #if DEBUG
    private var partyTrace:[[String:Any]]=[]
    #endif
    private func traceParty(_ event:PartyEvent,_ packet:LokaPacket,_ outgoing:Bool) {
        #if DEBUG
        partyTrace.append(["timeMs":Int64(Date().timeIntervalSince1970*1000),"direction":outgoing ? "submitted" : "applied", "kind":event.kind,"event":event.id,"reference":event.ref,"revision":event.revision,"packet":packet.id,"transport":routeCache[packet.id]?.transport ?? "queued", "links":7-Int(packet.hops),"bytes":(try? packet.encode().count) ?? 0])
        partyTrace=Array(partyTrace.suffix(128))
        if let data=try? JSONSerialization.data(withJSONObject:partyTrace), let url=FileManager.default.urls(for:.cachesDirectory,in:.userDomainMask).first?.appendingPathComponent("loka-party-events.json") { try? data.write(to:url,options:[.atomic,.completeFileProtection]) }
        #endif
    }
    private func partyTraffic(_ id:String,_ text:String) -> Bool {
        PartyEvent.permitted(id,text,partyHash,partySession,Int64(Date().timeIntervalSince1970*1000))
    }
    private func publishParty() {
        guard let party else { return }
        partySession = party.session; partyCard = party.current; partyStatus = party.notice; partyCanAct = party.canAct; partyPaused = party.paused; partyPackets = party.packetPermissions()
    }
    private func partyAction(_ block: (PartyCards) throws -> Void) {
        do { guard let party else { throw QuizError.invalid }; try block(party);partyError=nil; publishParty() }
        catch { partyError = "Could not apply the card action. Check the turn or connection and try again." }
    }
    func inviteCards(_ players: [String], _ settings: PartySettings) {
        partyAction { game in
            guard (1...3).contains(players.count) else { throw QuizError.invalid }
            var keys: [String:Data] = [:]
            for id in players { guard let key = nearbyPeople.first(where: { $0.id == id })?.key else { throw QuizError.invalid }; keys[id] = key }
            let oldKeys = partyKeys; partyKeys = keys
            do { if let quiz, quiz.session?.phase != nil, quiz.session?.phase != "ended" { try quiz.end(); publishQuiz() }; try game.invite(players, settings) }
            catch { partyKeys = oldKeys; throw error }
        }
    }
    func acceptCards() { partyAction { if let quiz, quiz.session?.phase != nil, quiz.session?.phase != "ended" { try quiz.end(); publishQuiz() }; try $0.accept() } }
    func cardAction(_ kind: String) { partyAction { try $0.act(kind) } }
    func resumeCards() { partyAction { try $0.resume() } }
    func endCards() { partyAction { try $0.end() } }
    private func publishQuiz() {
        guard let quiz else { return }
        quizSession = quiz.session; quizStatus = quiz.notice; quizCanAnswer = quiz.canAnswer; quizPaused = quiz.paused
    }
    private func gameAction(_ block: (QuickQuiz) throws -> Void) {
        do { guard let quiz else { throw QuizError.invalid }; try block(quiz); publishQuiz() }
        catch { quizStatus = "Game action could not be applied. Check the invitation, turn or connection and try again." }
    }
    func inviteQuiz(_ id: String) { gameAction { guard !["active","lobby","joining"].contains(party?.session?.phase ?? "") else { throw QuizError.invalid }; try $0.invite(id) } }
    func acceptQuiz() { gameAction { try $0.accept() } }
    func answerQuiz(_ choice: Int) { gameAction { try $0.answer(choice) } }
    func resumeQuiz() { gameAction { try $0.resume() } }
    func endQuiz() { gameAction { try $0.end() } }
    private func receiveContent(_ packet: LokaPacket, text: String) throws {
        if text.hasPrefix("L1|G|2|") {
            guard let party else { throw QuizError.invalid }
            let oldKeys = partyKeys, event = try PartyEvent.decode(text)
            if event.kind == "I", event.session != party.session?.id {
                guard let key = nearbyPeople.first(where: { $0.id == packet.source })?.key ?? contacts.contacts.first(where: { $0.id == packet.source })?.publicKey,
                    ContactCode.fingerprint(key) == packet.source else { throw QuizError.invalid }
                partyKeys = [packet.source:key]
            }
            do { try party.receive(packet.source, text); publishParty(); traceParty(event,packet,false) } catch { partyKeys = oldKeys; throw error }; return
        }
        if text.hasPrefix("L1|G|") {
            guard let quiz else { throw QuizError.invalid }
            try quiz.receive(packet.source, text); publishQuiz(); return
        }
        let content = try ChatContent.decode(text)
        if let content, content.kind == "B" {
            guard let viewedAt = Int64(String(data: content.data, encoding: .utf8)!), viewedAt - 30_000 <= packet.createdAt else { throw LokaProtocolError.invalid }
            guard let index = messages.firstIndex(where: { $0.outgoing && $0.id == content.id && $0.friendID == packet.source }) else { return }
            let previous = messages[index]; messages[index].delivered = true
            messages[index].deliveredAt = min(messages[index].deliveredAt ?? packet.createdAt, packet.createdAt)
            messages[index].readAt = messages[index].readAt ?? viewedAt
            do { try persist() } catch { messages[index] = previous; throw error }
            mesh?.discard(messages[index].packetIDs); return
        }
        if let content, content.kind == "H" {
            guard let index = messages.firstIndex(where: { $0.outgoing && $0.id == content.id && $0.friendID == packet.source }), messages[index].reportedHops == nil else { return }
            let previous = messages[index]; messages[index].reportedHops = content.index
            do { try persist() } catch { messages[index] = previous; throw error }; return
        }
        if let content, content.kind == "R" {
            let fields = String(data: content.data, encoding: .utf8)!.components(separatedBy: "|")
            guard let index = messages.firstIndex(where: { $0.id == fields[0] && $0.friendID == packet.source }) else { return }
            let next = "\(packet.createdAt)|\(content.id)|\(fields[1])"
            if try ChatContent.newerReaction(messages[index].peerReaction, next) {
                let previous = messages[index]; messages[index].peerReaction = next
                do { try persist() } catch { messages[index] = previous; throw error }
            }
            acknowledge(packet.senderKey, id: content.id, carrier: packet.carrier, automatic: packet.version >= 2, returnVia: packet.grants.prefix(6 - Int(packet.hops)).reversed().map { $0.target }); return
        }
        if content?.kind == "A" {
            if let index = messages.firstIndex(where: { $0.friendID == packet.source && $0.myReaction?.components(separatedBy: "|").dropFirst().first == content!.id }) {
                let previous = messages[index]; messages[index].reactionPacket = nil
                do { try persist() } catch { messages[index] = previous; throw error }
                if let id = previous.reactionPacket { mesh?.discard([id]) }; try persist(); return
            }
            guard let index = messages.firstIndex(where: { $0.outgoing && content!.acknowledges(messageID: $0.id, recipient: $0.friendID, sender: packet.source) }) else { return }
            let previous = messages[index]; messages[index].delivered = true; messages[index].deliveredAt = min(messages[index].deliveredAt ?? packet.createdAt, packet.createdAt)
            do { try persist() } catch { messages[index] = previous; throw error }
            mesh?.discard(messages[index].packetIDs); return
        }
        let id = content?.id ?? packet.id
        if let saved = messages.first(where: { $0.id == id && $0.friendID == packet.source && !$0.outgoing }) {
            if content != nil { acknowledge(packet.senderKey, id: id, hops: saved.reportedHops, carrier: packet.carrier, automatic: packet.version >= 2, returnVia: packet.grants.prefix(6 - Int(packet.hops)).reversed().map { $0.target }) }; return
        }
        let voice = content?.kind == "V"
        let image = content?.kind == "I"
        let body: String
        if voice || image {
            guard let data = try assembly.accept(sender: packet.source, part: content!, expires: packet.expiresAt, now: Int64(Date().timeIntervalSince1970 * 1000)) else { return }
            body = data.base64EncodedString()
        } else { body = content.flatMap { String(data: $0.data, encoding: .utf8) } ?? text }
        try append(LokaMessage(id: id, friendID: packet.source, text: body, outgoing: false, timestamp: packet.createdAt, expiresAt: packet.expiresAt, image: image, voice: voice, reportedHops: 7 - Int(packet.hops), route: routeCache[packet.id]))
        let friend = contacts.contacts.first { $0.id == packet.source }
        if content != nil { acknowledge(packet.senderKey, id: id, hops: 7 - Int(packet.hops), carrier: packet.carrier, automatic: packet.version >= 2, returnVia: packet.grants.prefix(6 - Int(packet.hops)).reversed().map { $0.target }) }
        LocalNotifications.shared.show(friend: packet.source, name: friend?.name ?? "LOKA", id: id)
    }
    private func acknowledge(_ key: Data, id: String, hops: Int? = nil, carrier: String = "", automatic: Bool = false, returnVia: [String] = []) {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let sender = ContactCode.fingerprint(key)
        guard acknowledged.canCreate(sender: sender, message: id, now: now), let mesh else { return }
        do {
            // Retain for bounded retry/reconnect, just like other outgoing ciphertext.
            let receipt = try mesh.send(recipient: key, text: ChatContent(kind: "A", id: id).encode(), urgent: true, carrier: carrier, automatic: automatic, returnVia: returnVia)
            if let hops { _ = try? mesh.send(recipient: key, text: ChatContent(kind: "H", id: id, index: hops).encode(), carrier: carrier, automatic: automatic, returnVia: returnVia) }
            acknowledged.remember(sender: sender, message: id, deadline: receipt.expiresAt, now: now)
            try persist()
        } catch { notice = "Delivery confirmation is waiting to be saved or sent." }
    }
    private func append(_ message: LokaMessage) throws {
        if let existing = messages.first(where: { $0.id == message.id }) {
            guard existing.friendID == message.friendID && existing.outgoing == message.outgoing && existing.text == message.text && existing.voice == message.voice && (existing.image == true) == (message.image == true) else { throw LokaProtocolError.invalid }
            return
        }
        let previous = messages; messages = Array((messages + [message]).suffix(500))
        do { try persist() } catch { messages = previous; throw error }
    }
    private func persist() throws {
        guard !resetting, UIApplication.shared.isProtectedDataAvailable, let archive else { throw ContactCodeError(text: "Unlock to save messages") }
        let state = MessageArchive.State(messages: messages, outbox: try mesh?.queued() ?? [], replyActions: replyActions)
        guard state != lastSaved else { return }
        try archive.save(state); lastSaved = state
    }
    private func saveOrReport() { do { try persist() } catch { notice = "Could not save pending messages. Keep LOKA open and check free storage." } }
    func stopForReset() async {
        resetting = true; ready = false; quiz = nil; quizSession = nil; quizQuestions = []
        party = nil; partySession = nil; partyCard = nil; partyKeys = [:]; partyPackets = [:]; partyCanAct = false
        encounterHistory.clear(); encounterTrace.clear()
        subscriptions.removeAll()
        link.onAdditionalPeer = nil
        additionalBle.onDrain = nil; additionalBle.onFrame = nil; additionalBle.onReady = nil; additionalBle.stop()
        applePeripheral.onFrame = nil; applePeripheral.onReady = nil; applePeripheral.onDrain = nil; applePeripheral.stop()
        aware.stop(); aware.onFrame = nil; aware.onReady = nil
        wifi.onFrame = nil; wifi.onReady = nil; wifi.onDrain = nil; wifi.onPermissionBlocked = nil; wifi.stop()
        link.onFrame = nil; link.onLinkChanged = nil; link.onProbeConfirmed = nil; link.onTransferOpportunity = nil; link.stop()
        LocalNotifications.shared.decideRequest = nil; LocalNotifications.shared.reply = nil; LocalNotifications.shared.open = nil
        mesh = nil; archive = nil; lastSaved = nil; inbox = []; messages = []; openFriend = nil
        await contacts.stopForReset()
    }
    func forget(_ id: String) { mesh?.forget(id); messages.removeAll { $0.friendID == id }; saveOrReport(); LocalNotifications.shared.clear(id) }
}
