import Accessibility
import SwiftUI

// MARK: - Money status

/// The status words on money screens. Each is shown as a word plus an SF Symbol, never colour alone.
/// A status is only ever derived from verified bytes (see `init(receipt:)`).
public enum MoneyStatus: Equatable, Sendable, CaseIterable {
    /// Signed and handed over; no verified merchant ack yet.
    case pending
    /// The merchant's ack verified (or this merchant accepted the note): not settled yet.
    case received
    /// A server-signed CONF says settled on chain.
    case paid
    /// A server-signed CONF says failed on chain (or refused).
    case failed
    /// A second valid note from the same payer on the same serial (PAYMENT-V1 section 4.9).
    case conflictingSpend

    /// From a receipt whose note, ack and CONF all verified. With no CONF the merchant has
    /// acknowledged it, so it reads Received; the CONF status alone decides Paid or Failed.
    public init(receipt: VerifiedReceipt) {
        switch receipt.status {
        case .pending: self = .received
        case .settled: self = .paid
        case .failedOnChain, .refusedOffChain: self = .failed
        }
    }

    public var word: String {
        switch self {
        case .pending: return "Pending"
        case .received: return "Received"
        case .paid: return "Paid"
        case .failed: return "Failed"
        case .conflictingSpend: return "Conflicting spend seen"
        }
    }

    public var symbol: String {
        switch self {
        case .pending: return "clock.fill"
        case .received: return "tray.and.arrow.down.fill"
        case .paid: return "checkmark.seal.fill"
        case .failed: return "xmark.octagon.fill"
        case .conflictingSpend: return "exclamationmark.triangle.fill"
        }
    }

    public var accessibilityLabel: String {
        switch self {
        case .pending: return "Status: pending, waiting for the merchant. Sandbox."
        case .received: return "Status: received, not settled yet. Sandbox."
        case .paid: return "Status: paid on Solana devnet. Sandbox."
        case .failed: return "Status: failed. Sandbox."
        case .conflictingSpend: return "Warning: conflicting spend seen for this payer's serial."
        }
    }

    /// Fill and text colours as palette values; every pair is checked for contrast in tests.
    public var fillHex: UInt32 {
        switch self {
        case .pending: return LokaPalette.pending
        case .received: return LokaPalette.received
        case .paid: return LokaPalette.paidStrong
        case .failed: return LokaPalette.failedStrong
        case .conflictingSpend: return LokaPalette.warningFill
        }
    }

    public var textHex: UInt32 {
        switch self {
        case .pending, .received, .conflictingSpend: return LokaPalette.ink
        case .paid, .failed: return LokaPalette.white
        }
    }

    var borderColor: Color {
        self == .conflictingSpend ? LokaColor.warningBorder : LokaColor.ink
    }
}

public struct MoneyStatusChip: View {
    let status: MoneyStatus
    var large = false
    /// Words after the status in brackets, such as "already spent" (from verified bytes only).
    var detail: String?

    public init(_ status: MoneyStatus, large: Bool = false, detail: String? = nil) {
        self.status = status
        self.large = large
        self.detail = detail
    }

    /// "Failed (already spent)" with a detail, else the status word alone.
    public static func word(_ status: MoneyStatus, detail: String?) -> String {
        detail.map { status.word + " (" + $0 + ")" } ?? status.word
    }

    public static func accessibilityLabel(_ status: MoneyStatus, detail: String?) -> String {
        detail.map { "Status: " + status.word.lowercased() + ", " + $0 + ". Sandbox." } ?? status.accessibilityLabel
    }

    public var body: some View {
        Label(Self.word(status, detail: detail), systemImage: status.symbol)
            .font(large ? LokaStyle.title : LokaStyle.label)
            .foregroundStyle(Color(rgb: status.textHex))
            .padding(.horizontal, large ? 18 : 12)
            .padding(.vertical, large ? 10 : 6)
            .background(Capsule().fill(Color(rgb: status.fillHex)))
            .overlay(Capsule().strokeBorder(status.borderColor, lineWidth: LokaStyle.borderWidth))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.accessibilityLabel(status, detail: detail))
    }
}

// MARK: - Internet chip (task 2.15)

/// The "No internet" chip. `InternetState` comes from `ConnectivityMonitor` (NWPathMonitor).
public struct NoInternetChip: View {
    let state: InternetState

    public init(state: InternetState) { self.state = state }

    public var body: some View {
        Label(state.label, systemImage: Self.symbol(state))
            .font(LokaStyle.label)
            .foregroundStyle(LokaColor.inkFixed)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(state == .none ? LokaColor.warningFill : LokaColor.received))
            .overlay(Capsule().strokeBorder(state == .none ? LokaColor.warningBorder : LokaColor.ink,
                                            lineWidth: LokaStyle.borderWidth))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(state.accessibilityLabel)
    }

    static func symbol(_ state: InternetState) -> String {
        switch state {
        case .none: return "wifi.slash"
        case .cellular: return "antenna.radiowaves.left.and.right"
        case .wifiOrOther: return "wifi"
        }
    }
}

