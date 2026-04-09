// ─── Janjak Overlay App ─────────────────────────────────────────────
// A floating, always-on overlay activated via ⌘⇧J (global hotkey).
// Records audio → sends to daemon API → shows transcript & response.
// Dismisses after TTS completes or on ESC / click-away.
//
// Build: swiftc -framework Cocoa -framework Carbon -framework AVFoundation -o JanjakOverlay JanjakOverlay.swift
// Run:   ./JanjakOverlay

import Cocoa
import Carbon
import AVFoundation

// MARK: - Config

let DAEMON_PORT = 7777
let API_BASE = "http://localhost:\(DAEMON_PORT)"

// MARK: - Data Models

struct VoiceResponse: Codable {
    let ok: Bool?
    let character: String?
    let transcript: String?
    let response: String?
    let action: String?
    let spoken: Bool?
    let error: String?
}

struct HealthResponse: Codable {
    let ok: Bool
    let character: String
}

// MARK: - Audio Recorder

class AudioRecorder: NSObject {
    private var recorder: AVAudioRecorder?
    private let outputURL: URL
    private var micPermissionGranted = false
    
    override init() {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".janjak")
        outputURL = dir.appendingPathComponent(".overlay-recording.wav")
        super.init()
        requestMicPermission()
    }
    
    func requestMicPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            micPermissionGranted = true
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                self?.micPermissionGranted = granted
                if granted {
                    print("🎙️ Microphone access granted")
                } else {
                    print("⚠️  Microphone access denied")
                }
            }
        default:
            micPermissionGranted = false
            print("⚠️  Microphone access denied — grant in System Settings > Privacy > Microphone")
        }
    }
    
    func startRecording() -> Bool {
        guard micPermissionGranted else {
            print("⚠️  No microphone permission")
            requestMicPermission()
            return false
        }
        
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16000.0,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]
        
        do {
            recorder = try AVAudioRecorder(url: outputURL, settings: settings)
            recorder?.record()
            return true
        } catch {
            print("Recording error: \(error)")
            return false
        }
    }
    
    func stopRecording() -> URL? {
        recorder?.stop()
        return outputURL
    }
    
    var isRecording: Bool { recorder?.isRecording ?? false }
}

// MARK: - Overlay Window

class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

// MARK: - Overlay View

class OverlayViewController: NSViewController {
    
    enum State {
        case idle
        case listening
        case processing
        case responding(character: String, transcript: String, response: String)
        case error(String)
    }
    
    private var currentState: State = .idle {
        didSet { updateUI() }
    }
    
    private let containerView = NSVisualEffectView()
    private let iconLabel = NSTextField(labelWithString: "🧠")
    private let statusLabel = NSTextField(labelWithString: "Press Space to talk to Janjak")
    private let transcriptLabel = NSTextField(wrappingLabelWithString: "")
    private let scrollView = NSScrollView()
    private let responseTextView = NSTextView()
    private let hintLabel = NSTextField(labelWithString: "ESC to close")
    
    private let audioRecorder = AudioRecorder()
    private var dismissTimer: Timer?
    private var keyDownMonitor: Any?
    private var keyUpMonitor: Any?
    
