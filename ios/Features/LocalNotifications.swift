import Foundation
import UserNotifications
import UIKit

@MainActor final class LocalNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = LocalNotifications()
    var reply: ((String, String, String) async -> Bool)?
    var open: ((String) -> Void)?
    var decideRequest: ((String, Bool) -> Bool)?
    var visibleFriend: String?
    func configure() {
        let center = UNUserNotificationCenter.current(); center.delegate = self
        let reply = UNTextInputNotificationAction(identifier: "reply", title: "Reply", options: [.authenticationRequired], textInputButtonTitle: "Send", textInputPlaceholder: "Message")
        let accept = UNNotificationAction(identifier: "friend.accept", title: "Accept", options: [.foreground, .authenticationRequired])
        let decline = UNNotificationAction(identifier: "friend.decline", title: "Decline", options: [.authenticationRequired])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "message", actions: [reply], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "friend.request", actions: [accept, decline], intentIdentifiers: [], options: [])])
    }
    func syncRequests(_ requests: [ContactConsentBook.Entry]) {
        let pending = requests.filter { !$0.outgoing && $0.phase == .incoming }
        let ids = Set(pending.map { $0.request.id })
        let defaults = UserDefaults.standard
        let previous = Set(defaults.stringArray(forKey: "loka.notifications.requests") ?? [])
        let removed = previous.subtracting(ids).map { "request." + $0 }
        let center = UNUserNotificationCenter.current()
        center.removeDeliveredNotifications(withIdentifiers: removed)
        center.removePendingNotificationRequests(withIdentifiers: removed)
        for entry in pending where !previous.contains(entry.request.id) {
            let content = UNMutableNotificationContent()
            content.title = "Friend request"
            content.body = "\(entry.peerName) wants to chat with you."
            content.sound = .default; content.categoryIdentifier = "friend.request"
            content.userInfo = ["request": entry.request.id]
            center.add(UNNotificationRequest(identifier: "request." + entry.request.id, content: content, trigger: nil))
        }
        defaults.set(Array(ids).prefix(32).map { $0 }, forKey: "loka.notifications.requests")
    }
    func requestPermission() async { _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) }
    func show(friend: String, name: String, id: String, detail: String = "New message", allowReply: Bool = true) {
        if visibleFriend == friend && UIApplication.shared.applicationState == .active && detail == "New message" { return }
        let content = UNMutableNotificationContent(); content.title = name.isEmpty ? "LOKA" : name
        content.body = detail; content.sound = .default; content.threadIdentifier = friend
        content.categoryIdentifier = allowReply ? "message" : ""; content.userInfo = ["friend": friend, "message": id]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "chat." + friend, content: content, trigger: nil))
    }
    /// A neutral notice for an encrypted frame that cannot be read while the phone is locked. It names
    /// no contact and opens no chat: the frame may be a LOKA Pay text, not a message. Real messages
    /// get their own notification once LOKA reads them after unlock, which clears this one.
    func lockedActivity() {
        let content = UNMutableNotificationContent(); content.title = "LOKA"
        content.body = "Local activity. Unlock to check."; content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "locked.activity", content: content, trigger: nil))
    }
    func clearLockedActivity() { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["locked.activity"]) }
    private var waitingFriends = Set<String>()
    func waitingToSend(friend: String, name: String) {
        guard UIApplication.shared.applicationState != .active, waitingFriends.insert(friend).inserted else { return }
        let content = UNMutableNotificationContent()
        content.title = "Message waiting to send"
        content.body = "LOKA will retry when a local connection is available."
        content.threadIdentifier = friend; content.userInfo = ["friend": friend]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "waiting." + friend, content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 20, repeats: false)))
    }
    func clearWaiting(_ friend: String? = nil) {
        let friends = friend.map { [$0] } ?? Array(waitingFriends)
        let ids = friends.map { "waiting." + $0 }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
        friends.forEach { waitingFriends.remove($0) }
    }
    func clear(_ friend: String) { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["chat." + friend]) }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completion: @escaping (UNNotificationPresentationOptions) -> Void) {
        Task { @MainActor in
            let friend = notification.request.content.userInfo["friend"] as? String
            completion(friend != nil && visibleFriend == friend ? [] : [.banner, .sound])
        }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completion: @escaping () -> Void) {
        Task { @MainActor in
            defer { completion() }
            if let request = response.notification.request.content.userInfo["request"] as? String {
                if response.actionIdentifier == "friend.accept" || response.actionIdentifier == "friend.decline" {
                    _ = decideRequest?(request, response.actionIdentifier == "friend.accept")
                }
                return
            }
            guard let friend = response.notification.request.content.userInfo["friend"] as? String else { return }
            if let typed = response as? UNTextInputNotificationResponse {
                let token = (response.notification.request.content.userInfo["message"] as? String ?? response.notification.request.identifier) + ":reply"
                let saved = await reply?(friend, typed.userText, token) ?? false
                show(friend: friend, name: "LOKA", id: token, detail: saved ? "Reply queued · waiting for delivery" : "Reply not saved. Open LOKA to try again.", allowReply: false)
            } else if response.actionIdentifier == UNNotificationDefaultActionIdentifier { open?(friend) }
        }
    }
}