/// The chip bound to a live monitor. The screen that shows it starts and stops the monitor.
public struct LiveNoInternetChip: View {
    @ObservedObject var monitor: ConnectivityMonitor

    public init(monitor: ConnectivityMonitor) { self.monitor = monitor }

    public var body: some View { NoInternetChip(state: monitor.state) }
}

// MARK: - Zero-bars meter and offline clock (task 3.53)

/// "Holding offline m:ss" since a received-at time (phone clock).
public enum HoldingClock {
    /// Minutes are not capped at 59 ("72:05"). A negative span (clock moved back) reads 0:00.
    public static func format(seconds: Int) -> String {
        let s = max(0, seconds)
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    public static func label(since start: Date, now: Date) -> String {
        "Holding offline " + format(seconds: Int(now.timeIntervalSince(start).rounded(.down)))
    }
}

/// Four empty signal bars when the phone has no internet path. NWPathMonitor reports reachability,
/// not signal strength, so online the meter shows the path name and never invents bars.
/// The Bluetooth clause appears only when the caller reports Bluetooth state (this package does not
/// read the radio; the mesh layer does).
public struct ZeroBarsMeter: View {
    let internet: InternetState
    let holdingSince: Date?
    let bluetoothOn: Bool?

    public init(internet: InternetState, holdingSince: Date? = nil, bluetoothOn: Bool? = nil) {
        self.internet = internet
        self.holdingSince = holdingSince
        self.bluetoothOn = bluetoothOn
    }

    public static func offlineText(bluetoothOn: Bool?) -> String {
        switch bluetoothOn {
        case true?: return "Zero bars: no Wi-Fi, no cellular, Bluetooth on"
        case false?: return "Zero bars: no Wi-Fi, no cellular, Bluetooth off"
        case nil: return "Zero bars: no Wi-Fi, no cellular"
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if internet == .none {
                HStack(alignment: .bottom, spacing: 12) {
                    HStack(alignment: .bottom, spacing: 4) {
                        ForEach(0..<4, id: \.self) { i in
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .strokeBorder(LokaColor.ink, lineWidth: 2)
                                .frame(width: 8, height: CGFloat(8 + i * 6))
                        }
                    }
                    .accessibilityHidden(true)
                    Text(Self.offlineText(bluetoothOn: bluetoothOn))
                        .font(LokaStyle.label)
                        .foregroundStyle(LokaColor.ink)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(internet.accessibilityLabel)
                if let holdingSince {
                    TimelineView(.periodic(from: holdingSince, by: 1)) { context in
                        Text(HoldingClock.label(since: holdingSince, now: context.date))
                            .font(LokaStyle.headline.monospacedDigit())
                            .foregroundStyle(LokaColor.ink)
                    }
                }
            } else {
                Label(internet.label, systemImage: NoInternetChip.symbol(internet))
                    .font(LokaStyle.label)
                    .foregroundStyle(LokaColor.ink)
                    .accessibilityLabel(internet.accessibilityLabel)
            }
        }
    }
}

// MARK: - Sandbox banner

public struct SandboxBanner: View {
    public static let text = "Sandbox: test tokens with no value"

    public init() {}

    public var body: some View {
        Label(Self.text, systemImage: "testtube.2")
            .font(LokaStyle.label)
            .foregroundStyle(LokaColor.inkFixed)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(LokaColor.pending))
            .overlay(Capsule().strokeBorder(LokaColor.ink, lineWidth: LokaStyle.borderWidth))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.text)
    }
}

// MARK: - Acceptance check chip and offline-risk line (task 3.27)

public enum LimitState: Equatable, Sendable {
    case withinLimit
    /// At or past 80 percent of the offline limit (a screen threshold, not a protocol rule).
    case nearLimit
    case conflictingSpend

    /// `unsettled` is this merchant's pending total for the allowance from the offline ledger.
    public static func from(unsettled: UInt64, offlineLimit: UInt64, conflict: Bool) -> LimitState {
        if conflict { return .conflictingSpend }
        return unsettled >= offlineLimit - offlineLimit / 5 ? .nearLimit : .withinLimit
    }

    public var word: String {
        switch self {
        case .withinLimit: return "Within local limit"
        case .nearLimit: return "Near limit"
        case .conflictingSpend: return "Conflicting spend seen"
        }
    }

    var symbol: String {
        switch self {
        case .withinLimit: return "checkmark.circle.fill"
        case .nearLimit: return "gauge.with.dots.needle.67percent"
        case .conflictingSpend: return "exclamationmark.triangle.fill"
        }
    }

    var fill: Color {
        switch self {
        case .withinLimit: return LokaColor.received
        case .nearLimit: return LokaColor.pending
        case .conflictingSpend: return LokaColor.warningFill
        }
    }

