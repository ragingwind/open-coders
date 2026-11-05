# open-coders

Launch coding agents against a custom gateway and model with named profiles.
Supported agents: Claude Code (`claude`), OpenCode (`opencode`), and Vercel
`fx`.

## Requirements

- Bun 1.3 or later for development and tests
- The agent you want to launch on `PATH`
- An API key, either in an environment variable or stored in the config file

## Quick start

```sh
open-coders config new          # interactive profile setup
open-coders om                  # launch the profile
open-coders om -p "explain this repository"
```

`config new` asks for the agent, provider, endpoints, credential, and models.
When the gateway exposes a model list, open-coders fetches it automatically and
offers the models for selection. If the endpoint has no model-list API, enter
the model IDs manually.

## Commands

```sh
open-coders                      # TTY: pick a profile; otherwise list profiles and help
open-coders <profile> [args...]  # launch the agent; args are passed through
open-coders config               # interactive menu
open-coders config new           # create a profile
open-coders config update <name> # edit a profile
open-coders config list          # list profiles and report broken references
open-coders config show <name>   # show the resolved command and environment
open-coders config delete <name> [--yes]
```

Non-interactive profile creation:

```sh
open-coders config new \
  --agent claude --name om --provider continuum \
  --model DeepSeek-V4.1-Flash-B300 \
  --base-url-anthropic https://api.console.lablup.ai/anthropic \
  --base-url-openai https://api.console.lablup.ai/v1 \
  --api-key-env LABLUP_CONTINUUM_API_KEY
```

## Configuration

The config file is `${XDG_CONFIG_HOME:-~/.config}/open-coders/config.json` and is
written with mode `0600`.

```json
{
  "version": 1,
  "providers": {
    "continuum": {
      "name": "Lablup Continuum",
      "kind": "custom",
      "auth": {
        "style": "bearer",
        "credential": { "source": "env", "name": "LABLUP_CONTINUUM_API_KEY" }
      },
      "endpoints": {
        "anthropic": "https://api.console.lablup.ai/anthropic",
        "openaiCompatible": "https://api.console.lablup.ai/v1"
      },
      "models": [
        { "key": "deepseek-v4.1", "id": "DeepSeek-V4.1-Flash-B300", "name": "DeepSeek V4.1" }
      ]
    }
  },
  "profiles": {
    "om": {
      "name": "om",
      "agent": "claude",
      "provider": "continuum",
      "model": "deepseek-v4.1",
      "roles": { "opus": "deepseek-v4.1" },
      "limits": { "maxContextTokens": 200000 }
    }
  }
}
```

- `auth.credential` is either `{ "source": "env", "name": "VAR" }` or
  `{ "source": "literal", "value": "..." }`. Prefer the environment variable.
- `endpoints.anthropic` is the Claude Code form (no trailing `/v1`).
  `endpoints.openaiCompatible` is the OpenAI form (usually ends in `/v1`).
- A custom provider needs at least one endpoint. Either endpoint may be
  omitted, and model lists fall back to the other endpoint when the preferred
  one is missing.
- Profiles reference models by `Model.key`; each provider keeps one model
  catalog shared by its profiles.
- Compatibility issues are saved as warnings (`config list` shows them) and
  become errors when the profile is launched. For example, a claude profile can
  be saved without an Anthropic endpoint, but it cannot run until one is added.

## Agent notes

- **claude**: requires `endpoints.anthropic`. `roles` map
  `fable`/`opus`/`sonnet`/`haiku` to model keys and become the corresponding
  `ANTHROPIC_DEFAULT_*_MODEL` variables. `limits` map to
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, and
  `DISABLE_COMPACT`.
- **OpenCode**: `protocol` is `openai-compatible` (default) or `anthropic`.
  The provider and model list are injected through `OPENCODE_CONFIG_CONTENT`;
  no OpenCode config file is modified.
- **fx**: only works with a `vercel-ai-gateway` provider. fx 0.0.5 cannot use a
  custom base URL, so custom gateways are not available through fx.

## Local testing

Bun runs the TypeScript sources directly, so no build step is needed while
developing.

```sh
bun src/index.ts --version
bun src/index.ts config list
bun run dev -- config new        # same as: bun src/index.ts config new
```

Point `XDG_CONFIG_HOME` at a temporary directory so tests do not touch your real
profiles:

```sh
export XDG_CONFIG_HOME=$(mktemp -d /tmp/open-coders-config.XXXXXX)
bun src/index.ts config new
bun src/index.ts config list
```

To launch a profile without starting the real agent, put a fake binary at the
front of `PATH`:

```sh
mkdir -p /tmp/open-coders-bin
printf '#!/bin/sh\nenv | grep ^ANTHROPIC_\nexit 0\n' > /tmp/open-coders-bin/claude
chmod +x /tmp/open-coders-bin/claude

PATH="/tmp/open-coders-bin:$PATH" GW_KEY=secret bun src/index.ts om
```

The interactive TUI needs a real terminal. Run `bun src/index.ts config new`
from a terminal, or use the non-interactive flags shown above.

### Test the packaged tarball

This checks what npm consumers install, including the bin and bundled `dist`:

```sh
T=$(mktemp -d /tmp/open-coders-pkg.XXXXXX)
npm pack --pack-destination "$T"   # prepack builds dist
cd "$T"
npm init -y
npm install ./open-coders-0.1.0.tgz
XDG_CONFIG_HOME="$T/config" ./node_modules/.bin/open-coders --version
```

For a link to the working tree instead of a tarball:

```sh
# in the repository
bun link

# in a scratch project
S=$(mktemp -d /tmp/open-coders-link.XXXXXX)
cd "$S"
bun init -y
bun link open-coders
./node_modules/.bin/open-coders --version
```

Remove the global link with `bun unlink` from the repository.

## Development

```sh
bun install
bun run check        # typecheck + Biome lint + tests
bun run build
node dist/index.js --help
```

Other scripts: `bun run typecheck`, `bun run lint`, `bun run lint:fix`,
`bun run format`, `bun test`, `bun run dev`.

## License

MIT
