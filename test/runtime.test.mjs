import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli.js");
const plugin = join(root, "vendor", "pi-stuff", "packages", "pi-notes-compaction");
const identityExtension = join(root, "extensions", "relay-identity.js");
const memoryExtension = join(root, "vendor", "pi-extension", "packages", "memory-layer", "index.ts");

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
    env,
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
    extensions: ["./custom-extension.js", memoryExtension],
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
    extensions: ["./custom-extension.js", memoryExtension, identityExtension],
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

test("Relay identity extension brands the system prompt and preserves dynamic tool guidance", async () => {
  const { default: extension } = await import("../extensions/relay-identity.js");
  let beforeAgentStart;
  extension({
    on(event, handler) {
      assert.equal(event, "before_agent_start");
      beforeAgentStart = handler;
    },
  });

  const options = {
    selectedTools: ["read", "bash"],
    hiddenTools: ["bash"],
    toolSnippets: { read: "Read files from the workspace.", bash: "Run shell commands." },
    toolGuidelines: { read: ["Read the target file before editing it."] },
    promptGuidelines: ["Preserve established project conventions."],
    sections: { context_window_guidance: "Save task state at meaningful milestones." },
  };
  beforeAgentStart({ systemPromptOptions: options });

  assert.match(options.customPrompt, /You are Relay/);
  assert.doesNotMatch(options.customPrompt, /\bPi\b|\bpi\b/);
  assert.match(options.sections.relay_tools, /- read: Read files/);
  assert.doesNotMatch(options.sections.relay_tools, /bash/);
  assert.match(options.sections.relay_guidance, /Read the target file before editing it/);
  assert.match(options.sections.relay_guidance, /Preserve established project conventions/);
  assert.equal(options.sections.context_window_guidance, "Save task state at meaningful milestones.");

  const existingPrompt = options.customPrompt;
  beforeAgentStart({ systemPromptOptions: options });
  assert.equal(options.customPrompt, existingPrompt);

  const configured = { ...options, customPrompt: "Follow the user's preferred language." };
  beforeAgentStart({ systemPromptOptions: configured });
  assert.ok(configured.customPrompt.startsWith(existingPrompt));
  assert.ok(configured.customPrompt.endsWith("Follow the user's preferred language."));
});

test("Relay starts its vendored Pi entry point", async (t) => {
  const f = await fixture(t);
  const result = f.run("--version");
  const manifest = JSON.parse(await readFile(join(root, "vendor", "pi", "packages", "coding-agent", "package.json"), "utf8"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), manifest.version);
});

test("Relay sends its identity, project context, and Notes tools to a local model endpoint", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run("init").status, 0);
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push({ path: req.url, body: JSON.parse(body) });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = {
        id: "relay-local-response",
        object: "chat.completion.chunk",
        created: 1,
        model: "identity-test",
        choices: [{ index: 0, delta: { role: "assistant", content: "Relay." }, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write(`data: ${JSON.stringify({
        ...chunk,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 },
      })}\n\n`);
      res.end("data: [DONE]\n\n");
    } catch (error) {
      res.writeHead(400);
      res.end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  await writeFile(join(f.agentDir, "models.json"), JSON.stringify({
    providers: {
      "relay-test": {
        api: "openai-completions",
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        apiKey: "local-test-only",
        models: [{
          id: "identity-test",
          reasoning: false,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 128,
        }],
      },
    },
  }));
  await writeFile(join(f.cwd, "AGENTS.md"), "Project instruction: preserve the Relay fixture marker 4729.\n");

  const child = spawn(process.execPath, [
    cli, "--provider", "relay-test", "--model", "identity-test",
    "--thinking", "off", "--no-session", "--no-skills", "--no-prompt-templates",
    "--no-themes", "--print", "Identify yourself in one word.",
  ], { cwd: f.cwd, env: f.env, detached: true, signal: AbortSignal.timeout(20_000) });
  child.stdin.end();
  t.after(() => {
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (data) => { stdout += data; });
  child.stderr.setEncoding("utf8").on("data", (data) => { stderr += data; });
  const status = await new Promise((resolve, reject) => {
    child.once("error", (error) => reject(new Error(
      `${error.message}; requests=${requests.length}; stdout=${stdout}; stderr=${stderr}`,
      { cause: error },
    )));
    child.once("close", resolve);
  });
  assert.equal(status, 0, stderr);
  assert.match(stdout, /Relay\./);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/v1/chat/completions");
  const payload = requests[0].body;
  const systemMessages = payload.messages.filter(
    (message) => message.role === "system" || message.role === "developer",
  );
  const systemPrompt = systemMessages.map((message) => message.content).join("\n");
  assert.ok(systemPrompt.startsWith("You are Relay, the user's AI work companion."));
  assert.doesNotMatch(systemPrompt, /operating inside pi|Pi documentation/);
  assert.match(systemPrompt, /<relay_tools>[\s\S]*- read:/);
  assert.match(systemPrompt, /<relay_guidance>/);
  assert.match(systemPrompt, /preserve the Relay fixture marker 4729/);
  assert.ok(payload.messages.some(
    (message) => message.role === "user" && JSON.stringify(message.content).includes("<context_window_guidance>"),
  ), "Notes window guidance reaches the model as a user message");
  for (const name of [
    "notes", "history", "new_context", "get_context_remaining",
    "memory_remember", "memory_recall", "memory_forget", "memory_list",
  ]) {
    assert.ok(payload.tools.some((tool) => tool.function?.name === name), `${name} reaches the model`);
  }
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
  const identity = resourceLoader.getExtensions().extensions.find(
    (extension) => extension.path === identityExtension || extension.resolvedPath === identityExtension,
  );
  assert.ok(identity, "Relay identity extension is loaded from the Relay repository");
  assert.ok(identity.handlers.get("before_agent_start")?.length, "Relay identity hook is registered");
  const memory = resourceLoader.getExtensions().extensions.find(
    (extension) => extension.path === memoryExtension || extension.resolvedPath === memoryExtension,
  );
  assert.ok(memory, "Memory Layer is loaded from the vendored repository");
  assert.ok(memory.handlers.get("before_agent_start")?.length, "Memory Layer hook is registered");
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
    for (const name of [
      "notes", "history", "new_context", "get_context_remaining",
      "memory_remember", "memory_recall", "memory_forget", "memory_list",
    ]) {
      assert.ok(session.getActiveToolNames().includes(name), `${name} is active`);
      const info = session.getAllTools().find((tool) => tool.name === name);
      const expectedSource = name.startsWith("memory_")
        ? memoryExtension
        : join(plugin, "src", "index.ts");
      assert.equal(info.sourceInfo.path, expectedSource, `${name} comes from its Relay source`);
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
    const remember = session.getToolDefinition("memory_remember");
    const memoryText = "Use Chinese for Relay explanations.";
    const saved = await remember.execute("memory-write-test", {
      content: memoryText, title: "Relay language preference", scope: "user", tier: "profile", topic: "general",
    }, undefined, undefined, ctx);
    assert.ok(saved.content.some((block) => block.type === "text" && block.text.includes("Memory saved.")));
    const recall = session.getToolDefinition("memory_recall");
    const recalled = await recall.execute("memory-read-test", {
      query: "language preference", scope: "user",
    }, undefined, undefined, ctx);
    assert.ok(recalled.content.some((block) => block.type === "text" && block.text.includes(memoryText)));
    const memoryIndex = await readFile(join(f.agentDir, "memory", "user", "MEMORY.md"), "utf8");
    assert.match(memoryIndex, /Relay language preference/);
  } finally {
    session.dispose();
    await settingsManager.flush();
  }
});
