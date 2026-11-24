# ollama-quota

Appends one statusline line with Ollama Cloud quota, after the existing
statusline (claude-hud):

```
Day █████░░░░░ 50% ($2.49/$5, resets in 2h 40m) │ Month ██████░░░░ 61% ($23.36 left, resets in 25d)
```

- **Day** — artificial $5/day budget. Spend comes from `/api/usage?range=24h`,
  resets at local midnight.
- **Month** — real Ollama Cloud balance: included credits used, remaining
  included plus purchased credits, resets at the end of the subscription period.
- Bar colors match claude-hud's usage limits: bright blue below 75%, bright
  magenta at 75–89%, red at 90% and above.

The plugin does not replace claude-hud. Its setup wraps the current
`statusLine.command` and appends this line, so the HUD keeps rendering its own
project/context rows.

## Requirements

- Claude Code with `statusLine` support.
- Node.js 18 or newer (uses the built-in `fetch`).
- A local Ollama daemon signed in with `ollama signin`, or an Ollama API key for
  direct `ollama.com` access.

## Install

```
/plugin marketplace add Clickman6/plugins
/plugin install ollama-quota@plugins
/ollama-quota:setup
```

Restart Claude Code after setup. The installer:

- copies the runtime to `~/.claude/ollama-quota/`;
- saves the current statusline command to
  `~/.claude/ollama-quota/hud-statusline.sh`;
- writes a composite `statusLine.command`;
- creates a `~/.claude/settings.json` backup before changing it.

The setup is idempotent. Re-run `/ollama-quota:setup` after `/hud` (claude-hud
setup or reconfiguration) or after any other statusline change.

## Configuration

Environment variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `OLLAMA_QUOTA_DAILY_LIMIT` | `5` | Daily budget in USD |
| `OLLAMA_QUOTA_URL` | auto | Explicit endpoint; overrides auto-detection |
| `OLLAMA_API_KEY` | — | Bearer token for `ollama.com` (falls back to `ANTHROPIC_AUTH_TOKEN`) |
| `OLLAMA_QUOTA_CACHE` | `~/.claude/ollama-quota/cache.json` | Cache path |

Endpoint resolution order:

1. `OLLAMA_QUOTA_URL`;
2. `ANTHROPIC_BASE_URL`, if it points at `ollama.com` or a daemon on port `11434`;
3. `OLLAMA_HOST`, with `0.0.0.0`/`[::]` bind addresses mapped to `127.0.0.1`;
4. `http://127.0.0.1:11434`.

For `ollama.com`, requests carry `Authorization: Bearer` from `OLLAMA_API_KEY`,
falling back to `ANTHROPIC_AUTH_TOKEN`. The literal token `ollama` (used by
`ollama launch`) is not sent.

The line is rendered only when the session goes through Ollama:
`ANTHROPIC_BASE_URL` points at `ollama.com` or `*:11434`,
`ANTHROPIC_AUTH_TOKEN=ollama`, or `OLLAMA_QUOTA_URL` is set explicitly.
Anthropic sessions stay untouched.

## How it works

`render` runs on every statusline refresh. It reads the cache synchronously,
prints one line, and never touches the network. If the cache is missing, older
than 60 seconds, or from the previous local day, it starts `refresh` in the
background.

`refresh` requests `/api/balance` and `/api/usage?range=24h` with a 3-second
timeout, validates the response, and writes the cache atomically. A lock keeps
several Claude Code sessions from refreshing at once; failures back off from 60
seconds up to 15 minutes, honouring `Retry-After` on 429.

Errors appear as a dim suffix: `· offline`, `· sign-in required`,
`· rate limited`, `· stale`, or `· unsupported balance`. The last successful
values stay visible while a refresh is failing.

## Diagnostics

```bash
node ~/.claude/ollama-quota/ollama-quota.mjs refresh --force
node ~/.claude/ollama-quota/ollama-quota.mjs render
```

Cache: `~/.claude/ollama-quota/cache.json`.

`refresh --force` is also useful after `ollama signin` or after changing
`OLLAMA_API_KEY`.

## Development

Tests run in a throwaway Docker container; nothing is installed on the host:

```bash
./test.sh
```

The runtime is a single ESM file with no dependencies. The self-test covers the
bar thresholds, month math, day spend with buckets crossing local midnight,
endpoint resolution, auth headers, and the rendered line.

## Troubleshooting

- **The line is missing.** Check that the session is an Ollama session (see
  above), that `CLAUDE_HUD_DISABLE` is not set, and that
  `/ollama-quota:setup` was run after the last `/hud`.
- **`unsupported balance`.** The account is on a legacy plan that returns
  `session`/`weekly` percentages instead of `allowance_usd`/`balance_usd`.
- **`sign-in required`.** For a local daemon run `ollama signin`; for
  `ollama.com` set `OLLAMA_API_KEY` and run `refresh --force`.
- **HUD doctor sees the statusline as another command.** That is expected: this
  plugin intentionally wraps the HUD command. Do not run
  `hud install --replace` without re-running `/ollama-quota:setup` afterwards.

## License

MIT.
