import Foundation

struct LokaMessage: Identifiable, Codable, Equatable {
    let id: String
    let friendID: String
    let text: String
    let outgoing: Bool
    let timestamp: Int64
    let expiresAt: Int64
    var image: Bool? = nil
    var voice = false
    var delivered = false
    var deliveredAt: Int64? = nil
    var readAt: Int64? = nil
    var readReceiptQueued: Bool? = nil
    var reportedHops: Int? = nil
    var myReaction: String? = nil
    var peerReaction: String? = nil
    var reactionPacket: String? = nil
    var packetIDs: [String] = []
    var route: LocalRouteEvidence? = nil
}


/// Explicit 12-hour display, retaining the phone's local time zone.
func lokaMessageTime(_ timestamp: Int64) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "h:mm a"
    return formatter.string(from: Date(timeIntervalSince1970: Double(timestamp) / 1000))
}

/// Sender time first, then canonical ID for a stable equal-time order.
func lokaMessagePrecedes(_ a: LokaMessage, _ b: LokaMessage) -> Bool {
    a.timestamp == b.timestamp ? a.id < b.id : a.timestamp < b.timestamp
}

/// A local observation, never a remote custody or delivery claim.
struct LocalRouteEvidence: Codable, Equatable {
    let transport: String
    let carrier: String
    let at: Int64
    let expiresAt: Int64
    static func transport(_ handle: String?) -> String {
        guard let handle else { return "unknown" }
        if handle.hasPrefix("aware:") { return "aware" }
        if handle.hasPrefix("wifi:") { return "wifi" }
        if handle.hasPrefix("ble:") { return "ble" }
        return "unknown"
    }
    var valid: Bool { ["ble","wifi","aware","classic","unknown"].contains(transport) &&
        (carrier.isEmpty || (carrier.count == 64 && carrier.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) })) && at >= 0 && expiresAt >= 0 }
    var label: String {
        switch transport { case "ble": return "Bluetooth"; case "wifi": return "Local Wi-Fi"; case "aware": return "Wi-Fi Aware"; case "classic": return "Bluetooth Classic"; default: return "Transport not recorded" }
    }
}
