// ─── Voice Command: Talk to Janjak, it answers back ────────────────
// Uses a Swift helper for mic recording (auto-compiled on first use),
// OpenAI Whisper for speech-to-text, askJanjak for AI processing,
// and macOS `say` command for text-to-speech.
//
// Usage: janjak voice        — single question mode
//        janjak voice --loop — continuous conversation mode

import OpenAI from "openai";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, readFileSync, unlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { type ChatMessage } from "./chat.js";
import { runAgent } from "./agent/agent.js";
import { getState } from "./db.js";
import { setState } from "./db.js";
import { enterFocusMode, enterBreakMode, exitFocusMode } from "./engine.js";
import { startPomodoro } from "./pomo.js";
import { processInbox } from "./tasks.js";
import { getSpokenBriefing } from "./morning.js";
import { isAuthenticated, runOAuthFlow } from "./gmail-auth.js";
import { looksLikeTaskCreation, createTaskFromText, formatCreatedTask, formatSpokenConfirmation } from "./nl-tasks.js";

const JANJAK_DIR = join(homedir(), ".janjak");
const RECORDER_BIN = join(JANJAK_DIR, "janjak-recorder");
const RECORDING_PATH = join(JANJAK_DIR, ".voice-recording.wav");

// ─── Character System ───────────────────────────────────────────

const CHARACTERS = {
  janjak: { name: "Janjak", voice: "onyx", emoji: "🧔🏾" },
  janèt:  { name: "Janèt",  voice: "nova", emoji: "👩🏾" },
} as const;

type CharacterKey = keyof typeof CHARACTERS;

export type VoiceLanguageMode = "en-only" | "en-fr";

const VOICE_LANGUAGE_MODE_KEY = "voice_language_mode";

export function getVoiceLanguageMode(): VoiceLanguageMode {
  const mode = getState(VOICE_LANGUAGE_MODE_KEY);
  return mode === "en-fr" ? "en-fr" : "en-only";
}

export function setVoiceLanguageMode(mode: VoiceLanguageMode): void {
  setState(VOICE_LANGUAGE_MODE_KEY, mode);
}

export function formatVoiceLanguageMode(mode = getVoiceLanguageMode()): string {
  return mode === "en-only"
    ? "EN only (most reliable)"
    : "EN + FR (auto-detect within allowed languages)";
}

function getActiveCharacter() {
  const key = (getState("character") ?? "janjak") as CharacterKey;
  return CHARACTERS[key] ?? CHARACTERS.janjak;
}

// ─── Swift Mic Recorder (auto-compiled) ─────────────────────────

const RECORDER_SWIFT = `
import AVFoundation
import Foundation

// Simple command-line audio recorder
// Records from default mic until Enter is pressed, saves as WAV

class Recorder: NSObject, AVAudioRecorderDelegate {
    var audioRecorder: AVAudioRecorder?
    var outputPath: String
    var maxSeconds: Double

    init(outputPath: String, maxSeconds: Double) {
        self.outputPath = outputPath
        self.maxSeconds = maxSeconds
        super.init()
    }

    func start() {
        let url = URL(fileURLWithPath: outputPath)

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16000.0,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false
        ]

        do {
            audioRecorder = try AVAudioRecorder(url: url, settings: settings)
            audioRecorder?.delegate = self
            audioRecorder?.record(forDuration: maxSeconds)
        } catch {
            fputs("Error: \\(error.localizedDescription)\\n", stderr)
            exit(1)
        }
    }

    func finish() {
        audioRecorder?.stop()
        exit(0)
    }

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        exit(flag ? 0 : 1)
    }
}

// Parse args
let args = CommandLine.arguments
let output = args.count > 1 ? args[1] : "/tmp/janjak-recording.wav"
let maxSec = args.count > 2 ? Double(args[2]) ?? 30.0 : 30.0

let recorder = Recorder(outputPath: output, maxSeconds: maxSec)
recorder.start()

// Wait for Enter on a background thread (so the run loop stays alive for AVAudioRecorder)
DispatchQueue.global().async {
    _ = readLine()
    recorder.finish()
}

// Keep the run loop alive for delegate callbacks (duration timeout)
RunLoop.current.run()
`;

