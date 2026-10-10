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

    @Test("the monitor starts and stops without crashing")
    func monitorLifecycle() {
        let m = ConnectivityMonitor()
        m.start()
        m.start()
        m.stop()
        m.stop()
    }
}
