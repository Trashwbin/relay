import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

export const RELAY_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const RELAY_HOME = resolve(process.env.RELAY_HOME ?? join(homedir(), ".relay"));
export const AGENT_DIR = join(RELAY_HOME, "agent");
export const NOTES_SETTINGS_PATH = join(AGENT_DIR, "notes-compaction", "settings.json");
export const SETTINGS_PATH = join(AGENT_DIR, "settings.json");
export const AUTH_PATH = join(AGENT_DIR, "auth.json");
export const MODELS_PATH = join(AGENT_DIR, "models.json");
export const PI_SOURCE_DIR = join(RELAY_ROOT, "vendor", "pi");
export const PI_CLI_PATH = join(PI_SOURCE_DIR, "packages", "coding-agent", "dist", "bundle", "cli.js");
export const RELAY_IDENTITY_EXTENSION = join(RELAY_ROOT, "extensions", "relay-identity.js");
export const EXTENSION_SOURCE = join(
  RELAY_ROOT,
  "vendor",
  "pi-stuff",
  "packages",
  "pi-notes-compaction",
);

