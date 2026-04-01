import Cocoa
import UserNotifications

class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Set app icon from bundle resources
        if let iconUrl = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
           let img = NSImage(contentsOf: iconUrl) {
            NSApplication.shared.applicationIconImage = img
        }

        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            if granted {
                self.sendNotification()
            } else {
                NSApplication.shared.terminate(nil)
            }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func sendNotification() {
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

        // Attach logo as notification image
        if let iconUrl = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
           let img = NSImage(contentsOf: iconUrl),
           let tiffData = img.tiffRepresentation,
           let rep = NSBitmapImageRep(data: tiffData),
           let pngData = rep.representation(using: .png, properties: [:]) {
            let tmpFile = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString + ".png")
            try? pngData.write(to: tmpFile)
            if let attachment = try? UNNotificationAttachment(
                identifier: "icon",
                url: tmpFile,
                options: nil
            ) {
                content.attachments = [attachment]
            }
        }

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request) { _ in
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
