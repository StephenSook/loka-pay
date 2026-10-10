import SwiftUI
import Testing
@testable import LokaPay

@Suite("Full screen brightness while a payment code is shown")
@MainActor
struct ScreenBrightnessTests {
    /// A fake screen: its brightness and every write the class makes.
    @MainActor
    final class FakeScreen {
        var value: Double? = 0.4
        var writes: [Double] = []
        func make() -> ScreenBrightness {
            ScreenBrightness(read: { self.value }, write: { self.value = $0; self.writes.append($0) })
        }
    }

    @Test("a code raises the screen to full and the last one to go puts back the earlier brightness")
    func countedHolds() {
        let screen = FakeScreen()
        let brightness = screen.make()
        brightness.hold()
        #expect(screen.value == 1)
        #expect(brightness.isHeld)
        // Code 1 of 2 and code 2 of 2 overlap during a transition.
        brightness.hold()
        brightness.release()
        #expect(screen.value == 1, "one code is still shown")
        brightness.release()
        #expect(screen.value == 0.4)
        #expect(!brightness.isHeld)
        brightness.release()  // an unmatched release changes nothing
        #expect(screen.writes == [1, 0.4])
    }

    @Test("a brightness the person set while the code was up is left as they set it")
    func personChangedIt() {
        let screen = FakeScreen()
        let brightness = screen.make()
        brightness.hold()
        screen.value = 0.7  // Control Center
        brightness.release()
        #expect(screen.value == 0.7)
        #expect(screen.writes == [1])
    }

    @Test("with no screen to read, nothing is written")
    func noScreen() {
        let screen = FakeScreen()
        screen.value = nil
        let brightness = screen.make()
        brightness.hold()
        brightness.release()
        #expect(screen.writes.isEmpty)
    }

    @Test("brightness is wanted only for an enabled code on screen with the app active")
    func wanted() {
        #expect(RaisesScreenBrightness.wanted(enabled: true, shown: true, phase: .active))
        #expect(!RaisesScreenBrightness.wanted(enabled: true, shown: true, phase: .inactive))
        #expect(!RaisesScreenBrightness.wanted(enabled: true, shown: true, phase: .background))
        #expect(!RaisesScreenBrightness.wanted(enabled: true, shown: false, phase: .active))
        #expect(!RaisesScreenBrightness.wanted(enabled: false, shown: true, phase: .active))
    }
}
