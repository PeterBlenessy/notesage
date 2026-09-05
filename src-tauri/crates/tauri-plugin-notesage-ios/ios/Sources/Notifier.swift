import Foundation
import UIKit
import UserNotifications
import WebKit
import os.log

/// The app's one `UNUserNotificationCenterDelegate`, and the only place a
/// notification or badge is posted from. Tauri's notification plugin is not
/// registered on iOS: its delegate force-unwraps a map of the notifications
/// it scheduled itself, so a banner posted here, by the background task, or
/// tapped after a relaunch, would crash the app in it.
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()
    static let newItemsIdentifier = "inbox-new"
    private static let logger = OSLog(subsystem: "com.notesage.app", category: "notify")

    /// Where a cold tap should land once the frontend is up, consumed once.
    private(set) var pendingRoute: String?
    weak var webView: WKWebView?

    func install() {
        UNUserNotificationCenter.current().delegate = self
    }

    struct Status {
        let authorization: String
        let backgroundRefresh: String
        var asDictionary: [String: Any] {
            [
                "authorization": authorization,
                "backgroundRefresh": backgroundRefresh,
                "badge": InboxState.Prefs.badge,
                "newItems": InboxState.Prefs.newItems,
            ]
        }
    }

    private static func describe(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        default: return "authorized"  // authorized, provisional, ephemeral
        }
    }

    private static func describeRefresh() -> String {
        switch UIApplication.shared.backgroundRefreshStatus {
        case .available: return "available"
        case .denied: return "denied"
        default: return "restricted"
        }
    }

    func status(_ completion: @escaping (Status) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let auth = Notifier.describe(settings.authorizationStatus)
            DispatchQueue.main.async {
                completion(Status(authorization: auth, backgroundRefresh: Notifier.describeRefresh()))
            }
        }
    }

    /// The one system prompt. Badge and alert only — a read-later list does
    /// not ding.
    func request(_ completion: @escaping (Status) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.badge, .alert]) { _, error in
            if let error { os_log("authorization request failed: %{public}@", log: Notifier.logger, type: .error, String(describing: error)) }
            self.status(completion)
        }
    }

    /// The icon badge: the unread count when the preference is on, else 0.
    func setBadge(_ count: Int) {
        let shown = InboxState.Prefs.badge ? count : 0
        UNUserNotificationCenter.current().setBadgeCount(shown) { error in
            if let error { os_log("badge failed: %{public}@", log: Notifier.logger, type: .error, String(describing: error)) }
        }
    }

    /// One banner for everything unseen, replacing the delivered one. Posts
    /// nothing when the set has not changed since the last banner.
    func announce(unseen: [String]) {
        guard !unseen.isEmpty, unseen != InboxState.Prefs.announced else { return }
        let t = InboxState.Prefs.templates
        let stems = unseen.map { ($0 as NSString).deletingPathExtension }
        let content = UNMutableNotificationContent()
        content.title = t["title"] ?? "New in Inbox"
        if stems.count == 1 {
            content.body = (t["one"] ?? "{title}").replacingOccurrences(of: "{title}", with: stems[0])
        } else {
            let lead = stems.prefix(2).joined(separator: ", ")
            let rest = stems.count - 2
            let list = rest > 0 ? (t["more"] ?? "{list} and {count} more")
                .replacingOccurrences(of: "{list}", with: lead)
                .replacingOccurrences(of: "{count}", with: String(rest)) : lead
            content.body = (t["many"] ?? "{count} new in Inbox").replacingOccurrences(of: "{count}", with: String(stems.count)) + "\n" + list
        }
        content.threadIdentifier = "inbox"
        content.userInfo = ["route": "inbox"]
        let request = UNNotificationRequest(identifier: Notifier.newItemsIdentifier, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                os_log("announce failed: %{public}@", log: Notifier.logger, type: .error, String(describing: error))
            } else {
                InboxState.Prefs.announced = unseen
                os_log("announced %d unseen", log: Notifier.logger, type: .info, unseen.count)
            }
        }
    }

    /// The user has the Inbox in front of them: the banner has done its job.
    func clearAnnounced() {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [Notifier.newItemsIdentifier])
        InboxState.Prefs.announced = []
    }

    func consumeLaunchRoute() -> String? {
        defer { pendingRoute = nil }
        return pendingRoute
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let route = response.notification.request.content.userInfo["route"] as? String {
            pendingRoute = route
            // Warm: the frontend is up and takes the route now. Cold: it asks
            // for the pending route once the grant resolves.
            if let webView {
                let json = "{\"route\":\"\(route)\"}"
                DispatchQueue.main.async {
                    webView.evaluateJavaScript(
                        "window.dispatchEvent(new CustomEvent('notesage:notification',{detail:\(json)}))")
                }
            }
        }
        completionHandler()
    }
}
