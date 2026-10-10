import Testing
@testable import LokaPay

@Suite("internet state (2.15)")
struct ConnectivityTests {
    @Test("an unsatisfied path is no internet, whatever the interfaces say")
    func none() {
        #expect(InternetState.from(satisfied: false, usesCellular: true) == .none)
        #expect(InternetState.from(satisfied: false, usesCellular: false) == .none)
        #expect(InternetState.none.label == "No internet")
        #expect(InternetState.none.accessibilityLabel == "Zero bars, no internet")
    }

    @Test("a satisfied path names its interface")
    func online() {
        #expect(InternetState.from(satisfied: true, usesCellular: true) == .cellular)
        #expect(InternetState.from(satisfied: true, usesCellular: false) == .wifiOrOther)
    }

    @MainActor
    @Test("start and stop are idempotent")
    func monitorLifecycle() {
        let m = ConnectivityMonitor()
        m.start()
        m.start()
        #expect(m.isRunning)
        m.stop()
        m.stop()
        #expect(!m.isRunning)
    }

    @MainActor
    @Test("an update from a stopped or earlier run is dropped (Greptile)")
    func staleUpdatesDropped() {
        let m = ConnectivityMonitor()
        m.start()          // run 1
        m.stop()
        m.apply(.cellular, run: 1)
        #expect(m.state == .none, "stopped monitor published an old update")
        m.start()          // run 3 (stop advanced the generation)
        m.apply(.cellular, run: 1)
        #expect(m.state == .none, "restarted monitor published an update from an earlier run")
        m.apply(.cellular, run: 3)
        #expect(m.state == .cellular)
        m.stop()
    }
}
