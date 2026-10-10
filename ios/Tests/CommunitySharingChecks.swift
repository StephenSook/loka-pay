import Foundation

@main struct CommunitySharingChecks {
    static func main() throws {
        let defaults = CommunitySharingPreferences()
        precondition(defaults.enabled && defaults.wifi && !defaults.mobile && defaults.error == nil)
        precondition(defaults.mobileLimit.selection == "100 MB")
        var draft = defaults
        draft.wifi = false
        precondition(draft.error == "Choose Wi-Fi or mobile data, or turn community sharing off.")
        draft.enabled = false
        precondition(draft.error == nil)
        for value in ["", "0", "-1", "NaN", "1e3", "999999999999999999999999", "0.0000001"] {
            precondition(CommunitySharingLimit(selection: "Custom", custom: value).error != nil)
        }
        precondition(CommunitySharingLimit(selection: "Custom", custom: "0.5", unit: "GB").error == nil)
        draft = defaults
        draft.wifiLimit = CommunitySharingLimit(selection: "Custom", custom: "")
        precondition(draft.error != nil)
        draft.enabled = false
        precondition(draft.error == nil)
        draft.mobile = true
        draft.mobileLimit.selection = "500 MB"
        let restored = try JSONDecoder().decode(CommunitySharingPreferences.self, from: JSONEncoder().encode(draft))
        precondition(!restored.enabled && restored.mobileLimit.selection == "500 MB" && restored.wifiLimit.selection == "Custom")
        print("Community sharing validation and persistence checks passed")
    }
}
