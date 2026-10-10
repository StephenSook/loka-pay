import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Full screen brightness while a payment code is on screen, so the other phone's camera gets a
/// bright code on its white card (also in dark mode). Holds are counted like `ScreenAwake`'s: two
/// codes overlapping in a transition never dim the screen early. When the last hold goes, the
/// brightness found before the first one comes back, unless the person changed it meanwhile (in
/// Control Center), which is then left as they set it.
@MainActor
public final class ScreenBrightness {
    /// The phone's own brightness (`UIScreen.brightness` of the active scene's screen). Off UIKit
    /// (macOS tests), or with no screen, it reads nil and nothing is written.
    public static let shared = ScreenBrightness(read: ScreenBrightness.systemValue, write: ScreenBrightness.setSystemValue)

    static let full = 1.0

    private let read: @MainActor () -> Double?
    private let write: @MainActor (Double) -> Void
    private var holders = 0
    private var before: Double?

    init(read: @escaping @MainActor () -> Double?, write: @escaping @MainActor (Double) -> Void) {
        self.read = read
        self.write = write
    }

    /// True while at least one payment code holds the brightness up.
    public var isHeld: Bool { holders > 0 }

    public func hold() {
        if holders == 0 {
            before = read()
            if before != nil { write(Self.full) }
        }
        holders += 1
    }

    /// An unmatched release changes nothing.
    public func release() {
        guard holders > 0 else { return }
        holders -= 1
        guard holders == 0, let earlier = before else { return }
        before = nil
        if let now = read(), abs(now - Self.full) < 0.01 { write(earlier) }
    }

    #if canImport(UIKit)
    private static func screen() -> UIScreen? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return (scenes.first { $0.activationState == .foregroundActive } ?? scenes.first)?.screen
    }
    #endif

    private static func systemValue() -> Double? {
        #if canImport(UIKit)
        return screen().map { Double($0.brightness) }
        #else
        return nil
        #endif
    }

    private static func setSystemValue(_ value: Double) {
        #if canImport(UIKit)
        screen()?.brightness = CGFloat(value)
        #endif
    }
}

/// Holds `ScreenBrightness.shared` while the view is on screen and the app is in the foreground.
/// Leaving the app gives the brightness back, so it never stays raised behind another app; coming
/// back with the code still shown raises it again. Each view holds at most once. With `enabled`
/// false it holds nothing.
struct RaisesScreenBrightness: ViewModifier {
    var enabled = true
    @Environment(\.scenePhase) private var scenePhase
    @State private var shown = false
    @State private var holding = false

    func body(content: Content) -> some View {
        content
            .onAppear {
                shown = true
                sync(shown: true, phase: scenePhase)
            }
            .onDisappear {
                shown = false
                sync(shown: false, phase: scenePhase)
            }
            .onChange(of: scenePhase) { _, phase in sync(shown: shown, phase: phase) }
            .onChange(of: enabled) { sync(shown: shown, phase: scenePhase) }
    }

    /// Brightness is raised only for an enabled code that is on screen in the foreground.
    static func wanted(enabled: Bool, shown: Bool, phase: ScenePhase) -> Bool {
        enabled && shown && phase == .active
    }

    private func sync(shown: Bool, phase: ScenePhase) {
        let wanted = Self.wanted(enabled: enabled, shown: shown, phase: phase)
        if wanted, !holding {
            ScreenBrightness.shared.hold()
            holding = true
        } else if !wanted, holding {
            ScreenBrightness.shared.release()
            holding = false
        }
    }
}

extension View {
    /// Full screen brightness while this view is shown (payment codes), when `enabled`.
    func raisesScreenBrightness(_ enabled: Bool = true) -> some View { modifier(RaisesScreenBrightness(enabled: enabled)) }
}
