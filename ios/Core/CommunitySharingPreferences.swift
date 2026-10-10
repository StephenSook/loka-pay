import Foundation

struct CommunitySharingLimit: Codable {
    var selection = "Unlimited"
    var custom = ""
    var unit = "MB"
    var error: String? {
        if selection == "Unlimited" { return nil }
        let presets = ["50 MB", "100 MB", "500 MB", "1 GB", "5 GB"]
        if presets.contains(selection) { return nil }
        guard selection == "Custom", ["MB", "GB"].contains(unit) else { return "Choose a sharing limit." }
        guard custom.range(of: #"^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$"#, options: .regularExpression) != nil,
              let amount = Decimal(string: custom, locale: Locale(identifier: "en_US_POSIX")), amount > 0 else { return "Enter a positive number." }
        let bytes = amount * Decimal(unit == "GB" ? 1_000_000_000 : 1_000_000)
        let number = NSDecimalNumber(decimal: bytes)
        guard bytes <= Decimal(Int64.max), bytes >= 1, NSDecimalNumber(value: number.int64Value).compare(number) == .orderedSame else { return "Enter a positive limit within the supported range." }
        return nil
    }
    var label: String { ["Unlimited", "Custom"].contains(selection) ? selection : "\(selection) / month" }
}

struct CommunitySharingPreferences: Codable {
    var enabled = true
    var wifi = true
    var mobile = false
    var wifiLimit = CommunitySharingLimit()
    var mobileLimit = CommunitySharingLimit(selection: "100 MB")
    var error: String? {
        if !enabled { return nil }
        if !wifi && !mobile { return "Choose Wi-Fi or mobile data, or turn community sharing off." }
        if wifi, let error = wifiLimit.error { return error }
        if mobile && mobileLimit.selection == "Unlimited" { return "Choose a mobile data limit." }
        return mobile ? mobileLimit.error : nil
    }
    static func load() -> Self {
        guard let data = UserDefaults.standard.data(forKey: "loka.communitySharing.preferences"), let value = try? JSONDecoder().decode(Self.self, from: data) else { return Self() }
        return value
    }
}
