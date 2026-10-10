import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Keeps the phone's screen on while a money screen is shown (task 2.23), so a merchant phone left
/// on the counter does not lock in the middle of a payment. Holds are counted: during a tab switch
/// the new screen may appear before the old one goes, and the screen still never turns off early.
/// When the last hold goes, the setting found before the first one comes back, so an app that keeps
/// the screen on for its own reasons keeps it on.
@MainActor
public final class ScreenAwake {
    /// The phone's own setting (`UIApplication.isIdleTimerDisabled`). Off UIKit (macOS tests) it
    /// reads false and writes nothing.
    public static let shared = ScreenAwake(read: ScreenAwake.systemValue, write: ScreenAwake.setSystemValue)

    private let read: @MainActor () -> Bool
    private let write: @MainActor (Bool) -> Void
    private var holders = 0
    private var before = false

    init(read: @escaping @MainActor () -> Bool, write: @escaping @MainActor (Bool) -> Void) {
        self.read = read
        self.write = write
    }

    /// True while at least one screen holds the screen on.
    public var isHeld: Bool { holders > 0 }

    public func hold() {
        if holders == 0 {
            before = read()
            write(true)
        }
        holders += 1
    }

    /// An unmatched release changes nothing.
    public func release() {
        guard holders > 0 else { return }
        holders -= 1
        if holders == 0 { write(before) }
    }

    private static func systemValue() -> Bool {
        #if canImport(UIKit)
        return UIApplication.shared.isIdleTimerDisabled
        #else
        return false
        #endif
    }

    private static func setSystemValue(_ disabled: Bool) {
        #if canImport(UIKit)
        UIApplication.shared.isIdleTimerDisabled = disabled
        #endif
    }
}

/// Holds `ScreenAwake.shared` while the view is on screen. Each view holds at most once, so a
/// repeated appear never leaves the screen on after it goes.
struct KeepsScreenAwake: ViewModifier {
    @State private var holding = false

    func body(content: Content) -> some View {
        content
            .onAppear {
                guard !holding else { return }
                ScreenAwake.shared.hold()
                holding = true
            }
            .onDisappear {
                guard holding else { return }
                ScreenAwake.shared.release()
                holding = false
            }
    }
}

extension View {
    /// Keeps the screen on while this view is shown (money screens, task 2.23).
    func keepsScreenAwake() -> some View { modifier(KeepsScreenAwake()) }
}