    override func loadView() {
        let frame = NSRect(x: 0, y: 0, width: 480, height: 200)
        view = NSView(frame: frame)
        
        // Blurred background
        containerView.frame = view.bounds
        containerView.autoresizingMask = [.width, .height]
        containerView.material = .hudWindow
        containerView.blendingMode = .behindWindow
        containerView.state = .active
        containerView.wantsLayer = true
        containerView.layer?.cornerRadius = 20
        containerView.layer?.masksToBounds = true
        view.addSubview(containerView)
        
        // Icon
        iconLabel.font = NSFont.systemFont(ofSize: 40)
        iconLabel.alignment = .center
        iconLabel.translatesAutoresizingMaskIntoConstraints = false
        containerView.addSubview(iconLabel)
        
        // Status
        statusLabel.font = NSFont.systemFont(ofSize: 16, weight: .medium)
        statusLabel.textColor = .white
        statusLabel.alignment = .center
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        containerView.addSubview(statusLabel)
        
        // Transcript
        transcriptLabel.font = NSFont.systemFont(ofSize: 13)
        transcriptLabel.textColor = NSColor.white.withAlphaComponent(0.7)
        transcriptLabel.alignment = .center
        transcriptLabel.maximumNumberOfLines = 2
        transcriptLabel.translatesAutoresizingMaskIntoConstraints = false
        transcriptLabel.isHidden = true
        containerView.addSubview(transcriptLabel)
        
        // Response (scrollable text view)
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false
        scrollView.scrollerStyle = .overlay
        scrollView.isHidden = true
        
        responseTextView.isEditable = false
        responseTextView.isSelectable = true
        responseTextView.drawsBackground = false
        responseTextView.textColor = .white
        responseTextView.font = NSFont.systemFont(ofSize: 14, weight: .regular)
        responseTextView.alignment = .center
        responseTextView.textContainerInset = NSSize(width: 0, height: 0)
        responseTextView.isVerticallyResizable = true
        responseTextView.isHorizontallyResizable = false
        responseTextView.textContainer?.widthTracksTextView = true
        
        scrollView.documentView = responseTextView
        containerView.addSubview(scrollView)
        
        // Hint
        hintLabel.font = NSFont.systemFont(ofSize: 11)
        hintLabel.textColor = NSColor.white.withAlphaComponent(0.4)
        hintLabel.alignment = .center
        hintLabel.translatesAutoresizingMaskIntoConstraints = false
        containerView.addSubview(hintLabel)
        
        NSLayoutConstraint.activate([
            iconLabel.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            iconLabel.topAnchor.constraint(equalTo: containerView.topAnchor, constant: 20),
            
            statusLabel.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            statusLabel.topAnchor.constraint(equalTo: iconLabel.bottomAnchor, constant: 8),
            statusLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            statusLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),
            
            transcriptLabel.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            transcriptLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 8),
            transcriptLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            transcriptLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),
            