function ensureRecorder(): boolean {
  if (existsSync(RECORDER_BIN)) return true;

  console.log("  🔨 Building voice recorder (first time only)...");

  try {
    mkdirSync(JANJAK_DIR, { recursive: true });

    const tmpSwift = join(JANJAK_DIR, "_recorder_build.swift");
    writeFileSync(tmpSwift, RECORDER_SWIFT);

    const result = spawnSync("swiftc", [
      "-o", RECORDER_BIN,
      tmpSwift,
      "-framework", "AVFoundation",
      "-framework", "Foundation",
    ], { timeout: 120000, stdio: "pipe" });

    // Clean up temp source
    try { unlinkSync(tmpSwift); } catch {}

    if (result.status !== 0) {
      const err = result.stderr?.toString() || "Unknown build error";
      console.error("  ❌ Build failed:", err);
      return false;
    }

    // Ad-hoc sign for mic access
    spawnSync("codesign", ["--sign", "-", "--force", RECORDER_BIN], {
      timeout: 10000,
      stdio: "ignore",
    });

    console.log("  ✓ Voice recorder ready\n");
    return existsSync(RECORDER_BIN);
  } catch {
    return false;
  }
}

// ─── Recording ──────────────────────────────────────────────────

function recordAudio(maxSeconds = 30): boolean {
  // Clean up any previous recording
  try { unlinkSync(RECORDING_PATH); } catch {}

  console.log(`  🎙️  Listening... (press Enter when done, or ${maxSeconds}s max)`);

  const result = spawnSync(RECORDER_BIN, [RECORDING_PATH, String(maxSeconds)], {
    timeout: (maxSeconds + 5) * 1000,
    stdio: ["inherit", "pipe", "pipe"], // stdin from terminal so Enter works
  });

  if (!existsSync(RECORDING_PATH)) {
    console.log("  ❌ No audio captured.");
    return false;
  }

  // Check file has actual content (at least WAV header + some data)
  const stats = readFileSync(RECORDING_PATH);
  if (stats.length < 1000) {
    console.log("  ❌ Recording too short. Try speaking louder or longer.");
    return false;
  }

  return true;
}

// ─── Speech-to-Text (Whisper) ───────────────────────────────────

async function transcribeAudio(mode: VoiceLanguageMode): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error("OpenAI API key required for voice commands. Add OPENAI_API_KEY to ~/.janjak/.env");
  }

  const client = new OpenAI({ apiKey });

  console.log("  🧠 Transcribing...");

  // Check file size — Whisper needs at least 0.1s of audio
  const fileSize = statSync(RECORDING_PATH).size;
  if (fileSize < 5000) {
    return ""; // Too short, will be caught by the empty-transcript check
  }

  if (mode === "en-only") {
    const transcription = await client.audio.transcriptions.create({
      file: createReadStream(RECORDING_PATH),
      model: "whisper-1",
      language: "en",
    });
    return transcription.text.trim();
  }

  const transcription = await client.audio.transcriptions.create({
    file: createReadStream(RECORDING_PATH),
    model: "whisper-1",
    response_format: "verbose_json",
  });

  const verbose = transcription as unknown as { text?: string; language?: string };
  const detectedLanguage = (verbose.language ?? "").toLowerCase();

  if (detectedLanguage && detectedLanguage !== "en" && detectedLanguage !== "fr") {
    throw new Error(`Detected unsupported language: ${detectedLanguage}. Allowed: EN or FR.`);
  }

  return (verbose.text ?? "").trim();
}

// ─── Text-to-Speech (OpenAI TTS) ────────────────────────────────

const TTS_PATH = join(JANJAK_DIR, ".voice-response.mp3");

