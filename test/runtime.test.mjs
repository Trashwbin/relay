import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli.js");
const plugin = join(root, "vendor", "pi-stuff", "packages", "pi-notes-compaction");

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "relay-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, "profile");
  const cwd = join(dir, "project");
  await mkdir(cwd);
  const env = { ...process.env, RELAY_HOME: home, PI_OFFLINE: "1", PI_TELEMETRY: "0" };
  return {
    home,
    cwd,
    agentDir: join(home, "agent"),
    run(...args) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd, env, encoding: "utf8", timeout: 30_000,
      });
      assert.ifError(result.error);
      return result;
    },
  };
}

test("init migrates the plugin and retains profile configuration", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.agentDir, "notes-compaction"), { recursive: true });
  const settingsPath = join(f.agentDir, "settings.json");
  const authPath = join(f.agentDir, "auth.json");
  const modelsPath = join(f.agentDir, "models.json");
  const notesPath = join(f.agentDir, "notes-compaction", "settings.json");
  const settings = {
    defaultProvider: "example",
    defaultModel: "custom",
    packages: [
      "npm:another-extension",
      "npm:@howaboua/pi-notes-compaction@0.0.9",
      { source: plugin, extensions: ["src/index.ts"] },
    ],
  };
  const auth = '{"example":{"type":"api_key","key":"test-only"}}\n';
  const models = '{"providers":{}}\n';
  const notes = '{"active":"all","idleMinutes":15}\n';
  await Promise.all([
    writeFile(settingsPath, JSON.stringify(settings)),
    writeFile(authPath, auth),
    writeFile(modelsPath, models),
    writeFile(notesPath, notes),
  ]);
  const init = f.run("init");
  assert.equal(init.status, 0, init.stderr);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    ...settings,
    packages: ["npm:another-extension", { source: plugin, extensions: ["src/index.ts"] }],
  });
  assert.equal(await readFile(authPath, "utf8"), auth);
  assert.equal(await readFile(modelsPath, "utf8"), models);
  assert.equal(await readFile(notesPath, "utf8"), notes);
  const once = await readFile(settingsPath, "utf8");
  assert.equal(f.run("init").status, 0);
  assert.equal(await readFile(settingsPath, "utf8"), once);
  assert.equal(f.run("doctor").status, 0);
  await writeFile(settingsPath, "{}");
  const doctor = f.run("doctor");
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /NEEDS ATTENTION.*local extension configuration/);
});

test("Relay starts its vendored Pi entry point", async (t) => {
  const f = await fixture(t);
  const result = f.run("--version");
  const manifest = JSON.parse(await readFile(join(root, "vendor", "pi", "packages", "coding-agent", "package.json"), "utf8"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), manifest.version);
});

test("the local plugin registers tools and persists notes through the SDK", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run("init").status, 0);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = f.agentDir;
  process.env.PI_OFFLINE = "1";
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
  });
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } =
    await import("../vendor/pi/packages/coding-agent/dist/index.js");
  let ctx;
  const settingsManager = SettingsManager.create(f.cwd, f.agentDir, { projectTrusted: false });
  const resourceLoader = new DefaultResourceLoader({
    cwd: f.cwd,
    agentDir: f.agentDir,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [(pi) => pi.on("session_start", (_event, context) => { ctx = context; })],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const sessionManager = SessionManager.create(f.cwd, join(f.agentDir, "sessions"));
  const { session } = await createAgentSession({
    cwd: f.cwd,
    agentDir: f.agentDir,
    settingsManager,
    resourceLoader,
    sessionManager,
    model: {
      id: "local-test", name: "Local test", api: "openai-completions",
      provider: "relay-test", baseUrl: "http://127.0.0.1:1", reasoning: false,
      input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000, maxTokens: 4096,
    },
  });
  try {
    const errors = [];
    await session.bindExtensions({ onError: (error) => errors.push(error) });
    assert.deepEqual(errors, []);
    assert.ok(ctx);
    for (const name of ["notes", "history", "new_context", "get_context_remaining"]) {
      assert.ok(session.getActiveToolNames().includes(name), `${name} is active`);
      const info = session.getAllTools().find((tool) => tool.name === name);
      assert.ok(info.sourceInfo.path.startsWith(plugin), `${name} comes from local source`);
    }
    const notes = session.getToolDefinition("notes");
    const text = "Relay SDK smoke test: local note storage.";
    await notes.execute("write-test", { action: "write_file", path: "smoke.md", text }, undefined, undefined, ctx);
    const read = await notes.execute("read-test", { action: "read_file", path: "smoke.md" }, undefined, undefined, ctx);
    assert.ok(read.content.some((block) => block.type === "text" && block.text.includes(text)));
    assert.ok(sessionManager.getBranch().some(
      (entry) => entry.type === "custom" && entry.customType === "notes-compaction:note:v1",
    ));
    const sqlite = await readFile(join(f.agentDir, "notes-compaction", "notes.sqlite"));
    assert.equal(sqlite.subarray(0, 15).toString(), "SQLite format 3");
    sessionManager.appendMessage({ role: "user", content: "Relay historical evidence 4729", timestamp: Date.now() });
    const history = session.getToolDefinition("history");
    const found = await history.execute("history-test", {
      action: "search_contents", query: "historical evidence 4729",
    }, undefined, undefined, ctx);
    assert.ok(found.content.some((block) => block.type === "text" && block.text.includes("historical evidence 4729")));
  } finally {
    session.dispose();
    await settingsManager.flush();
  }
});
