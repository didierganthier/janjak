import Cocoa
import UserNotifications

// Janjak Notification Sender — a proper .app so macOS registers it
// in Notification Center under "Janjak".
// Reads notification payload from ~/.janjak/.notify-payload

class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        // Request permission (shows prompt on first run)
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if granted {
                self.sendNotification()
            } else {
                NSApplication.shared.terminate(nil)
            }
        }
    }

    // Allow notifications to show even when app is frontmost
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func sendNotification() {
        // Read payload from file
        let home = FileManager.default.homeDirectoryForCurrentUser
        let payloadPath = home.appendingPathComponent(".janjak/.notify-payload")

        var title = "Janjak"
        var body = "Notification from Janjak"

        if let data = try? String(contentsOf: payloadPath, encoding: .utf8) {
            let lines = data.components(separatedBy: "\n")
            if lines.count > 0 && !lines[0].isEmpty { title = lines[0] }
            if lines.count > 1 && !lines[1].isEmpty { body = lines[1] }
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request) { error in
            // Give notification time to display, then quit
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                NSApplication.shared.terminate(nil)
            }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
