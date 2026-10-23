# Relay

Relay is an AI work companion built on Pi. The first milestone provides an
isolated CLI, a private Pi agent directory, and a pinned notes/context
continuity extension. Pi and the extension are included as pinned Git
submodules under `vendor/`; Relay owns the product configuration and the
default capability bundle.

## Requirements

- Node.js 22.19 or newer
- An API key or provider login configured in the Relay profile

## Develop

```sh
git submodule update --init --recursive
npm ci
npm run bootstrap
npm link
relay init
relay doctor
relay
```

`npm run bootstrap` installs dependencies, hydrates the model catalog when needed
(requires network access), and builds the Pi source in `vendor/pi` plus Relay.
The Notes extension loads directly from its TypeScript source; its SQLite
dependency is pinned in Relay's root package. `relay init` creates `~/.relay/agent`.
Existing `~/.pi` settings,
sessions, credentials, and notes stay separate.

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
The first milestone uses Pi's TUI; Relay branding and additional integrations
can be added as extensions.

## Source layout

```text
vendor/
├── pi/                         # earendil-works/pi, pinned commit
└── pi-stuff/                   # howaboua-pi-stuff, pinned commit
    └── packages/pi-notes-compaction/
```

Clone with `git clone --recurse-submodules` or run
`git submodule update --init --recursive` after a normal clone.
Rebuild with `npm run bootstrap` after editing Pi or updating its source pointer.
Restart Relay after editing the Notes extension.

Run `npm test` after bootstrap to verify configuration migration, the local Pi
entry point, extension tool registration, and local notes/history storage through
the SDK. These checks run without model requests.

## Product boundary

```text
relay CLI
  -> Pi CLI / agent runtime
  -> Notes Compaction extension
  -> project files, sessions, MCP, skills, and model providers
```

Relay composes and configures the checked-in Pi source through its CLI
interface. Upstream changes are reviewed by updating the submodule pointer.
