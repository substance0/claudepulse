# Account Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional `ACCOUNT_LABEL` that marks every log line and Discord message, so one container per account can be told apart.

**Architecture:** The label flows from config into the root `Logger` (log prefix and error-alert title, inherited by child loggers) and into the window notifier (title prefix). No scheduler change: several accounts run as one container each.

**Tech Stack:** Node.js 22 ESM, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-09-27-scheduling-and-alerts-design.md` §1

## Global Constraints

- Node ≥ 22, no runtime npm dependencies; tests use `node:test` and `node:assert/strict` only.
- Branch `feat/account-label` from `main`; one PR; conventional commits (`feat:` cuts a minor release on merge).
- Comments and docs describe what the code does now, never what it replaced.
- Secrets never reach logs: `ACCOUNT_LABEL` is not a secret and is logged in the startup config.
- Run the full suite with `npm test` before each commit.

## Review Focus

- A label containing characters Discord or a terminal would render oddly (`*`, `` ` ``, newlines) → rejected at startup by validation.
- A child logger created before any label exists (tests build loggers without one) → no `[]` artefact in the prefix.
- `ACCOUNT_LABEL=""` (set but empty in an env file) → treated as unset, not as an invalid label.
- The error alert raised from a child logger (scheduler) → carries the label, like the webhook URL already does.
- A window notification for a pulse with no usable window → still sends nothing, label or not.

---

### Task 1: Config reads and validates `ACCOUNT_LABEL`

**Files:**
- Modify: `src/core/config/index.js`
- Test: `test/config.redaction.test.js`

**Interfaces:**
- Produces: `config.ACCOUNT_LABEL: string | undefined` (empty string normalised to `undefined`); `validateConfig` error text `ACCOUNT_LABEL must be 1-32 letters, digits, spaces, dots, underscores or hyphens`.

- [ ] **Step 1: Write the failing tests** (append to `test/config.redaction.test.js`)

```js
test("reads the account label from the environment", async () => {
  // Arrange
  const { loadConfig } = await import("../src/core/config/index.js");
  process.env.ACCOUNT_LABEL = "work";

  try {
    // Act
    const config = loadConfig();

    // Assert
    assert.equal(config.ACCOUNT_LABEL, "work");
  } finally {
    delete process.env.ACCOUNT_LABEL;
  }
});

test("an empty account label counts as unset", async () => {
  const { loadConfig } = await import("../src/core/config/index.js");
  process.env.ACCOUNT_LABEL = "";

  try {
    assert.equal(loadConfig().ACCOUNT_LABEL, undefined);
  } finally {
    delete process.env.ACCOUNT_LABEL;
  }
});

test("rejects an account label with characters Discord would format", async () => {
  const { loadConfig, validateConfig } = await import("../src/core/config/index.js");

  for (const label of ["a*b", "a`b", "line\nbreak", "x".repeat(33)]) {
    const config = { ...loadConfig(), ACCOUNT_LABEL: label };
    assert.throws(() => validateConfig(config), /ACCOUNT_LABEL/, JSON.stringify(label));
  }
});

