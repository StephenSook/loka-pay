import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Design tokens for the money screens (task 3.71, Lullabuy/ATLAS style). Hex values live here as
/// plain integers so a test can check every text-on-fill pair for contrast.
public enum LokaPalette {
    public static let paper: UInt32 = 0xFBF8F3
    public static let ink: UInt32 = 0x102A43
    /// Secondary text on paper (ink at about 75 percent on paper).
    public static let muted: UInt32 = 0x4B5E6F
    public static let card: UInt32 = 0xFFFFFF

    public static let pending: UInt32 = 0xFFB020
    public static let received: UInt32 = 0x9FE3E0
    /// Paid accent. Ink text only; white text goes on `paidStrong`.
    public static let paid: UInt32 = 0x1FA35B
    public static let paidStrong: UInt32 = 0x0F7A40
    public static let warningFill: UInt32 = 0xFFD9D7
    public static let warningBorder: UInt32 = 0xB4232A
    /// Failed accent. Decorative only; white text goes on `failedStrong`.
    public static let failed: UInt32 = 0xE5484D
    public static let failedStrong: UInt32 = 0xB4232A
    public static let white: UInt32 = 0xFFFFFF

    // Warm dark mode: deep brown paper, never pure black.
    public static let paperDark: UInt32 = 0x1F1A15
    public static let cardDark: UInt32 = 0x2A231C
    public static let inkDark: UInt32 = 0xF4EEE4
    public static let mutedDark: UInt32 = 0xC9BFB1
    public static let shadowDark: UInt32 = 0x0E0B08

    /// WCAG relative luminance of a 0xRRGGBB colour.
    public static func relativeLuminance(_ rgb: UInt32) -> Double {
        func channel(_ shift: UInt32) -> Double {
            let c = Double((rgb >> shift) & 0xff) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }

    /// WCAG contrast ratio, 1 to 21.
    public static func contrastRatio(_ a: UInt32, _ b: UInt32) -> Double {
        let (la, lb) = (relativeLuminance(a), relativeLuminance(b))
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }
}

/// SwiftUI colours built from the palette. Adaptive ones switch for dark mode.
public enum LokaColor {
    public static let paper = Color.loka(light: LokaPalette.paper, dark: LokaPalette.paperDark)
    public static let card = Color.loka(light: LokaPalette.card, dark: LokaPalette.cardDark)
    public static let ink = Color.loka(light: LokaPalette.ink, dark: LokaPalette.inkDark)
    public static let muted = Color.loka(light: LokaPalette.muted, dark: LokaPalette.mutedDark)
    public static let shadow = Color.loka(light: LokaPalette.ink, dark: LokaPalette.shadowDark)
    /// Ink that stays dark in both modes, for text on the light status fills.
    public static let inkFixed = Color(rgb: LokaPalette.ink)
    public static let white = Color(rgb: LokaPalette.white)
    public static let pending = Color(rgb: LokaPalette.pending)
    public static let received = Color(rgb: LokaPalette.received)
    public static let paid = Color(rgb: LokaPalette.paid)
    public static let paidStrong = Color(rgb: LokaPalette.paidStrong)
    public static let warningFill = Color(rgb: LokaPalette.warningFill)
    public static let warningBorder = Color(rgb: LokaPalette.warningBorder)
    public static let failed = Color(rgb: LokaPalette.failed)
    public static let failedStrong = Color(rgb: LokaPalette.failedStrong)
}

/// Shape and type tokens. System fonts with heavy display weights; a bundled display face is not
/// part of this package (custom fonts would need resources and a project change).
public enum LokaStyle {
    public static let cornerRadius: CGFloat = 22
    public static let borderWidth: CGFloat = 2.5
    public static let shadowOffset = CGSize(width: 4, height: 4)

    public static let display = Font.system(.largeTitle, design: .rounded, weight: .heavy)
    public static let title = Font.system(.title2, design: .rounded, weight: .heavy)
    public static let headline = Font.system(.headline, design: .rounded, weight: .heavy)
    public static let label = Font.system(.subheadline, design: .rounded, weight: .bold)
    public static let body = Font.system(.body)
    public static let caption = Font.system(.footnote)
    public static let mono = Font.system(.footnote, design: .monospaced)
}

extension Color {
    init(rgb: UInt32) {
        self.init(.sRGB, red: Double((rgb >> 16) & 0xff) / 255, green: Double((rgb >> 8) & 0xff) / 255,
                  blue: Double(rgb & 0xff) / 255, opacity: 1)
    }

    static func loka(light: UInt32, dark: UInt32) -> Color {
        func parts(_ rgb: UInt32) -> (CGFloat, CGFloat, CGFloat) {
            (CGFloat((rgb >> 16) & 0xff) / 255, CGFloat((rgb >> 8) & 0xff) / 255, CGFloat(rgb & 0xff) / 255)
        }
        #if canImport(UIKit)
        return Color(uiColor: UIColor { traits in
            let (r, g, b) = parts(traits.userInterfaceStyle == .dark ? dark : light)
            return UIColor(red: r, green: g, blue: b, alpha: 1)
        })
        #elseif canImport(AppKit)
        return Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let (r, g, b) = parts(isDark ? dark : light)
            return NSColor(srgbRed: r, green: g, blue: b, alpha: 1)
        })
        #else
        return Color(rgb: light)
        #endif
    }
}

/// The card look: ink border, continuous 22 pt corners, hard offset shadow.
struct LokaCardModifier: ViewModifier {
    var fill: Color = LokaColor.card
    var border: Color = LokaColor.ink

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: LokaStyle.cornerRadius, style: .continuous)
        return content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                ZStack {
                    shape.fill(LokaColor.shadow)
                        .offset(x: LokaStyle.shadowOffset.width, y: LokaStyle.shadowOffset.height)
                    shape.fill(fill)
                }
            }
            .overlay(shape.strokeBorder(border, lineWidth: LokaStyle.borderWidth))
    }
}

extension View {
    func lokaCard(fill: Color = LokaColor.card, border: Color = LokaColor.ink) -> some View {
        modifier(LokaCardModifier(fill: fill, border: border))
    }
}

/// A full-width primary button in the card style.
struct LokaButtonStyle: ButtonStyle {
    var fill: Color = LokaColor.ink
    var text: Color = LokaColor.paper

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        return configuration.label
            .font(LokaStyle.headline)
            .foregroundStyle(text)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 12)
            .background {
                ZStack {
                    shape.fill(LokaColor.shadow).offset(x: configuration.isPressed ? 1 : 3, y: configuration.isPressed ? 1 : 3)
                    shape.fill(fill)
                }
            }
            .overlay(shape.strokeBorder(LokaColor.ink, lineWidth: LokaStyle.borderWidth))
            .offset(x: configuration.isPressed ? 2 : 0, y: configuration.isPressed ? 2 : 0)
    }
}
