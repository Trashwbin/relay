import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const piDir = join(root, "vendor", "pi");
const notesDir = join(root, "vendor", "pi-stuff", "packages", "pi-notes-compaction");
const require = createRequire(import.meta.url);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(join(piDir, ".git"))) {
  throw new Error("vendor/pi is missing. Run: git submodule update --init --recursive");
}
if (!existsSync(join(notesDir, "package.json"))) {
  throw new Error("vendor/pi-stuff is missing. Run: git submodule update --init --recursive");
}

console.log("Installing Pi source dependencies from its lockfile");
run(npm, ["ci", "--ignore-scripts"], piDir);

const modelData = spawnSync(npm, ["run", "check:model-data"], { cwd: piDir, stdio: "ignore" });
if (modelData.error) throw modelData.error;
if (modelData.status !== 0) {
  console.log("Hydrating Pi model catalog");
  run(npm, ["run", "hydrate:model-data"], piDir);
}

console.log("Building Pi from vendor/pi");
run(npm, ["run", "build:offline"], piDir);

const Database = require("better-sqlite3");
new Database(":memory:").close();

run(npm, ["run", "build"], root);
console.log("Relay source runtime is ready");
