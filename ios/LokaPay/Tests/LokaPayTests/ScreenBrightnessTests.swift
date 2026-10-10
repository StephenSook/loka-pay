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

    @Test("a brightness set in Control Center stays when the app comes back, until the code leaves")
    func controlCenterChoiceStays() {
        let screen = FakeScreen()
        let brightness = screen.make()
        var code = BrightnessPresentation()
        code.sync(enabled: true, shown: true, phase: .active, brightness: brightness)
        #expect(screen.value == 1)
        // Opening Control Center makes the app inactive: the hold lets go.
        code.sync(enabled: true, shown: true, phase: .inactive, brightness: brightness)
        #expect(screen.value == 0.4)
        screen.value = 0.2  // the person lowers it
        code.sync(enabled: true, shown: true, phase: .active, brightness: brightness)
        #expect(screen.value == 0.2, "closing Control Center keeps the person's level")
        #expect(!brightness.isHeld)
        code.sync(enabled: true, shown: true, phase: .inactive, brightness: brightness)
        code.sync(enabled: true, shown: true, phase: .active, brightness: brightness)
        #expect(screen.value == 0.2)
        // The code leaves with the person's level untouched; the next presentation raises it again.
        code.sync(enabled: true, shown: false, phase: .active, brightness: brightness)
        #expect(screen.value == 0.2)
        code.sync(enabled: true, shown: true, phase: .active, brightness: brightness)
        #expect(screen.value == 1)
        code.sync(enabled: true, shown: false, phase: .active, brightness: brightness)
        #expect(screen.value == 0.2)
        #expect(screen.writes == [1, 0.4, 1, 0.2])
    }

    @Test("two codes through Control Center with no change both hold again, and the last to leave puts the level back")
    func controlCenterUntouched() {
        let screen = FakeScreen()
        let brightness = screen.make()
        var first = BrightnessPresentation()
        var second = BrightnessPresentation()
        for phase in [ScenePhase.active, .inactive, .active] {
            first.sync(enabled: true, shown: true, phase: phase, brightness: brightness)
            second.sync(enabled: true, shown: true, phase: phase, brightness: brightness)
        }
        #expect(first.holding && second.holding)
        #expect(screen.value == 1)
        first.sync(enabled: true, shown: false, phase: .active, brightness: brightness)
        #expect(screen.value == 1, "the second code is still shown")
        second.sync(enabled: true, shown: false, phase: .active, brightness: brightness)
        #expect(screen.value == 0.4)
        #expect(screen.writes == [1, 0.4, 1, 0.4])
    }

    @Test("back from another app or the lock screen, a code still shown raises the screen again")
    func backgroundTripRaisesAgain() {
        let screen = FakeScreen()
        let brightness = screen.make()
        var code = BrightnessPresentation()
        code.sync(enabled: true, shown: true, phase: .active, brightness: brightness)
        code.sync(enabled: true, shown: true, phase: .inactive, brightness: brightness)
        code.sync(enabled: true, shown: true, phase: .background, brightness: brightness)
        screen.value = 0.45  // the system's own level after unlocking
        code.sync(enabled: true, shown: true, phase: .inactive, brightness: brightness)
        code.sync(enabled: true, shown: true, phase: .active, brightness: brightness)
        #expect(screen.value == 1)
        code.sync(enabled: true, shown: false, phase: .active, brightness: brightness)
        #expect(screen.value == 0.45)
        #expect(screen.writes == [1, 0.4, 1, 0.45])
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
