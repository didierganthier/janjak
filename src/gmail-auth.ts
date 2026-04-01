// ─── Gmail Auth: OAuth2 flow for Gmail API access ──────────────────
import { google } from "googleapis";
import { createServer } from "node:http";
import { URL } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";

const DATA_DIR = join(homedir(), ".janjak");
const TOKENS_PATH = join(DATA_DIR, "gmail-tokens.json");
const CREDENTIALS_PATH = join(DATA_DIR, "gmail-credentials.json");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
];
const REDIRECT_URI = "http://localhost";

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
}

function loadCredentials(): { clientId: string; clientSecret: string; redirectUri: string } {
  // Try credentials file first, then env vars
  if (existsSync(CREDENTIALS_PATH)) {
    const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
    const creds = raw.installed ?? raw.web ?? raw;
    return {
      clientId: creds.client_id,
      clientSecret: creds.client_secret,
      redirectUri: REDIRECT_URI,
    };
  }

  const clientId = process.env["GMAIL_CLIENT_ID"];
  const clientSecret = process.env["GMAIL_CLIENT_SECRET"];

  if (!clientId || !clientSecret) {
    throw new Error(
      "Gmail credentials not found.\n\n" +
      "Setup:\n" +
      "  1. Go to https://console.cloud.google.com/apis/credentials\n" +
      "  2. Create an OAuth2 client (Desktop app)\n" +
      "  3. Download the JSON and save it as:\n" +
      `     ${CREDENTIALS_PATH}\n\n` +
      "  Or set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars."
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri: REDIRECT_URI,
  };
}

function createOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = loadCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function loadStoredTokens(): StoredTokens | null {
  if (!existsSync(TOKENS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKENS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function saveTokens(tokens: StoredTokens): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

export async function getAuthenticatedClient() {
  const oauth2Client = createOAuth2Client();
  const stored = loadStoredTokens();

  if (stored) {
    oauth2Client.setCredentials(stored);

    // Refresh if expired
    if (stored.expiry_date && stored.expiry_date < Date.now()) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      saveTokens(credentials as StoredTokens);
      oauth2Client.setCredentials(credentials);
    }

    return oauth2Client;
  }

  throw new Error(
    "Not authenticated with Gmail.\nRun: janjak login"
  );
}

function askQuestion(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function extractCodeFromUrl(input: string): string {
  // Accept either a raw code or a full redirect URL
  if (input.startsWith("http")) {
    const url = new URL(input);
    const code = url.searchParams.get("code");
    if (code) return code;
  }
  return input;
}

export async function runOAuthFlow(): Promise<void> {
  const oauth2Client = createOAuth2Client();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\n🔐 Gmail Authentication\n");
  console.log("  1. Open this URL in your browser:\n");
  console.log(`     ${authUrl}\n`);
  console.log("  2. Authorize the app.");
  console.log("  3. You'll be redirected to a page that may not load — that's OK!");
  console.log("  4. Copy the FULL URL from your browser's address bar and paste it below.\n");

  // Try to open the browser automatically
  import("open").then((mod) => mod.default(authUrl)).catch(() => {});

  const input = await askQuestion("  Paste the redirect URL here: ");
  const code = extractCodeFromUrl(input);

  if (!code) {
    console.error("\n❌ Could not extract authorization code. Try again.");
    return;
  }

  const { tokens } = await oauth2Client.getToken(code);
  saveTokens(tokens as StoredTokens);

  console.log("\n✅ Gmail connected! Tokens saved.\n");
  console.log("  Try: janjak inbox\n");
}

export function isAuthenticated(): boolean {
  return loadStoredTokens() !== null;
}
