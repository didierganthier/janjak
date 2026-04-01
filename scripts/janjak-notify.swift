import Cocoa

// Tiny native notification sender for Janjak.
// Compiled once with: swiftc -o ~/.janjak/janjak-notify janjak-notify.swift
// Usage: janjak-notify "title" "message"

let title = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Janjak"
let message = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "Notification from Janjak"

let notification = NSUserNotification()
notification.title = title
notification.informativeText = message
notification.soundName = NSUserNotificationDefaultSoundName

NSUserNotificationCenter.default.deliver(notification)

// Give the notification a moment to post
Thread.sleep(forTimeInterval: 0.3)
