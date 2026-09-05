import BackgroundTasks
import Foundation
import UIKit
import UserNotifications
import os.log

/// Background App Refresh: the only background execution an app without a
/// server gets. Best effort by nature — iOS runs it on its own schedule,
/// never in Low Power Mode, never when the user disabled it or force-quit
/// the app. The run lists the Inbox, refreshes the badge, and announces
/// anything the user has not seen, once per batch.
enum BackgroundRefresh {
    static let identifier = "com.notesage.app.inbox-refresh"
    private static let logger = OSLog(subsystem: "com.notesage.app", category: "refresh")
    private static var observer: NSObjectProtocol?

    /// Must run before the app finishes launching; the plugin's `load` is
    /// inside that window.
    static func register() {
        let ok = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            run(refresh)
        }
        os_log("register %{public}@: %{public}@", log: logger, type: .info, identifier, ok ? "ok" : "refused")
        if observer == nil {
            observer = NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
            ) { _ in schedule() }
        }
    }

    /// iOS ignores anything earlier than 15 minutes and may run it much later.
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
            os_log("scheduled", log: logger, type: .info)
        } catch {
            // `.unavailable` is what a disabled Background App Refresh (or the
            // simulator) looks like.
            os_log("submit failed: %{public}@", log: logger, type: .error, String(describing: error))
        }
    }

    private static func run(_ task: BGAppRefreshTask) {
        var cancelled = false
        task.expirationHandler = {
            cancelled = true
            os_log("expired", log: logger, type: .error)
        }
        // Well inside iOS's 30 s wall.
        let budget = DispatchWorkItem { cancelled = true }
        DispatchQueue.global().asyncAfter(deadline: .now() + 20, execute: budget)
        DispatchQueue.global(qos: .utility).async {
            defer {
                budget.cancel()
                schedule()
            }
            let root: URL
            do {
                root = try LibraryAccess.resolveRoot()
            } catch {
                os_log("no grant: %{public}@", log: logger, type: .info, String(describing: error))
                task.setTaskCompleted(success: true)
                return
            }
            let scoped = root.startAccessingSecurityScopedResource()
            defer { if scoped { root.stopAccessingSecurityScopedResource() } }
            let names = InboxState.names(root: root)
            let unread = InboxState.unreadCount(root: root)
            if cancelled {
                task.setTaskCompleted(success: false)
                return
            }
            if InboxState.Prefs.badge { Notifier.shared.setBadge(unread) }
            let unseen = InboxState.Prefs.unseen(of: names)
            os_log("%d in Inbox, %d unread, %d unseen", log: logger, type: .info, names.count, unread, unseen.count)
            if InboxState.Prefs.newItems && !unseen.isEmpty {
                UNUserNotificationCenter.current().getNotificationSettings { settings in
                    if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
                        Notifier.shared.announce(unseen: unseen)
                    } else {
                        os_log("authorization %d: nothing announced", log: logger, type: .info, settings.authorizationStatus.rawValue)
                    }
                    task.setTaskCompleted(success: true)
                }
            } else {
                task.setTaskCompleted(success: true)
            }
        }
    }
}
