#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DefaultPackageManager,
  main as piMain,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  AGENT_DIR,
  AUTH_PATH,
  EXTENSION_SOURCE,
  MODELS_PATH,
  NOTES_SETTINGS_PATH,
  RELAY_HOME,
  SETTINGS_PATH,
} from "./config.js";

process.env.PI_CODING_AGENT_DIR = AGENT_DIR;

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`Relay: AI Work Companion

Usage:
  relay [pi options]       Start the Pi-powered Relay TUI
  relay init               Create an isolated Relay profile
  relay doctor             Check Relay configuration
  relay config             Print Relay configuration paths

Examples:
  cd /path/to/project && relay
  relay --model provider/model
  relay --help            Show all Pi runtime options`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    },
  );
}

function packageManager(): DefaultPackageManager {
  const cwd = process.cwd();
  return new DefaultPackageManager({
    cwd,
    agentDir: AGENT_DIR,
    settingsManager: SettingsManager.create(cwd, AGENT_DIR, { projectTrusted: false }),
  });
}

async function init(): Promise<void> {
  await mkdir(join(AGENT_DIR, "notes-compaction"), { recursive: true, mode: 0o700 });
  await mkdir(join(AGENT_DIR, "sessions"), { recursive: true, mode: 0o700 });
  await writeJson(SETTINGS_PATH, {});
  await writeJson(AUTH_PATH, {});
  await writeJson(MODELS_PATH, {});
  await writeJson(NOTES_SETTINGS_PATH, {
    active: "all",
    normalCompaction: false,
    newWindowRequests: "unrestricted",
    idleMinutes: 0,
    taskBoundaryReminder: 0,
  });

  console.log(`Preparing ${EXTENSION_SOURCE}`);
  await packageManager().installAndPersist(EXTENSION_SOURCE);
  console.log(`Initialized Relay profile at ${AGENT_DIR}`);
  console.log("Start Relay and use /login to connect a provider.");
}

async function doctor(): Promise<void> {
  const checks: Array<[string, boolean, string]> = [];
  for (const path of [SETTINGS_PATH, AUTH_PATH, MODELS_PATH, NOTES_SETTINGS_PATH]) {
    try {
      JSON.parse(await readFile(path, "utf8"));
      checks.push([path, true, "valid JSON"]);
    } catch (error) {
      checks.push([path, false, `run relay init; ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  try {
    const settings = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as {
      packages?: Array<string | { source?: string }>;
    };
    const declared = settings.packages?.some(
      (entry) => (typeof entry === "string" ? entry : entry.source) === EXTENSION_SOURCE,
    ) ?? false;
    const installedPath = packageManager().getInstalledPath(EXTENSION_SOURCE, "user");
    const manifest = installedPath
      ? JSON.parse(await readFile(join(installedPath, "package.json"), "utf8")) as { version?: string }
      : undefined;
    const installed = declared && manifest?.version === EXTENSION_SOURCE.split("@").at(-1);
    checks.push([
      "notes/context extension",
      installed,
      installed ? `${EXTENSION_SOURCE} at ${installedPath}` : "run relay init to install the pinned extension",
    ]);
  } catch {
    checks.push(["notes/context extension", false, "Relay settings could not be read"]);
  }

  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "OK" : "NEEDS ATTENTION"}  ${name}: ${detail}`);
  }
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

async function run(): Promise<void> {
  if (command === "help") {
    printHelp();
    return;
  }
  if (command === "init") return init();
  if (command === "doctor") return doctor();
  if (command === "config") {
    console.log(`Relay home:     ${RELAY_HOME}`);
    console.log(`Agent profile:  ${AGENT_DIR}`);
    console.log(`Pi settings:    ${SETTINGS_PATH}`);
    console.log(`Provider auth:  ${AUTH_PATH}`);
    console.log(`Model catalog:  ${MODELS_PATH}`);
    console.log(`Notes settings: ${NOTES_SETTINGS_PATH}`);
    return;
  }

  if (args.length === 0) {
    try {
      await readFile(SETTINGS_PATH, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await init();
    }
  }
  await piMain(args);
}

await run().catch((error: unknown) => {
  console.error(`Relay: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
