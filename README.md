# Relay

Relay is an AI work companion built on Pi. The first milestone provides an
isolated CLI, a private Pi agent directory, and a pinned notes/context
continuity extension. Pi remains the replaceable runtime; Relay owns product
configuration and the default capability bundle.

## Requirements

- Node.js 22.19 or newer
- An API key or provider login configured in the Relay profile

## Develop

```sh
npm install
npm run build
npm link
node dist/cli.js init
node dist/cli.js doctor
node dist/cli.js
```

`relay init` creates `~/.relay/agent` and installs the pinned
`@howaboua/pi-notes-compaction` package into that isolated Pi profile.
Existing `~/.pi` settings, sessions, credentials, and notes stay separate.

Start Relay from the project directory you want it to work in:

```sh
cd /path/to/project
relay
```

Use `relay help` for Relay commands. Relay passes ordinary Pi CLI arguments through, so `relay --help`,
`relay --model <provider>/<model>`, and Pi commands remain available.

## Configuration

Relay sets `PI_CODING_AGENT_DIR` to `~/.relay/agent`. Its configuration files:

```text
~/.relay/
└── agent/
    ├── auth.json
    ├── models.json
    ├── settings.json
    ├── sessions/
    └── notes-compaction/
        ├── notes.sqlite
        └── settings.json
```

Provider credentials belong to Relay's `auth.json`, or can be configured
through Pi's `/login` flow after starting Relay. Add custom providers and model
definitions to `models.json`; choose the default model in `settings.json`.
`relay doctor` reports whether the profile and pinned extension are ready.
Set `RELAY_HOME=/absolute/path` to select a separate Relay profile.
Initialization preserves existing configuration and installs the pinned plugin
through Pi's package manager. Plugin installation builds its SQLite dependency.
The first milestone uses Pi's TUI; Relay branding and additional integrations
can be added as extensions.

## Product boundary

```text
relay CLI
  -> Pi CLI / agent runtime
  -> Notes Compaction extension
  -> project files, sessions, MCP, skills, and model providers
```

Relay composes and configures Pi through its public CLI/package interfaces.
The Pi source remains an upstream dependency and does not live in this repo.