async function speak(text: string, voice?: string): Promise<void> {
  // Clean text (remove emojis that TTS might read literally)
  const cleaned = text
    .replace(/[\u{1F600}-\u{1F9FF}]/gu, "")  // Emojis
    .replace(/[\u{2600}-\u{27BF}]/gu, "")      // Misc symbols
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")    // Symbols & pictographs
    .replace(/["\u201C\u201D]/g, '"')
    .replace(/['\u2018\u2019]/g, "'")
    .replace(/\*\*/g, "")                        // Markdown bold
    .trim();

  if (!cleaned) return;

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    // Fallback to macOS say
    spawnSync("say", [cleaned], { timeout: 30000, stdio: "ignore" });
    return;
  }

  try {
    const client = new OpenAI({ apiKey });
    const ttsVoice = (voice as any) ?? getActiveCharacter().voice;

    const mp3 = await client.audio.speech.create({
      model: "tts-1",
      voice: ttsVoice,
      input: cleaned,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    writeFileSync(TTS_PATH, buffer);

    // Play with afplay (macOS built-in audio player)
    spawnSync("afplay", [TTS_PATH], { timeout: 60000, stdio: "ignore" });

    try { unlinkSync(TTS_PATH); } catch {}
  } catch {
    // Fallback to macOS say
    spawnSync("say", [cleaned], { timeout: 30000, stdio: "ignore" });
  }
}

// ─── Action Detection & Execution ───────────────────────────────

interface DetectedAction {
  label: string;
  execute: () => Promise<string>;
}

function detectAction(response: string, transcript: string): DetectedAction | null {
  const r = response.toLowerCase();

  // Offer to connect Gmail directly when the answer says it isn't connected.
  if (!isAuthenticated() && /janjak login|connect (your )?gmail|gmail is(n't| not) connected|not connected/i.test(r)) {
    return {
      label: "connect Gmail now",
      execute: async () => {
        await runOAuthFlow();
        return isAuthenticated()
          ? "Gmail connected! Ask me about your emails anytime."
          : "Gmail wasn't connected. We can try again whenever you're ready.";
      },
    };
  }

  // Break / rest suggestions
  if (/\b(take a break|grab a break|step away|rest|recharge|relax|pause|take some time off|disconnect)\b/.test(r)) {
    return { label: "start break mode", execute: async () => enterBreakMode() };
  }

  // Focus / deep work suggestions
  if (/\b(start (a )?focus|deep work|get into focus|lock in|time to code|start coding)\b/.test(r)) {
    return { label: "start focus mode", execute: async () => enterFocusMode() };
  }

  // Pomodoro suggestions
  if (/\b(pomodoro|start a timer|timed session|25.?min)\b/.test(r)) {
    return { label: "start a pomodoro", execute: async () => { await startPomodoro(); return "Pomodoro started!"; } };
  }

  // Stop / end session
  if (/\b(end (your |the )?session|call it a day|stop working|wrap up|log off)\b/.test(r)) {
    return { label: "end session", execute: async () => exitFocusMode() };
  }

  // Check emails / inbox
  if (/\b(check (your )?email|scan (your )?inbox|check (your )?inbox|look at.*email)\b/.test(r)) {
    return {
      label: "scan inbox for tasks",
      execute: async () => {
        if (!isAuthenticated()) {
          return "Gmail isn't connected yet. Run janjak login to connect your inbox first.";
        }
        const result = await processInbox();
        return result.newTasks.length > 0
          ? `Found ${result.newTasks.length} new tasks from your emails.`
          : "No new tasks from your emails.";
      },
    };
  }

  return null;
}

function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^(y|yes|yeah|yep|sure|ok|oui|wi)$/i.test(answer.trim()));
    });
  });
}

// ─── Main Voice Flow ────────────────────────────────────────────