    /// The offline-risk line, always shown on the Receive screen (amounts from the verified
    /// certificate and the local ledger). A nil total means the ledger could not be read: the
    /// line says so rather than showing $0.00.
    public static func riskLine(unsettled: UInt64?, offlineLimit: UInt64, allowanceId: UInt64) -> String {
        guard let unsettled else {
            return "Unsettled total unavailable (the ledger could not be read). Allowance #\(allowanceId), "
                + "offline limit $\(Money.display(baseUnits: offlineLimit)). Sandbox."
        }
        return "Offline risk: this phone carries $\(Money.display(baseUnits: unsettled)) unsettled from allowance "
            + "#\(allowanceId), up to its $\(Money.display(baseUnits: offlineLimit)) offline limit, until it settles. Sandbox."
    }
}

public struct LimitChip: View {
    let state: LimitState

    public init(_ state: LimitState) { self.state = state }

    public var body: some View {
        Label(state.word, systemImage: state.symbol)
            .font(LokaStyle.label)
            .foregroundStyle(LokaColor.inkFixed)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(state.fill))
            .overlay(Capsule().strokeBorder(state == .conflictingSpend ? LokaColor.warningBorder : LokaColor.ink,
                                            lineWidth: LokaStyle.borderWidth))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(state.word)
    }
}

// MARK: - Error state (task 2.12)

/// Shows a named issue in plain words with the time it happened (phone clock). A failure is a
/// red "Stopped" card; a normal next step (`MoneyIssueKind.isStep`) is a neutral card.
public struct IssueBanner: View {
    let issue: MoneyIssue

    public init(_ issue: MoneyIssue) { self.issue = issue }

    /// The banner's heading.
    public static func title(for issue: MoneyIssue) -> String {
        issue.kind.isStep ? "Next step" : "Stopped: \(issue.name)"
    }

    /// What VoiceOver reads when the issue appears (plain words, no snake_case name).
    public static func announcement(for issue: MoneyIssue) -> String {
        (issue.kind.isStep ? "Next step. " : "Stopped. ") + issue.message
    }

    public var body: some View {
        let step = issue.kind.isStep
        VStack(alignment: .leading, spacing: 6) {
            Label(Self.title(for: issue), systemImage: step ? "arrow.right.circle.fill" : "exclamationmark.octagon.fill")
                .font(LokaStyle.label)
            Text(issue.message)
                .font(LokaStyle.body)
                .fixedSize(horizontal: false, vertical: true)
            Text("At \(issue.at.formatted(date: .omitted, time: .standard)) (this phone's clock)")
                .font(LokaStyle.caption)
        }
        .foregroundStyle(step ? LokaColor.ink : LokaColor.inkFixed)
        .lokaCard(fill: step ? LokaColor.card : LokaColor.warningFill, border: step ? LokaColor.ink : LokaColor.warningBorder)
        .accessibilityElement(children: .combine)
    }
}

extension View {
    /// Reads each new issue aloud with VoiceOver. A banner appearing on screen is not announced
    /// by itself, so without this a VoiceOver user would not hear that a step stopped.
    func announcesIssue(_ issue: MoneyIssue?) -> some View {
        onChange(of: issue) { (_: MoneyIssue?, new: MoneyIssue?) in
            guard let new else { return }
            AccessibilityNotification.Announcement(IssueBanner.announcement(for: new)).post()
        }
    }
}

/// A labelled number row used by the cards.
struct FactRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
            Spacer(minLength: 12)
            Text(value).font(LokaStyle.label).foregroundStyle(LokaColor.ink).multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
/// PREVIEW ONLY: every chip, meter and banner state, in light and dark.
private struct ComponentGallery: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                SandboxBanner()
                ForEach(MoneyStatus.allCases, id: \.self) { MoneyStatusChip($0) }
                MoneyStatusChip(.paid, large: true)
                NoInternetChip(state: .none)
                NoInternetChip(state: .cellular)
                NoInternetChip(state: .wifiOrOther)
                LimitChip(.withinLimit)
                LimitChip(.nearLimit)
                LimitChip(.conflictingSpend)
                Text(LimitState.riskLine(unsettled: 1_000_000, offlineLimit: 3_000_000, allowanceId: 1001))
                    .font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
                ZeroBarsMeter(internet: .none, holdingSince: Date().addingTimeInterval(-42), bluetoothOn: true)
                ZeroBarsMeter(internet: .none)
                ZeroBarsMeter(internet: .cellular)
                IssueBanner(MoneyIssue(.payment(.offlineLimit), at: PreviewFixtures.now))
                IssueBanner(MoneyIssue(.allowanceNeeded, at: PreviewFixtures.now))
                Button("Disabled button") {}.buttonStyle(LokaButtonStyle()).disabled(true)
            }
            .padding(16)
        }
        .background(LokaColor.paper)
    }
}

#Preview("Components") { ComponentGallery() }
#Preview("Components, dark") { ComponentGallery().preferredColorScheme(.dark) }
#endif
