# Pulse Execution via Claude Code

**Date:** 2026-09-22
**Status:** Design approved, pending implementation plan
**Supersedes:** the OAuth credential layer described in the current codebase
**Related:** `2026-09-22-release-channels-design.md`

## Problem

ClaudePulse maintains its own OAuth credential layer and calls the model through
`@anthropic-ai/claude-agent-sdk`. A subscription credential authenticates Claude
Code itself, so the supported way to use one programmatically is to run Claude
Code. ClaudePulse should therefore schedule the CLI rather than reimplement a
client around the same credential.

The current layer also carries `forceSubscriptionTypePro`, which replaces the
`subscription_type` returned by the token endpoint with a hardcoded value:

```js
// OAuthManager.js:201-204
const subscriptionType = oauthConfig.forceSubscriptionTypePro
  ? "pro"
  : tokenData.subscription_type || null;
```

Rewriting a field the issuer populated is not something the application should
do, and once the CLI owns authentication there is nothing left for it to act on.

## Root cause of the workaround

The workaround addressed a self-inflicted problem. The earlier investigation took
the output of `claude setup-token` and pasted it into `.credentials.json`. The
documentation states that command *"does not save the token anywhere"* — it is
meant to be exported as `CLAUDE_CODE_OAUTH_TOKEN`. That produced an unsupported
credential state, and the failure followed from it.

The supported configuration was never tried: those tests required the
environment variable to be **empty** in order to run.

Verified on 2026-09-22, with a clean config directory and no credentials file:

```
$ CLAUDE_CODE_OAUTH_TOKEN=<token> claude -p "pulse check"
→ normal response, exit 0
→ no .credentials.json created
→ no subscriptionType manipulation
```

## Design

ClaudePulse stops being a Claude client. It becomes a scheduler that runs Claude
Code as a subprocess.

```
BEFORE                                AFTER
──────                                ─────
ClaudePulse                           ClaudePulse
  ├─ OAuthManager                       └─ spawn: claude -p
  ├─ CredentialStore                          └─ CLI owns auth entirely
  ├─ OAuthStateStore
  ├─ auth-config
  └─ Agent SDK ──▶ API
```

The licence attaches to the product making the request. `claude -p` on a
schedule is Claude Code running without a browser, which is the documented
purpose of `CLAUDE_CODE_OAUTH_TOKEN`.

### Removed

- `OAuthManager.js`, `CredentialStore.js`, `OAuthStateStore.js`, `auth-config.js`
- `oauth-verify.js`, `oauth-status.js` and their npm scripts
- `forceSubscriptionTypePro` in every form
- The `@anthropic-ai/claude-agent-sdk` dependency
- The `.credentials.json` volume mount — nothing writes it any more

### Retained

Four fixes are orthogonal to this change and stay:

- Authentication failures are not retried. Under this design a dead token
  surfaces as a non-zero subprocess exit, so this matters more, not less.
- Consecutive-failure alerts are spaced exponentially rather than fired every
  cycle.
- Secrets are masked in the startup configuration log.
- `Logger.child()` propagates `discordWebhookUrl`. Without it every alert raised
  through a child logger was silently discarded, which is why no alert ever
  arrived during a 41-day outage.

## Cheap pulse

A pulse carries no useful payload. Its only job is to open a session window, so
every token it spends is overhead. The configuration below was measured, not
assumed.

### Measurements

All runs: Haiku, empty working directory, `--strict-mcp-config`,
`--settings '{}'`, `--no-session-persistence`, prompt `"ok"`.

| Configuration                        | Cost/pulse | cache_read | thinking |
| ------------------------------------ | ---------- | ---------- | -------- |
| Thinking enabled                     | $0.0161    | 13,856     | 148      |
| Custom `--system-prompt`             | $0.0287    | **0**      | 0        |
| **Default prompt, thinking disabled**| **$0.0076**| 17,771     | 0        |

### The counterintuitive finding

Overriding the system prompt to shrink it **doubles the cost**. A custom prompt
does not match the cached prefix, so the entire context is re-created at 1.25×
instead of being read at 0.1×. The default system prompt is the cheap one
precisely because it is cached.

Keep the default. Spend the effort on thinking tokens and model choice instead.

### Specified configuration

```
cwd:     an empty directory, never the application directory
model:   --model haiku
env:     MAX_THINKING_TOKENS=0
         CLAUDE_CONFIG_DIR=<a directory used only for pulses>
flags:   --strict-mcp-config --settings '{}' --no-session-persistence
prompt:  a short fixed string
```

A second set of measurements, taken against the real CLI rather than a stub:

| Config directory        | Cost/pulse |
| ----------------------- | ---------- |
| Inherited from the host | $0.0360    |
| Pinned, cold cache      | $0.0152    |
| Pinned, warm cache      | $0.0076    |

`--settings '{}'` and `--strict-mcp-config` are not sufficient on their own.
Without a pinned `CLAUDE_CONFIG_DIR` the pulse still loads whatever skills,
plugins and agents the host's configuration directory contains, which cost
2.4x more here. The first pulse after a restart pays cache creation; steady
state is the warm figure.

Each element earns its place:

- **Empty cwd** — `claude -p` inherits the working directory and loads project
  context. Run from the application directory and every pulse pays for reading
  the codebase. An unmeasured run against this repository returned a full
  project report, which is exactly what a pulse must not do.
- **Haiku** — the cheapest current model, and a pulse needs no capability.
- **`MAX_THINKING_TOKENS=0`** — thinking was 148 of 169 output tokens by default.
- **`--strict-mcp-config`** — excludes MCP servers and their tool definitions.
- **`--settings '{}'`** — excludes user settings, skills and hooks.
- **`CLAUDE_CONFIG_DIR`** — pins the configuration directory so the pulse never
  inherits the host's. Measured 2.4x cheaper; see the table above.
- **Default system prompt** — preserves the cache, per the measurement above.

### Do not use `--bare`

`--bare` is the obvious candidate: it advertises *"Minimal mode: skip hooks,
LSP, plugin…"*. It is a trap. The documentation states:

> "Bare mode does not read `CLAUDE_CODE_OAUTH_TOKEN`. If your script passes
> `--bare`, authenticate with `ANTHROPIC_API_KEY` or an `apiKeyHelper` instead."

It would silently break subscription authentication, the one thing this design
depends on.

## Failure handling

`claude -p` exits non-zero on failure. The exit code and stderr replace the SDK
result object the current code parses.

An expired token is not detected in advance: `claude auth status` reports
`loggedIn: true` for a credential that is merely present. This was verified by
passing a deliberately fake token and receiving `loggedIn: true`,
`authMethod: "oauth_token"`. Validity is only established by a real call, so the
non-retryable-auth-error handling is the mechanism that catches expiry.

## Testing

Unit tests cover the executor's handling of exit codes, auth-failure detection,
and the constructed argument list — in particular that `--bare` never appears
and that the model and thinking settings are applied.

An integration test runs a real pulse against a snapshot image and asserts a
successful exit with no credentials file present, which proves the environment
token authenticated the run.

## Open items

- Cost is reported on a list-price basis. On a subscription these are quota
  units rather than charges; the relative comparison is what the table
  establishes.
- Pulse cadence and whether to pulse at all are product questions, separate from
  how the pulse authenticates, and are not decided here.