export async function voiceCommand(options: {
  loop?: boolean;
  voice?: string;
  maxSeconds?: number;
} = {}): Promise<void> {
  const { loop = false, voice, maxSeconds = 30 } = options;

  const char = getActiveCharacter();
  const languageMode = getVoiceLanguageMode();
  const effectiveVoice = voice ?? char.voice;

  console.log(`\n🎤 ${char.emoji} ${char.name} Voice Mode`);
  console.log("═".repeat(40));
  console.log(`  🌐 Language mode: ${formatVoiceLanguageMode(languageMode)}`);

  // Build recorder if needed
  if (!ensureRecorder()) {
    console.log("❌ Could not build voice recorder. Make sure Xcode tools are installed:");
    console.log("   xcode-select --install");
    return;
  }

  // Conversation history for context across turns
  const history: ChatMessage[] = [];

  const runOnce = async (): Promise<string | false> => {
    // Record
    const recorded = recordAudio(maxSeconds);
    if (!recorded) return false;

    // Transcribe
    let transcript: string;
    try {
      transcript = await transcribeAudio(languageMode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("too short")) {
        console.log("  ⏩ Recording was too short — try speaking a bit longer.\n");
      } else {
        console.log("  ❌ Transcription failed:", msg || "Unknown error");
      }
      return false;
    }

    if (!transcript || transcript.length < 2) {
      console.log("  ❌ Couldn't understand that. Try again?");
      return false;
    }

    console.log(`  📝 You said: "${transcript}"\n`);

    // Check for exit commands
    const lower = transcript.toLowerCase();
    if (/\b(stop|exit|quit|bye|goodbye|au revoir|arete)\b/i.test(lower)) {
      console.log("  👋 Goodbye!");
      await speak("Goodbye!", voice);
      return "__EXIT__";
    }

    // Check for morning briefing trigger
    if (/\b(good morning|bonjour|bon matin|morning briefing|brief me|start my day)\b/i.test(lower)) {
      console.log("  ☀️ Generating your morning briefing...\n");
      const briefing = await getSpokenBriefing();
      console.log(`\n  🗣️  Janjak: ${briefing}\n`);
      await speak(briefing, voice);
      history.push({ role: "user", content: transcript });
      history.push({ role: "assistant", content: briefing });
      return transcript;
    }

    // Check for task creation intent
    if (looksLikeTaskCreation(transcript)) {
      console.log("  📝 Detecting task...\n");
      try {
        const task = await createTaskFromText(transcript);
        if (task) {
          const confirm = formatSpokenConfirmation(task);
          console.log("  ✅ Task created!");
          console.log(formatCreatedTask(task));
          console.log(`\n  🗣️  Janjak: ${confirm}\n`);
          await speak(confirm, voice);
          history.push({ role: "user", content: transcript });
          history.push({ role: "assistant", content: confirm });
          return transcript;
        }
      } catch {
        // Fall through to normal AI chat if parsing fails
      }
    }

    // Process through Janjak AI with conversation history
    console.log("  🧠 Thinking...");
    let response: string;
    try {
      response = await runAgent(transcript, { history });
    } catch (err) {
      console.log("  ❌ AI error:", err instanceof Error ? err.message : "Unknown");
      return false;
    }

    // Update conversation history
    history.push({ role: "user", content: transcript });
    history.push({ role: "assistant", content: response });

    console.log(`\n  🗣️  Janjak: ${response}\n`);

    // Speak the response
    await speak(response, voice);
    // Detect if response suggests an actionable command
    const action = detectAction(response, transcript);
    if (action) {
      console.log(`  \u26a1 Janjak can ${action.label} for you.`);
      await speak(`Want me to ${action.label}?`, voice);
      const yes = await promptYesNo(`  \u2794 ${action.label}? (y/n) `);
      if (yes) {
        console.log(`  \u23f3 Running...`);
        try {
          const result = await action.execute();
          console.log(`  \u2705 ${result}`);
          await speak(result, voice);
        } catch (err) {
          console.log(`  \u274c Failed:`, err instanceof Error ? err.message : "Unknown");
        }
      } else {
        console.log("  \ud83d\udc4c Got it, skipping.");
      }
    }
    return transcript;
  };

  if (loop) {
    console.log("  📢 Continuous mode — say \"stop\" or \"exit\" to quit\n");

    while (true) {
      const result = await runOnce();

      // Exit if user said a stop word
      if (result === "__EXIT__") break;

      console.log("─".repeat(40));
      console.log("  Ready for next question...\n");

      // Small pause between rounds
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    await runOnce();
    console.log("  💡 Use `janjak voice --loop` for continuous conversation");
  }

  // Clean up recording
  try { unlinkSync(RECORDING_PATH); } catch {}
}

/** Check if voice commands are available on this system */
export function isVoiceAvailable(): boolean {
  try {
    execSync("which say", { stdio: "ignore", timeout: 2000 });
    execSync("which swiftc", { stdio: "ignore", timeout: 2000 });
    return !!process.env["OPENAI_API_KEY"];
  } catch {
    return false;
  }
}
