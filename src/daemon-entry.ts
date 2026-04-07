#!/usr/bin/env node
// ─── Daemon Entry Point (for background spawning) ────────────────
import { config } from "dotenv";
import { join } from "node:path";
import { homedir } from "node:os";

config({ path: join(homedir(), ".janjak", ".env") });

import { startDaemon } from "./daemon.js";
startDaemon();
