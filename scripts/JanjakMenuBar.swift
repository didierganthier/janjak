// ─── Janjak Menu Bar App ────────────────────────────────────────────
// A lightweight macOS status bar app that shows Janjak status at a glance.
// Polls localhost:3547/api/state for live data.
// Quick actions: Focus, Break, Stop, Open Dashboard.

import Cocoa

// MARK: - Data Models

struct JanjakStatus: Codable {
    let activity: String
    let focusMode: String
    let energy: String
    let app: String?
    let sessionMinutes: Int
}

struct JanjakScore: Codable {
    let value: Int
    let label: String
    let codingMinutes: Int
    let browsingMinutes: Int
    let totalMinutes: Int
}

struct CalEvent: Codable {
    let title: String
    let minutesUntil: Int?
}

struct CalSummary: Codable {
    let nextEvent: CalEvent?
    let currentEvent: CalEvent?
    let totalMeetings: Int
    let freeMinutes: Int
}

struct GHSummary: Codable {
    let reviewCount: Int
    let prCount: Int
    let issueCount: Int
    let notifCount: Int
}

struct StreakData: Codable {
    let days: Int
    let best: Int
    let todayQualifies: Bool
}

struct PomoData: Codable {
    let today: Int
    let totalMinutes: Int
}

struct CurrentProject: Codable {
    let project: String?
    let branch: String?
}

struct JanjakState: Codable {
    let status: JanjakStatus
    let score: JanjakScore
    let streak: StreakData
    let pomo: PomoData
    let currentProject: CurrentProject
    let music: String?
    let nudge: String?
    let calendar: CalSummary?
    let meetingAlert: String?
    let github: GHSummary?
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var pollTimer: Timer?
    var lastState: JanjakState?
    
    let activityEmoji: [String: String] = [
        "coding": "💻", "browsing": "🌐", "designing": "🎨",
        "writing": "✍️", "meeting": "📞", "idle": "😴", "unknown": "❓"
    ]
    
    let modeEmoji: [String: String] = [
        "deep-work": "🎯", "casual": "💡", "break": "☕", "off": "⏹"
    ]
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        
        if let button = statusItem.button {
            button.title = "🧠"
            button.toolTip = "Janjak — Ambient Intelligence"
        }
        
        buildMenu(state: nil)
        