            scrollView.topAnchor.constraint(equalTo: transcriptLabel.bottomAnchor, constant: 8),
            scrollView.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            scrollView.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),
            scrollView.bottomAnchor.constraint(equalTo: hintLabel.topAnchor, constant: -8),
            
            hintLabel.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            hintLabel.bottomAnchor.constraint(equalTo: containerView.bottomAnchor, constant: -10),
        ])
    }
    
    private func updateUI() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            switch self.currentState {
            case .idle:
                self.iconLabel.stringValue = "🧠"
                self.statusLabel.stringValue = "Press Space to talk to Janjak"
                self.transcriptLabel.isHidden = true
                self.scrollView.isHidden = true
                self.hintLabel.stringValue = "ESC to close"
                self.resizeWindow(height: 140)
                
            case .listening:
                self.iconLabel.stringValue = "🎙️"
                self.statusLabel.stringValue = "Listening... (release Space to send)"
                self.transcriptLabel.isHidden = true
                self.scrollView.isHidden = true
                self.hintLabel.stringValue = "ESC to cancel"
                self.resizeWindow(height: 140)
                
            case .processing:
                self.iconLabel.stringValue = "🤔"
                self.statusLabel.stringValue = "Thinking..."
                self.transcriptLabel.isHidden = true
                self.scrollView.isHidden = true
                self.hintLabel.stringValue = ""
                self.resizeWindow(height: 140)
                
            case .responding(let character, let transcript, let response):
                self.iconLabel.stringValue = "🧠"
                self.statusLabel.stringValue = character
                self.transcriptLabel.stringValue = "You: \(transcript)"
                self.transcriptLabel.isHidden = false
                self.responseTextView.string = response
                self.scrollView.isHidden = false
                self.hintLabel.stringValue = "Space to talk again · ESC to close"
                // Calculate height based on content (cap at 500)
                let textHeight = self.calculateTextHeight(response, width: 440)
                let totalHeight = min(max(200, 140 + textHeight + 40), 500)
                self.resizeWindow(height: totalHeight)
                
            case .error(let msg):
                self.iconLabel.stringValue = "⚠️"
                self.statusLabel.stringValue = msg
                self.transcriptLabel.isHidden = true
                self.scrollView.isHidden = true
                self.hintLabel.stringValue = "Space to retry · ESC to close"
                self.resizeWindow(height: 140)
            }
        }
    }
    
    private func resizeWindow(height: CGFloat) {
        guard let window = view.window else { return }
        var frame = window.frame
        let oldHeight = frame.height
        frame.size.height = height
        frame.origin.y += (oldHeight - height)
        window.setFrame(frame, display: true, animate: true)
    }
    
    private func calculateTextHeight(_ text: String, width: CGFloat) -> CGFloat {
        let font = NSFont.systemFont(ofSize: 14, weight: .regular)
        let attrs: [NSAttributedString.Key: Any] = [.font: font]
        let boundingRect = (text as NSString).boundingRect(
            with: NSSize(width: width, height: CGFloat.greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attrs
        )
        return ceil(boundingRect.height)
    }
    
    override var acceptsFirstResponder: Bool { true }
    
    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.makeFirstResponder(self)
        installKeyMonitors()
    }
    
    // MARK: - Keyboard Events via Local Monitor
    // Borderless windows need local event monitors for reliable key handling
    
    func installKeyMonitors() {
        removeKeyMonitors()
        
        keyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self = self, self.view.window?.isVisible == true else { return event }
            switch event.keyCode {
            case 53: // ESC
                if self.audioRecorder.isRecording {
                    _ = self.audioRecorder.stopRecording()
                    self.currentState = .idle
                } else {
                    self.hideOverlay()
                }
                return nil // consume event
            case 49: // Space
                if event.isARepeat { return nil } // ignore key repeat
                if case .listening = self.currentState { return nil }
                self.startListening()
                return nil
            default:
                return event
            }
        }
        
        keyUpMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyUp) { [weak self] event in
            guard let self = self, self.view.window?.isVisible == true else { return event }
            if event.keyCode == 49 { // Space released
                if case .listening = self.currentState {
                    self.stopAndProcess()
                }
                return nil
            }
            return event
        }
    }
    
    func removeKeyMonitors() {
        if let m = keyDownMonitor { NSEvent.removeMonitor(m); keyDownMonitor = nil }
        if let m = keyUpMonitor { NSEvent.removeMonitor(m); keyUpMonitor = nil }
    }
    
    // MARK: - Voice Flow
    
    private func startListening() {
        currentState = .listening
        if !audioRecorder.startRecording() {
            currentState = .error("Microphone access denied")
        }
    }
    
    private func stopAndProcess() {
        guard let audioURL = audioRecorder.stopRecording() else {
            currentState = .error("Recording failed")
            return
        }
        
        currentState = .processing
        
        // Send audio to daemon API
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.sendAudioToDaemon(audioURL: audioURL)
        }
    }
    
    private func sendAudioToDaemon(audioURL: URL) {
        guard let audioData = try? Data(contentsOf: audioURL) else {
            DispatchQueue.main.async { self.currentState = .error("Could not read audio") }
            return
        }
        
        guard let url = URL(string: "\(API_BASE)/api/voice") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        request.httpBody = audioData
        request.timeoutInterval = 30
        
        let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            
            if error != nil {
                DispatchQueue.main.async {
                    self.currentState = .error("Daemon not reachable")
                }
                return
            }
            
            guard let data = data else {
                DispatchQueue.main.async { self.currentState = .error("No response") }
                return
            }
            
            do {
                let vr = try JSONDecoder().decode(VoiceResponse.self, from: data)
                DispatchQueue.main.async {
                    if let errorMsg = vr.error {
                        self.currentState = .error(errorMsg)
                    } else {
                        let character = vr.character ?? "Janjak"
                        let transcript = vr.transcript ?? ""
                        let response = vr.response ?? ""
                        self.currentState = .responding(
                            character: character,
                            transcript: transcript,
                            response: response
                        )
                        // Auto-dismiss after a delay proportional to response length
                        let words = response.split(separator: " ").count
                        let delay = max(5.0, Double(words) / 2.5) // ~2.5 words/sec TTS
                        self.dismissTimer?.invalidate()
                        self.dismissTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
                            // Go back to idle, don't dismiss
                            self.currentState = .idle
                        }
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.currentState = .error("Parse error")
                }
            }
        }
        task.resume()
    }
    
    private func hideOverlay() {
        dismissTimer?.invalidate()
        view.window?.orderOut(nil)
        currentState = .idle
    }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
    
    var overlayWindow: OverlayWindow!
    var overlayVC: OverlayViewController!
    var eventHotKey: EventHotKeyRef?
    var statusItem: NSStatusItem!
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Create the overlay window
        let screenFrame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let windowWidth: CGFloat = 480
        let windowHeight: CGFloat = 140
        let windowX = (screenFrame.width - windowWidth) / 2
        let windowY = screenFrame.height * 0.7
        
        overlayWindow = OverlayWindow(
            contentRect: NSRect(x: windowX, y: windowY, width: windowWidth, height: windowHeight),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        
        overlayWindow.level = .floating
        overlayWindow.isOpaque = false
        overlayWindow.backgroundColor = .clear
        overlayWindow.hasShadow = true
        overlayWindow.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        overlayWindow.isMovableByWindowBackground = true
        
        overlayVC = OverlayViewController()
        overlayWindow.contentViewController = overlayVC
        
        // Register global hotkey: ⌘⇧J
        registerHotKey()
        
        // Status bar icon (minimal)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "🧠"
        
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show Overlay (⌘⇧J)", action: #selector(toggleOverlay), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Janjak Overlay", action: #selector(quitApp), keyEquivalent: "q"))
        statusItem.menu = menu
        
        // Show overlay on launch + make it receive key events
        overlayWindow.makeKeyAndOrderFront(nil)
        overlayWindow.makeFirstResponder(overlayVC)
        NSApplication.shared.activate(ignoringOtherApps: true)
        
        print("🧠 Janjak Overlay ready — press ⌘⇧J from anywhere")
    }
    
    // MARK: - Global Hotkey (⌘⇧J via Carbon)
    
    func registerHotKey() {
        // ⌘⇧J
        // J keycode = 38
        let modifiers: UInt32 = UInt32(cmdKey | shiftKey)
        let keyCode: UInt32 = 38 // J
        
        var hotKeyID = EventHotKeyID()
        hotKeyID.signature = OSType(0x4A4E4A4B) // "JNJK"
        hotKeyID.id = 1
        
        var hotKeyRef: EventHotKeyRef?
        let status = RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)
        
        if status == noErr {
            self.eventHotKey = hotKeyRef
        } else {
            print("⚠️  Could not register global hotkey ⌘⇧J (status: \(status))")
        }
        
        // Install Carbon event handler
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        
        let handler: EventHandlerUPP = { _, event, userData -> OSStatus in
            guard let delegate = NSApplication.shared.delegate as? AppDelegate else { return OSStatus(eventNotHandledErr) }
            DispatchQueue.main.async {
                delegate.toggleOverlay()
            }
            return noErr
        }
        
        InstallEventHandler(GetApplicationEventTarget(), handler, 1, &eventType, nil, nil)
    }
    
    @objc func toggleOverlay() {
        if overlayWindow.isVisible {
            overlayWindow.orderOut(nil)
        } else {
            overlayWindow.makeKeyAndOrderFront(nil)
            overlayWindow.makeFirstResponder(overlayVC)
            NSApplication.shared.activate(ignoringOtherApps: true)
            overlayVC.installKeyMonitors()
        }
    }
    
    @objc func quitApp() {
        if let hotKey = eventHotKey {
            UnregisterEventHotKey(hotKey)
        }
        NSApplication.shared.terminate(nil)
    }
}

// MARK: - Entry Point

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // No dock icon
let delegate = AppDelegate()
app.delegate = delegate
app.run()
