#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  AGENT_DIR,
  AUTH_PATH,
  EXTENSION_SOURCE,
  MODELS_PATH,
  NOTES_SETTINGS_PATH,
  PI_CLI_PATH,
  PI_SOURCE_DIR,
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

async function init(quiet = false): Promise<void> {
  await mkdir(join(AGENT_DIR, "notes-compaction"), { recursive: true, mode: 0o700 });
  await mkdir(join(AGENT_DIR, "sessions"), { recursive: true, mode: 0o700 });
  await writeJson(SETTINGS_PATH, { packages: [EXTENSION_SOURCE] });
  const settings = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as {
    packages?: Array<string | { source: string }>;
  };
  const packages = settings.packages ?? [];
  const localPackage = packages.find(
    (entry) => (typeof entry === "string" ? entry : entry.source) === EXTENSION_SOURCE,
  );
  const otherPackages = packages.filter((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return source !== EXTENSION_SOURCE &&
      source !== "npm:@howaboua/pi-notes-compaction" &&
      !source.startsWith("npm:@howaboua/pi-notes-compaction@");
  });
  const nextPackages = [...otherPackages, localPackage ?? EXTENSION_SOURCE];
  if (JSON.stringify(packages) !== JSON.stringify(nextPackages)) {
    await writeFile(SETTINGS_PATH, `${JSON.stringify({ ...settings, packages: nextPackages }, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  await writeJson(AUTH_PATH, {});
  await writeJson(MODELS_PATH, {});
  await writeJson(NOTES_SETTINGS_PATH, {
    active: "all",
    normalCompaction: false,
    newWindowRequests: "unrestricted",
    idleMinutes: 0,
    taskBoundaryReminder: 0,
  });

  if (!quiet) {
    console.log(`Initialized Relay profile at ${AGENT_DIR}`);
    console.log(`Pi source: ${PI_SOURCE_DIR}`);
    console.log(`Notes extension: ${EXTENSION_SOURCE}`);
    console.log("Start Relay and use /login to connect a provider.");
  }
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

  checks.push([
    "Pi source",
    existsSync(PI_SOURCE_DIR),
    existsSync(PI_SOURCE_DIR)
      ? PI_SOURCE_DIR
      : "missing submodule; run git submodule update --init --recursive",
  ]);
  checks.push([
    "Pi build",
    existsSync(PI_CLI_PATH),
    existsSync(PI_CLI_PATH) ? PI_CLI_PATH : "missing; run npm run bootstrap",
  ]);
  checks.push([
    "notes/context extension",
    existsSync(join(EXTENSION_SOURCE, "package.json")),
    existsSync(join(EXTENSION_SOURCE, "package.json"))
      ? EXTENSION_SOURCE
      : "missing submodule; run git submodule update --init --recursive",
  ]);
  try {
    const settings = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as {
      packages?: Array<string | { source: string }>;
    };
    const declared = settings.packages?.some(
      (entry) => (typeof entry === "string" ? entry : entry.source) === EXTENSION_SOURCE,
    ) ?? false;
    checks.push(["local extension configuration", declared, declared ? EXTENSION_SOURCE : "run relay init"]);
  } catch {
    checks.push(["local extension configuration", false, "run relay init"]);
  }
  try {
    const Database = createRequire(import.meta.url)("better-sqlite3");
    const db = new Database(":memory:");
    try {
      db.prepare("SELECT 1").get();
    } finally {
      db.close();
    }
    checks.push(["notes SQLite storage", true, "binding loaded and query completed"]);
  } catch (error) {
    checks.push(["notes SQLite storage", false, error instanceof Error ? error.message : String(error)]);
  }

  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "OK" : "NEEDS ATTENTION"}  ${name}: ${detail}`);
  }
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

function startPi(args: string[]): Promise<void> {
  if (!existsSync(PI_CLI_PATH)) {
    throw new Error(`Local Pi build is missing at ${PI_CLI_PATH}; run npm run bootstrap first`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PI_CLI_PATH, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PI_CODING_AGENT_DIR: AGENT_DIR },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Pi exited with signal ${signal}`));
      else {
        process.exitCode = code ?? 1;
        resolve();
      }
    });
  });
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

  if (!args.includes("--help") && !args.includes("-h") && !args.includes("--version") && !args.includes("-v")) {
    await init(true);
  }
  await startPi(args);
}

await run().catch((error: unknown) => {
  console.error(`Relay: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
