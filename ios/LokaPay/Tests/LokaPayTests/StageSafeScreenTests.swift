import Foundation
import SwiftUI
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

@Suite("Stage-safe merchant screens (2.23)")
@MainActor
struct StageSafeScreenTests {
    /// A defaults domain of its own, so nothing leaks between tests or into the app's settings.
    func domain() -> (name: String, defaults: UserDefaults) {
        let name = "LokaPayTests.tab." + UUID().uuidString
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return (name, defaults)
    }

    func dependencies() -> LokaPayDependencies {
        LokaPayDependencies(deployment: F.deployment, serverPublicKey: F.serverKey, signer: SoftwareP256Signer(),
                            allowanceWire: nil, merchantWire: nil,
                            serials: SerialReservations(url: F.tempURL("serials.json")),
                            ledger: OfflineLedger(url: F.tempURL("ledger.json")),
                            settlementClient: nil, connectivity: ConnectivityMonitor())
    }

    /// The rendered height in points when offered a 390 pt phone width.
    func height(_ view: some View) throws -> Int {
        let renderer = ImageRenderer(content: view)
        renderer.proposedSize = ProposedViewSize(width: 390, height: nil)
        renderer.scale = 1
        let image = try #require(renderer.cgImage)
        return image.height
    }

    // MARK: (a) the Pay/Receive switch remembers the last tab

    @Test("the switch comes back on the last tab after a relaunch, and on Pay the first time")
    func remembersTheTab() {
        let (name, defaults) = domain()
        defer { defaults.removePersistentDomain(forName: name) }
        let first = LokaPayTabMemory(defaults: defaults)
        #expect(first.initialTab(requested: nil) == .pay, "nothing saved yet: Pay, as before")
        first.save(.receive)
        // A relaunch: a new memory over the same stored domain.
        let relaunched = LokaPayTabMemory(defaults: UserDefaults(suiteName: name)!)
        #expect(relaunched.load() == .receive)
        #expect(relaunched.initialTab(requested: nil) == .receive)
        relaunched.save(.pay)
        #expect(LokaPayTabMemory(defaults: UserDefaults(suiteName: name)!).initialTab(requested: nil) == .pay)
    }

    @Test("a tab the app asks for wins over the saved one; an unreadable saved value falls back to Pay")
    func requestedTabAndUnreadableValue() {
        let (name, defaults) = domain()
        defer { defaults.removePersistentDomain(forName: name) }
        let memory = LokaPayTabMemory(defaults: defaults)
        memory.save(.receive)
        #expect(memory.initialTab(requested: .pay) == .pay)
        defaults.set("Wallet", forKey: LokaPayTabMemory.key)
        #expect(memory.load() == nil)
        #expect(memory.initialTab(requested: nil) == .pay)
    }

    @Test("the home view's switch shows the remembered tab, or the tab the app asks for (Greptile P2)")
    func homeViewOpensOnTheRememberedTab() {
        let (name, defaults) = domain()
        defer { defaults.removePersistentDomain(forName: name) }
        let memory = LokaPayTabMemory(defaults: defaults)
        /// The tab the switch shows, which must be the one the view computed.
        func shown(_ view: LokaPayHomeView) -> LokaPayHomeView.Tab {
            #expect(view.selectedTab == view.openingTab)
            return view.selectedTab
        }
        #expect(shown(LokaPayHomeView(dependencies: dependencies(), tabMemory: memory)) == .pay)
        memory.save(.receive)
        #expect(shown(LokaPayHomeView(dependencies: dependencies(), tabMemory: memory)) == .receive)
        #expect(shown(LokaPayHomeView(dependencies: dependencies(), startOn: .pay, tabMemory: memory)) == .pay)
        memory.save(.pay)
        #expect(shown(LokaPayHomeView(dependencies: dependencies(), startOn: .receive, tabMemory: memory)) == .receive)
        #expect(shown(LokaPayHomeView(dependencies: dependencies(), tabMemory: memory)) == .pay)
    }

    // MARK: (b) the screen stays awake on money screens

    @Test("the screen stays awake while any money screen holds it; the last to go puts back the earlier setting")
    func screenAwakeIsCounted() {
        var system = false
        var writes: [Bool] = []
        let awake = ScreenAwake(read: { system }, write: { system = $0; writes.append($0) })
        awake.hold()
        #expect(system)
        #expect(awake.isHeld)
        // A tab switch where the new screen appears before the old one goes.
        awake.hold()
        awake.release()
        #expect(system, "one money screen is still shown")
        awake.release()
        #expect(!system, "back to the setting found before")
        #expect(!awake.isHeld)
        awake.release()  // an unmatched release changes nothing
        #expect(writes == [true, false])
        // An app that already kept the screen on keeps it on afterwards.
        system = true
        awake.hold()
        awake.release()
        #expect(system)
    }

    // MARK: (c) the holding clock stays until settled, then freezes into the receipt line

    @Test("the holding clock stays on the Received card when signal returns, on every internet path")
    func holdingClockStaysOnline() throws {
        let since = Date().addingTimeInterval(-65)
        for internet in [InternetState.none, .cellular, .wifiOrOther] {
            #expect(ZeroBarsMeter.showsHoldingClock(internet: internet, holdingSince: since), "\(internet)")
            #expect(!ZeroBarsMeter.showsHoldingClock(internet: internet, holdingSince: nil), "\(internet)")
            let with = try height(ZeroBarsMeter(internet: internet, holdingSince: since, bluetoothOn: true))
            let without = try height(ZeroBarsMeter(internet: internet, bluetoothOn: true))
            #expect(with > without, "\(internet): the clock line is drawn (\(with) pt with it, \(without) pt without)")
        }
    }

    @Test("once a verified CONF lands, the clock gives way to the receipt's Held offline line from the signed times")
    func clockFreezesIntoTheReceiptLine() async throws {
        let payer = SoftwareP256Signer()
        let merchant = SoftwareP256Signer()
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        // The ACK signs F.now (1_800_000_000); the server uploaded the note 65 s later.
        let conf = F.confWire(noteId: note.noteId, status: 1, blockTime: 1_800_000_067, uploadedAt: 1_800_000_065)
        let stub = StubTransport([StubReply(status: 200, body: F.decisionBody(conf: conf, noteId: note.noteId,
                                                                              jsonStatus: "settled"))])
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: OfflineLedger(url: F.tempURL("ledger.json")),
                                 settlementClient: APIFixtures.client(stub, retry: .never), deployment: F.deployment,
                                 serverPublicKey: F.serverKey, now: { F.now })
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        await model.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(model.phase == .received, "the Received card, with its ticking clock")
        await model.settle()
        #expect(model.phase == .settled, "the Received card and its clock are gone")
        let facts = try #require(model.settlement).facts(clusterId: F.deployment.clusterId)
        #expect(facts.timingLines.first == "Held offline 1:05 (server clock minus the merchant phone's clock)")
    }
}
