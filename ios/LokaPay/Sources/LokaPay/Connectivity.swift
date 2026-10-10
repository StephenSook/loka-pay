import Foundation
import Network

/// What the money screens show about the phone's internet path (task 2.15, the "No internet"
/// chip; task 3.53 builds the zero-bars meter on it). Derived from NWPathMonitor, so it reports
/// the system's own view, not a guess.
public enum InternetState: Equatable, Sendable {
    /// No usable internet path: airplane mode, or Wi-Fi and cellular both off or unusable.
    case none
    /// Internet through cellular (the gateway path the demo uses: never venue Wi-Fi).
    case cellular
    /// Internet through Wi-Fi or another non-cellular interface.
    case wifiOrOther

    /// Short label for the chip.
    public var label: String {
        switch self {
        case .none: return "No internet"
        case .cellular: return "Online (cellular)"
        case .wifiOrOther: return "Online (Wi-Fi)"
        }
    }

    /// VoiceOver text.
    public var accessibilityLabel: String {
        switch self {
        case .none: return "Zero bars, no internet"
        case .cellular: return "Online over cellular"
        case .wifiOrOther: return "Online over Wi-Fi"
        }
    }

    /// Pure mapping, so it can be tested without a radio: `satisfied` is
    /// `NWPath.status == .satisfied`; the flags are `usesInterfaceType(_:)` results.
    public static func from(satisfied: Bool, usesCellular: Bool) -> InternetState {
        guard satisfied else { return .none }
        return usesCellular ? .cellular : .wifiOrOther
    }
}

/// Publishes `InternetState` on the main queue. Start it when a money screen appears and stop
/// it when the screen goes away.
public final class ConnectivityMonitor: ObservableObject, @unchecked Sendable {
    @Published public private(set) var state: InternetState = .none
    /// When the state last changed (phone clock), for "Holding offline 0:42" style timers.
    @Published public private(set) var changedAt = Date()

    private var monitor: NWPathMonitor?
    private let queue = DispatchQueue(label: "us.zerobars.lokapay.connectivity")

    public init() {}

    public func start() {
        guard monitor == nil else { return }
        let m = NWPathMonitor()
        m.pathUpdateHandler = { [weak self] path in
            let next = InternetState.from(satisfied: path.status == .satisfied,
                                          usesCellular: path.usesInterfaceType(.cellular))
            DispatchQueue.main.async {
                guard let self, self.state != next else { return }
                self.state = next
                self.changedAt = Date()
            }
        }
        m.start(queue: queue)
        monitor = m
    }

    public func stop() {
        monitor?.cancel()
        monitor = nil
    }

    deinit { monitor?.cancel() }
}