test("accepts a plain account label", async () => {
  const { loadConfig, validateConfig } = await import("../src/core/config/index.js");

  const config = { ...loadConfig(), ACCOUNT_LABEL: "Team A_1.b-2" };

  assert.equal(validateConfig(config), true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/config.redaction.test.js`
Expected: the four new tests FAIL (`undefined !== "work"`, missing `/ACCOUNT_LABEL/` throw). The "empty counts as unset" test may already pass; that is fine, it pins the behaviour.

- [ ] **Step 3: Implement**

In `DEFAULT_CONFIG` add `ACCOUNT_LABEL: undefined,`. In `parseEnvironmentVariables` add `ACCOUNT_LABEL: process.env.ACCOUNT_LABEL || undefined,`. In `validateConfig`, before the `errors.length` check:

```js
  if (
    config.ACCOUNT_LABEL !== undefined &&
    !/^[A-Za-z0-9 ._-]{1,32}$/.test(config.ACCOUNT_LABEL)
  ) {
    errors.push(
      "ACCOUNT_LABEL must be 1-32 letters, digits, spaces, dots, underscores or hyphens",
    );
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/config.redaction.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/index.js test/config.redaction.test.js
git commit -m "feat: read and validate an optional ACCOUNT_LABEL"
```

### Task 2: Logger shows the label and passes it to children

**Files:**
- Modify: `src/core/utils/logger.js` (constructor, `_formatLogEntry`, `error`, `child`)
- Test: create `test/logger.label.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 directly (label passed as an option).
- Produces: `new Logger({ label })`; `logger.label: string | undefined`; prefix `[TIMESTAMP] [LEVEL] [label] [CATEGORY]`; error alert title `🚨 <service> (<label>) Error`.

- [ ] **Step 1: Write the failing tests** (`test/logger.label.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { Logger } from "../src/core/utils/logger.js";

const INFO = 2;
const WEBHOOK = "https://discord.com/api/webhooks/1/test-webhook";

test("prefixes each line with the account label", () => {
  const logger = new Logger({ label: "work", enableColors: false });

  const line = logger._formatLogEntry(INFO, "pulse", "Pulse successful");

  assert.match(line, /\[INFO\] \[work\] \[PULSE\] Pulse successful$/);
});

test("adds no label brackets when no label is set", () => {
  const logger = new Logger({ enableColors: false });

  const line = logger._formatLogEntry(INFO, "pulse", "Pulse successful");

  assert.match(line, /\[INFO\] \[PULSE\] Pulse successful$/);
});

test("a child logger keeps the label of its parent", () => {
  const parent = new Logger({ label: "work" });

  const child = parent.child({ component: "scheduler" });

  assert.equal(child.label, "work");
});

test("error alerts name the account", async (t) => {
  // Arrange: capture what would be posted to Discord
  const posted = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    posted.push(JSON.parse(init.body));
    return { ok: true };
  });
  const logger = new Logger({
    label: "work",
    discordWebhookUrl: WEBHOOK,
    enableColors: false,
  });
  t.mock.method(process.stderr, "write", () => true);

  // Act
  await logger.error("cycle", "All retry attempts exhausted");
  await new Promise((resolve) => setImmediate(resolve));

  // Assert
  assert.equal(posted[0].embeds[0].title, "🚨 claudepulse (work) Error");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/logger.label.test.js`
Expected: FAIL on the prefix (`[work]` missing), `child.label` undefined, and the title `🚨 claudepulse Error`.

- [ ] **Step 3: Implement**

Constructor, after `this.discordWebhookUrl = …`:

```js
    this.label = options.label || undefined;
```

In `_formatLogEntry`, replace the `prefix` line:

```js
    const labelPart = this.label ? ` [${this.label}]` : "";
    const prefix = `${color}[${timestamp}] [${levelName}]${labelPart} [${category.toUpperCase()}]${reset}`;
```

In `error`, replace the alert title:

```js
          title: this.label
            ? `🚨 ${this.service} (${this.label}) Error`
            : `🚨 ${this.service} Error`,
```

In `child`, add to the `new Logger({...})` options:

```js
      label: this.label,
```

- [ ] **Step 4: Run to verify they pass, then the full suite**

Run: `node --test test/logger.label.test.js && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/logger.js test/logger.label.test.js
git commit -m "feat: show the account label in log lines and error alerts"
```

### Task 3: Window notifications carry the label; wire it in `index.js`

**Files:**
- Modify: `src/core/services/windowNotification.js` (`createWindowNotifier`)
- Modify: `src/index.js` (root logger, error logger, notifier)
- Test: `test/windowNotification.test.js`

**Interfaces:**
- Consumes: `config.ACCOUNT_LABEL` (Task 1), `new Logger({ label })` (Task 2).
- Produces: `createWindowNotifier(url, { send, label })`; titles `<label> · Window open`, `<label> · Usage limit reached`.

- [ ] **Step 1: Write the failing tests** (append to `test/windowNotification.test.js`)

```js
test("prefixes the title with the account label", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://discord.test/hook", {
    label: "work",
    send: async (payload) => sent.push(payload),
  });

  await notifier.notify(allowedPulse());

  assert.equal(sent[0].title, "work · Window open");
});

test("keeps the plain title without a label", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://discord.test/hook", {
    send: async (payload) => sent.push(payload),
  });

  await notifier.notify(allowedPulse());

  assert.equal(sent[0].title, "Window open");
});

test("a labelled notifier still sends nothing for a pulse with no window", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://discord.test/hook", {
    label: "work",
    send: async (payload) => sent.push(payload),
  });

  await notifier.notify({ success: false, rateLimit: null });

  assert.deepEqual(sent, []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/windowNotification.test.js`
Expected: the first new test FAILS (`"Window open" !== "work · Window open"`).

- [ ] **Step 3: Implement**

Replace `createWindowNotifier`:

```js
/**
 * Create a notifier that posts window announcements to one webhook.
 * @param {string} webhookUrl - Discord webhook for window announcements
 * @param {{send?: Function, label?: string}} [options] - Discord sender
 *   (overridable in tests) and the account label prefixed to titles
 * @returns {{notify: (pulseResult: Object) => Promise<void>}}
 */
export function createWindowNotifier(
  webhookUrl,
  { send = sendDiscordAlert, label } = {},
) {
  return {
    async notify(pulseResult) {
      const payload = buildWindowNotification(pulseResult);
      if (!payload) {
        return;
      }
      const title = label ? `${label} · ${payload.title}` : payload.title;
      await send({ ...payload, title }, webhookUrl);
    },
  };
}
```

In `src/index.js`:
- root logger: `new Logger({ service: "claudepulse", discordWebhookUrl: config.DISCORD_WEBHOOK_URL, label: config.ACCOUNT_LABEL })`;
- `setupProcessErrorHandlers`: add `label: config?.ACCOUNT_LABEL` to `errLogger`;
- notifier: `createWindowNotifier(config.DISCORD_WINDOW_WEBHOOK_URL, { label: config.ACCOUNT_LABEL })`.

- [ ] **Step 4: Run the suite and a smoke run**

Run: `npm test`
Expected: all PASS.

Run: `DRY_RUN=true ACCOUNT_LABEL=work CLAUDE_CODE_OAUTH_TOKEN=placeholder NO_COLOR=1 node src/index.js | grep "\[work\]" | head -3`
Expected: log lines containing `[INFO] [work] [CONFIG]`.

- [ ] **Step 5: Commit**

```bash
git add src/core/services/windowNotification.js src/index.js test/windowNotification.test.js
git commit -m "feat: label window notifications with the account"
```

### Task 4: Document several accounts

**Files:**
- Modify: `README.md` (Settings table; new "Several Accounts" section after "Discord Notifications")
- Modify: `ENVIRONMENT.md` (Quick Reference row; `ACCOUNT_LABEL` section before "Timezone Configuration")

- [ ] **Step 1: README settings row** (in the Settings table, after `TZ`)

```markdown
| `ACCOUNT_LABEL`              | unset         | Name shown in log lines and Discord messages, to tell accounts apart   |
```

- [ ] **Step 2: README section**

````markdown
### Several Accounts

Run one container per account, each with its own env file and label:

```yaml
services:
  claudepulse-work:
    image: ghcr.io/substance0/claudepulse:latest
    container_name: claudepulse-work
    environment:
      - TZ=Europe/Paris
      - ACCOUNT_LABEL=work
    env_file:
      - work.env
    restart: unless-stopped
  claudepulse-personal:
    image: ghcr.io/substance0/claudepulse:latest
    container_name: claudepulse-personal
    environment:
      - TZ=Europe/Paris
      - ACCOUNT_LABEL=personal
    env_file:
      - personal.env
    restart: unless-stopped
```

Both can share Discord webhooks: every message starts with its account's label.
````

- [ ] **Step 3: ENVIRONMENT.md**

Quick Reference row after `LOG_LEVEL`:

```markdown
| `ACCOUNT_LABEL`              | String  | `unset`         | Name shown in logs and Discord messages         |
```

Section:

````markdown
### `ACCOUNT_LABEL`

**Purpose:** Tell several ClaudePulse containers apart, one per account.

**Type:** String, 1-32 letters, digits, spaces, dots, underscores or hyphens
**Default:** Unset (no label)

When set, log lines read `[INFO] [work] [PULSE] …`, error alerts are titled
`🚨 claudepulse (work) Error`, and window notifications `work · Window open`.

```bash
ACCOUNT_LABEL=work
```
````

- [ ] **Step 4: Check links and tests**

Run: `npx --yes markdown-link-check -q README.md && npm test`
Expected: no dead links, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md ENVIRONMENT.md
git commit -m "docs: explain running one container per account with ACCOUNT_LABEL"
```