        // Start polling
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.fetchState()
        }
        fetchState()
    }
    
    // MARK: - API
    
    func fetchState() {
        guard let url = URL(string: "http://127.0.0.1:3547/api/state") else { return }
        
        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            guard let data = data, error == nil else {
                DispatchQueue.main.async {
                    self?.statusItem.button?.title = "🧠❌"
                    self?.buildMenu(state: nil)
                }
                return
            }
            
            do {
                let state = try JSONDecoder().decode(JanjakState.self, from: data)
                DispatchQueue.main.async {
                    self?.lastState = state
                    self?.updateStatusIcon(state)
                    self?.buildMenu(state: state)
                }
            } catch {
                DispatchQueue.main.async {
                    self?.statusItem.button?.title = "🧠"
                }
            }
        }
        task.resume()
    }
    
    func postAction(_ action: String) {
        guard let url = URL(string: "http://127.0.0.1:3547/api/\(action)") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        URLSession.shared.dataTask(with: req) { [weak self] _, _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self?.fetchState()
            }
        }.resume()
    }
    
    // MARK: - UI Updates
    
    func updateStatusIcon(_ state: JanjakState) {
        let emoji = activityEmoji[state.status.activity] ?? "🧠"
        let score = state.score.value
        
        // Show activity emoji + compact score
        if state.status.focusMode == "deep-work" {
            statusItem.button?.title = "🎯 \(score)"
        } else if state.status.focusMode == "break" {
            statusItem.button?.title = "☕ \(score)"
        } else {
            statusItem.button?.title = "\(emoji) \(score)"
        }
    }
    
    // MARK: - Menu Building
    
    func buildMenu(state: JanjakState?) {
        let menu = NSMenu()
        
        if let s = state {
            // ── Status Section ──
            let actEmoji = activityEmoji[s.status.activity] ?? "❓"
            let actLabel = s.status.activity.capitalized
            addItem(menu, "\(actEmoji) \(actLabel)", enabled: false)
            
            if let app = s.status.app {
                addItem(menu, "    📱 \(app)", enabled: false)
            }
            
            let modeE = modeEmoji[s.status.focusMode] ?? "⏹"
            addItem(menu, "    \(modeE) \(s.status.focusMode)  •  \(s.status.sessionMinutes)m session", enabled: false)
            
            if let proj = s.currentProject.project {
                let br = s.currentProject.branch.map { " [\($0)]" } ?? ""
                addItem(menu, "    📂 \(proj)\(br)", enabled: false)
            }
            
            menu.addItem(NSMenuItem.separator())
            
            // ── Score ──
            let scoreColor = s.score.value >= 70 ? "🟢" : s.score.value >= 50 ? "🟡" : "🔴"
            addItem(menu, "\(scoreColor) Score: \(s.score.value)/100  \(s.score.label)", enabled: false)
            addItem(menu, "    💻 \(s.score.codingMinutes)m code  🌐 \(s.score.browsingMinutes)m browse  ⏱️ \(s.score.totalMinutes)m", enabled: false)
            
            // ── Streak ──
            if s.streak.days > 0 {
                let fire = s.streak.days >= 7 ? "🔥🔥🔥" : s.streak.days >= 3 ? "🔥🔥" : "🔥"
                addItem(menu, "\(fire) \(s.streak.days)-day streak", enabled: false)
            }
            
            if s.pomo.today > 0 {
                addItem(menu, "🍅 \(s.pomo.today) pomodoro\(s.pomo.today > 1 ? "s" : "") (\(s.pomo.totalMinutes)m)", enabled: false)
            }
            
            menu.addItem(NSMenuItem.separator())
            
            // ── Calendar ──
            if let cal = s.calendar {
                if let alert = s.meetingAlert {
                    addItem(menu, "⏰ \(alert)", enabled: false)
                }
                if let curr = cal.currentEvent {
                    addItem(menu, "🔴 NOW: \(curr.title)", enabled: false)
                }
                if let next = cal.nextEvent {
                    let mins = next.minutesUntil.map { "in \($0)m" } ?? ""
                    addItem(menu, "📅 NEXT: \(next.title) \(mins)", enabled: false)
                }
                addItem(menu, "    \(cal.totalMeetings) meeting\(cal.totalMeetings != 1 ? "s" : "") • \(cal.freeMinutes)m free", enabled: false)
                menu.addItem(NSMenuItem.separator())
            }
            
            // ── GitHub ──
            if let gh = s.github {
                var ghItems: [String] = []
                if gh.reviewCount > 0 { ghItems.append("🔍 \(gh.reviewCount) reviews") }
                if gh.prCount > 0 { ghItems.append("📤 \(gh.prCount) PRs") }
                if gh.issueCount > 0 { ghItems.append("📋 \(gh.issueCount) issues") }
                if gh.notifCount > 0 { ghItems.append("🔔 \(gh.notifCount) notifs") }
                if ghItems.isEmpty {
                    addItem(menu, "🐙 GitHub: all clear ✨", enabled: false)
                } else {
                    addItem(menu, "🐙 \(ghItems.joined(separator: "  "))", enabled: false)
                }
                menu.addItem(NSMenuItem.separator())
            }
            
            // ── Music ──
            if let track = s.music {
                addItem(menu, "🎵 \(track)", enabled: false)
            }
            
            // ── Nudge ──
            if let nudge = s.nudge {
                addItem(menu, "💡 \(nudge)", enabled: false)
            }
            
            menu.addItem(NSMenuItem.separator())
            
            // ── Quick Actions ──
            let focusItem = NSMenuItem(title: "🎯 Start Focus", action: #selector(startFocus), keyEquivalent: "f")
            focusItem.target = self
            if s.status.focusMode == "deep-work" {
                focusItem.title = "🎯 In Focus Mode"
                focusItem.isEnabled = false
            }
            menu.addItem(focusItem)
            
            let breakItem = NSMenuItem(title: "☕ Take Break", action: #selector(startBreak), keyEquivalent: "b")
            breakItem.target = self
            menu.addItem(breakItem)
            
            let stopItem = NSMenuItem(title: "⏹ Stop Session", action: #selector(stopSession), keyEquivalent: "s")
            stopItem.target = self
            menu.addItem(stopItem)
            
        } else {
            addItem(menu, "🧠 Janjak — Not Connected", enabled: false)
            addItem(menu, "Run: janjak web", enabled: false)
        }
        
        menu.addItem(NSMenuItem.separator())
        
        let dashItem = NSMenuItem(title: "🌐 Open Dashboard", action: #selector(openDashboard), keyEquivalent: "d")
        dashItem.target = self
        menu.addItem(dashItem)
        
        menu.addItem(NSMenuItem.separator())
        
        let quitItem = NSMenuItem(title: "Quit Janjak Menu Bar", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        
        statusItem.menu = menu
    }
    
    func addItem(_ menu: NSMenu, _ title: String, enabled: Bool) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = enabled
        menu.addItem(item)
    }
    
    // MARK: - Actions
    
    @objc func startFocus() { postAction("focus") }
    @objc func startBreak() { postAction("break") }
    @objc func stopSession() { postAction("stop") }
    
    @objc func openDashboard() {
        if let url = URL(string: "http://localhost:3547") {
            NSWorkspace.shared.open(url)
        }
    }
    
    @objc func quitApp() {
        NSApplication.shared.terminate(nil)
    }
}

// MARK: - Entry Point

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // No dock icon
let delegate = AppDelegate()
app.delegate = delegate
app.run()
