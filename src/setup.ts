// ─── Setup Wizard: Browser-based configuration ─────────────────────
// Serves a beautiful setup page at localhost:3548 where users can
// paste their API keys, upload Google credentials, and configure
// Janjak — no terminal editing required.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { exec } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(homedir(), ".janjak");
const ENV_PATH = join(DATA_DIR, ".env");
const CREDS_PATH = join(DATA_DIR, "gmail-credentials.json");
const TOKENS_PATH = join(DATA_DIR, "gmail-tokens.json");
const PORT = 3548;

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function getCurrentConfig(): Record<string, string> {
  const config: Record<string, string> = {};
  if (existsSync(ENV_PATH)) {
    const content = readFileSync(ENV_PATH, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        config[key] = val;
      }
    }
  }
  return config;
}

function getSetupStatus() {
  const config = getCurrentConfig();
  return {
    openaiKey: config["OPENAI_API_KEY"] ? "configured" : "missing",
    openaiKeyPreview: config["OPENAI_API_KEY"] ? config["OPENAI_API_KEY"].slice(0, 7) + "..." : "",
    githubToken: config["GITHUB_TOKEN"] ? "configured" : "missing",
    githubTokenPreview: config["GITHUB_TOKEN"] ? config["GITHUB_TOKEN"].slice(0, 7) + "..." : "",
    googleCreds: existsSync(CREDS_PATH) ? "configured" : "missing",
    googleAuth: existsSync(TOKENS_PATH) ? "authenticated" : "not-authenticated",
    dataDir: DATA_DIR,
  };
}

function saveEnvKey(key: string, value: string) {
  ensureDataDir();
  let content = "";
  if (existsSync(ENV_PATH)) {
    content = readFileSync(ENV_PATH, "utf-8");
  }

  const lines = content.split("\n");
  let found = false;
  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`) || trimmed.startsWith(`# ${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    newLines.push(`${key}=${value}`);
  }

  writeFileSync(ENV_PATH, newLines.join("\n"));
}

function saveGoogleCredentials(jsonStr: string): boolean {
  try {
    const parsed = JSON.parse(jsonStr);
    // Handle both formats: direct or wrapped in "installed"/"web"
    if (parsed.installed || parsed.web) {
      writeFileSync(CREDS_PATH, jsonStr);
      return true;
    }
    // Maybe they pasted just the inner object
    if (parsed.client_id && parsed.client_secret) {
      writeFileSync(CREDS_PATH, JSON.stringify({ installed: parsed }, null, 2));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_SIZE = 1024 * 100; // 100KB max
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // Status endpoint
  if (path === "/api/setup/status") {
    json(res, getSetupStatus());
    return;
  }

  // Save OpenAI key
  if (path === "/api/setup/openai" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!key || !key.startsWith("sk-")) {
      json(res, { error: "Invalid OpenAI key. Should start with sk-" }, 400);
      return;
    }
    saveEnvKey("OPENAI_API_KEY", key);
    json(res, { ok: true });
    return;
  }

  // Save GitHub token
  if (path === "/api/setup/github" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || !(token.startsWith("ghp_") || token.startsWith("github_pat_") || token.startsWith("gho_"))) {
      json(res, { error: "Invalid GitHub token. Should start with ghp_, github_pat_, or gho_" }, 400);
      return;
    }
    saveEnvKey("GITHUB_TOKEN", token);
    json(res, { ok: true });
    return;
  }

  // Save Google credentials JSON
  if (path === "/api/setup/google" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const creds = typeof body.credentials === "string" ? body.credentials.trim() : "";
    if (!creds) {
      json(res, { error: "Empty credentials" }, 400);
      return;
    }
    if (saveGoogleCredentials(creds)) {
      json(res, { ok: true });
    } else {
      json(res, { error: "Invalid Google credentials JSON. Download the file from Google Cloud Console." }, 400);
    }
    return;
  }

  // Trigger Google OAuth flow
  if (path === "/api/setup/google/auth" && method === "POST") {
    // Launch janjak login in a subprocess
    exec("janjak login", { timeout: 120000 }, (err) => {
      // Response already sent
    });
    json(res, { ok: true, message: "Auth flow started — check your terminal" });
    return;
  }

  // Serve setup page
  if (path === "/" || path === "/index.html") {
    try {
      const html = readFileSync(join(__dirname, "..", "web", "setup.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Setup page not found");
    }
    return;
  }

  json(res, { error: "Not found" }, 404);
}

export function startSetupWizard(): Promise<void> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        console.error("Setup error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      });
    });

    server.listen(PORT, "127.0.0.1", () => {
      console.log(`\n🧙 Janjak Setup Wizard`);
      console.log(`   http://localhost:${PORT}`);
      console.log(`\n   Configure Janjak in your browser. Press Ctrl+C when done.\n`);

      import("node:child_process").then(({ exec }) => {
        exec(`open http://localhost:${PORT}`);
      });

      resolve();
    });

    process.on("SIGINT", () => { server.close(); process.exit(0); });
    process.on("SIGTERM", () => { server.close(); process.exit(0); });
  });
}
