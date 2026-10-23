import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const RELAY_HOME = resolve(process.env.RELAY_HOME ?? join(homedir(), ".relay"));
export const AGENT_DIR = join(RELAY_HOME, "agent");
export const NOTES_SETTINGS_PATH = join(AGENT_DIR, "notes-compaction", "settings.json");
export const SETTINGS_PATH = join(AGENT_DIR, "settings.json");
export const AUTH_PATH = join(AGENT_DIR, "auth.json");
export const MODELS_PATH = join(AGENT_DIR, "models.json");
export const EXTENSION_SOURCE = "npm:@howaboua/pi-notes-compaction@0.0.9";

