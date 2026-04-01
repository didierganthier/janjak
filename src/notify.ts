// ─── macOS Native Notifications ───────────────────────────────────
// Uses a dedicated JanjakNotify.app (.app bundle with UserNotifications
// framework) so notifications appear under "Janjak" in Notification Center.
// The .app is auto-compiled from Swift on first use.
// Fallback: terminal-notifier → bare osascript.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const JANJAK_DIR = join(homedir(), ".janjak");
const APP_BUNDLE = join(JANJAK_DIR, "JanjakNotify.app");
const PAYLOAD_FILE = join(JANJAK_DIR, ".notify-payload");
const APP_BINARY = join(APP_BUNDLE, "Contents", "MacOS", "JanjakNotify");
const APP_ICON = join(APP_BUNDLE, "Contents", "Resources", "AppIcon.icns");

// Resolve path to assets/AppIcon.icns shipped with the project
const __filename_local = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename_local), "..");
const ICON_SOURCE = join(PROJECT_ROOT, "assets", "AppIcon.icns");

/** Ensure the app icon is present in the bundle Resources. */
function ensureAppIcon(): void {
  if (existsSync(APP_ICON)) return;
  if (existsSync(ICON_SOURCE)) {
    mkdirSync(join(APP_BUNDLE, "Contents", "Resources"), { recursive: true });
    copyFileSync(ICON_SOURCE, APP_ICON);
    // Re-sign after adding the icon
    spawnSync("codesign", ["--sign", "-", "--force", APP_BUNDLE], {
      timeout: 10000,
      stdio: "ignore",
    });
  }
}

/** Build the JanjakNotify.app bundle if it doesn't already exist. */
function ensureNotifierApp(): boolean {
  if (existsSync(APP_BINARY)) {
    ensureAppIcon();
    return true;
  }

  // The Swift source lives in the repo's scripts/ folder, but after
  // npm-link the binary might not be adjacent. Build from inline source.
  try {
    mkdirSync(join(APP_BUNDLE, "Contents", "MacOS"), { recursive: true });
    mkdirSync(join(APP_BUNDLE, "Contents", "Resources"), { recursive: true });

    // Info.plist
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>JanjakNotify</string>
<key>CFBundleIdentifier</key><string>com.janjak.notify</string>
<key>CFBundleName</key><string>Janjak</string>
<key>CFBundleDisplayName</key><string>Janjak</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1.0</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSUIElement</key><true/>
<key>NSUserNotificationAlertStyle</key><string>banner</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
</dict></plist>`;
    writeFileSync(join(APP_BUNDLE, "Contents", "Info.plist"), plist);

    // Swift source → compile into the bundle
    const swift = `
import Cocoa
import UserNotifications
class D:NSObject,NSApplicationDelegate,UNUserNotificationCenterDelegate{
func applicationDidFinishLaunching(_ n:Notification){
if let iconPath=Bundle.main.url(forResource:"AppIcon",withExtension:"icns"),
   let img=NSImage(contentsOf:iconPath){
NSApplication.shared.applicationIconImage=img}
let c=UNUserNotificationCenter.current();c.delegate=self
c.requestAuthorization(options:[.alert,.sound,.badge]){g,_ in
if g{self.send()}else{NSApplication.shared.terminate(nil)}}}
func userNotificationCenter(_ c:UNUserNotificationCenter,willPresent n:UNNotification,withCompletionHandler h:@escaping(UNNotificationPresentationOptions)->Void){h([.banner,.sound])}
func send(){
let h=FileManager.default.homeDirectoryForCurrentUser
let p=h.appendingPathComponent(".janjak/.notify-payload")
var t="Janjak",b="Notification from Janjak"
if let d=try? String(contentsOf:p,encoding:.utf8){
let l=d.components(separatedBy:"\\n")
if l.count>0 && !l[0].isEmpty{t=l[0]}
if l.count>1 && !l[1].isEmpty{b=l[1]}}
let c=UNMutableNotificationContent();c.title=t;c.body=b;c.sound = .default
if let iconUrl=Bundle.main.url(forResource:"AppIcon",withExtension:"icns"),
   let img=NSImage(contentsOf:iconUrl),let tiff=img.tiffRepresentation,
   let rep=NSBitmapImageRep(data:tiff),
   let png=rep.representation(using:.png,properties:[:]){
let tmp=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString+".png")
try? png.write(to:tmp)
if let att=try? UNNotificationAttachment(identifier:"icon",url:tmp,options:nil){
c.attachments=[att]}}
let r=UNNotificationRequest(identifier:UUID().uuidString,content:c,trigger:nil)
UNUserNotificationCenter.current().add(r){_ in
DispatchQueue.main.asyncAfter(deadline:.now()+1){NSApplication.shared.terminate(nil)}}}}
let a=NSApplication.shared;let d=D();a.delegate=d;a.run()`;

    const tmpSwift = join(JANJAK_DIR, "_notify_build.swift");
    writeFileSync(tmpSwift, swift);
    spawnSync("swiftc", [
      "-o", APP_BINARY,
      tmpSwift,
      "-framework", "Cocoa",
      "-framework", "UserNotifications",
    ], { timeout: 60000, stdio: "ignore" });

    // Clean up temp source
    try { require("node:fs").unlinkSync(tmpSwift); } catch {}

    // Ad-hoc code sign so macOS allows notification permissions
    spawnSync("codesign", ["--sign", "-", "--force", APP_BUNDLE], {
      timeout: 10000,
      stdio: "ignore",
    });

    // Copy app icon into bundle
    ensureAppIcon();

    return existsSync(APP_BINARY);
  } catch {
    return false;
  }
}

/** Send a macOS desktop notification. */
export function sendNotification(
  message: string,
  title = "Janjak",
  subtitle?: string,
): void {
  // Strategy 1: JanjakNotify.app — proper macOS app bundle
  if (ensureNotifierApp()) {
    try {
      const payload = `${title}\n${message}`;
      writeFileSync(PAYLOAD_FILE, payload);
      spawnSync("open", [APP_BUNDLE], { timeout: 5000, stdio: "ignore" });
      return;
    } catch { /* fall through */ }
  }

  // Strategy 2: terminal-notifier
  try {
    execSync("which terminal-notifier", { stdio: "ignore", timeout: 2000 });
    let cmd = `terminal-notifier -title ${shellEscape(title)} -message ${shellEscape(message)}`;
    if (subtitle) cmd += ` -subtitle ${shellEscape(subtitle)}`;
    cmd += ` -sound Blow -group janjak`;
    execSync(cmd, { timeout: 5000, stdio: "ignore" });
    return;
  } catch { /* not installed */ }

  // Strategy 3: bare osascript
  try {
    const sub = subtitle ? ` subtitle ${escapeAS(subtitle)}` : "";
    const script = `display notification ${escapeAS(message)} with title ${escapeAS(title)}${sub} sound name "Blow"`;
    execSync(`osascript -e '${script}'`, { timeout: 5000, stdio: "ignore" });
  } catch { /* silent */ }
}

function escapeAS(str: string): string {
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

export function notificationsAvailable(): boolean {
  try {
    execSync("which osascript", { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export function getNotifySetupHelp(): string {
  if (ensureNotifierApp()) {
    return "✅ Using JanjakNotify.app (native macOS notifications).";
  }
  return "Run: janjak notify  — it auto-builds the notification app on first use.";
}
