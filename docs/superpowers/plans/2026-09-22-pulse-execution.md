# Pulse Execution via Claude Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Agent SDK call path and the home-grown OAuth layer with a subprocess that runs `claude -p`, so ClaudePulse schedules Claude Code instead of impersonating a Claude client.

**Architecture:** A single `ClaudeCliExecutor` spawns `claude -p` with a fixed, cost-minimised argument list and parses its JSON result. The scheduler calls that executor directly. Everything that stored, refreshed or rewrote credentials is deleted; the CLI owns authentication entirely.

**Tech Stack:** Node 20 ESM, `node:child_process`, `node:test` (built-in, no test dependency), Claude Code CLI installed in the image.

**Spec:** `docs/superpowers/specs/2026-09-22-pulse-execution-design.md`

## Global Constraints

- Node's built-in test runner only. Do not add a test framework dependency.
- The pulse argument list must never include `--bare`. It does not read `CLAUDE_CODE_OAUTH_TOKEN` and would break authentication silently.
- The pulse must never override the system prompt. A custom `--system-prompt` invalidates the prompt cache and measured 3.8x more expensive ($0.0287 vs $0.0076).
- Pulse model is `haiku`. Pulse environment sets `MAX_THINKING_TOKENS=0`.
- The pulse subprocess runs in a dedicated empty directory, never the application directory.
- No code may write, read, or modify `.credentials.json`.
- `subscriptionType` must not appear anywhere in the codebase after Task 5.
- Existing tests must stay green: `npm test` reports 20 passing before this plan starts.

---

### Task 1: ClaudeCliExecutor builds a cheap, safe argument list

**Files:**
- Create: `src/features/claude/executor/ClaudeCliExecutor.js`
- Test: `test/ClaudeCliExecutor.args.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export class ClaudeCliExecutor` with constructor `({ logger, cwd })` and static `buildArgs(promptText)` returning `string[]`. Task 2 uses the same class; Task 3 calls `pulse()`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { ClaudeCliExecutor } from "../src/features/claude/executor/ClaudeCliExecutor.js";

test("requests the cheap model", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  const i = args.indexOf("--model");
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], "haiku");
});

test("requests machine-readable output", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  const i = args.indexOf("--output-format");
  assert.equal(args[i + 1], "json");
});

test("excludes MCP servers, user settings and session files", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--no-session-persistence"));
  const i = args.indexOf("--settings");
  assert.equal(args[i + 1], "{}");
});

test("never passes --bare, which would stop the CLI reading the OAuth token", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  assert.ok(!args.includes("--bare"));
});

test("never overrides the system prompt, which would void the prompt cache", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  assert.ok(!args.includes("--system-prompt"));
  assert.ok(!args.includes("--append-system-prompt"));
});

test("passes the prompt text as the -p value", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  const i = args.indexOf("-p");
  assert.equal(args[i + 1], "pulse check");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `ClaudeCliExecutor` is not exported from a module that does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
import { spawn } from "node:child_process";

/** Model used for pulses. A pulse needs no capability, only a session. */
const PULSE_MODEL = "haiku";

/**
 * Runs Claude Code as a subprocess to open a session window.
 *
 * The argument list is deliberately fixed. Two omissions are load-bearing:
 * `--bare` stops the CLI reading CLAUDE_CODE_OAUTH_TOKEN, and overriding the
 * system prompt voids the prompt cache and costs several times more.
 */
export class ClaudeCliExecutor {
  /**
   * @param {Object} options
   * @param {Object} options.logger - Logger instance
   * @param {string} options.cwd - Empty directory the subprocess runs in
   */
  constructor({ logger, cwd }) {
    if (!logger) {
      throw new Error("ClaudeCliExecutor requires logger dependency");
    }
    if (!cwd) {
      throw new Error("ClaudeCliExecutor requires cwd dependency");
    }
    this.logger = logger;
    this.cwd = cwd;
  }

  /**
   * Build the fixed argument list for a pulse.
   * @param {string} promptText
   * @returns {string[]}
   */
  static buildArgs(promptText) {
    return [
      "-p",
      promptText,
      "--model",
      PULSE_MODEL,
      "--strict-mcp-config",
      "--settings",
      "{}",
      "--no-session-persistence",
      "--output-format",
      "json",
    ];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 26 tests passing (20 existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add src/features/claude/executor/ClaudeCliExecutor.js test/ClaudeCliExecutor.args.test.js
git commit -m "feat: add ClaudeCliExecutor argument builder for cheap pulses"
```

---

### Task 2: Parse the CLI result and classify auth failures

**Files:**
- Modify: `src/features/claude/executor/ClaudeCliExecutor.js`
- Test: `test/ClaudeCliExecutor.parse.test.js`

**Interfaces:**
- Consumes: `ClaudeCliExecutor` from Task 1.
- Produces: static `parseResult({ stdout, stderr, exitCode })` returning `{ success: boolean, message?: { total_cost_usd: number, duration_ms: number, session_id: string }, error?: string, authFailure: boolean }`. Task 3 consumes this shape.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { ClaudeCliExecutor } from "../src/features/claude/executor/ClaudeCliExecutor.js";

const SUCCESS_JSON = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "ok",
  session_id: "abc-123",
  duration_ms: 2735,
  total_cost_usd: 0.007584,
});

const AUTH_ERROR_JSON = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: true,
  result:
    'API Error: 401 {"type":"error","error":{"type":"authentication_error",' +
    '"message":"OAuth access token has expired. Re-authenticate to continue."}}',
  session_id: "def-456",
  duration_ms: 1200,
  total_cost_usd: 0,
});

test("reports success and carries cost, duration and session id", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: SUCCESS_JSON,
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.success, true);
  assert.equal(r.authFailure, false);
  assert.equal(r.message.total_cost_usd, 0.007584);
  assert.equal(r.message.duration_ms, 2735);
  assert.equal(r.message.session_id, "abc-123");
});

test("flags an expired token as an auth failure", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: AUTH_ERROR_JSON,
    stderr: "",
    exitCode: 1,
  });

  assert.equal(r.success, false);
  assert.equal(r.authFailure, true);
});

test("treats a non-zero exit with unparseable output as a plain failure", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: "",
    stderr: "claude: command not found",
    exitCode: 127,
  });

  assert.equal(r.success, false);
  assert.equal(r.authFailure, false);
  assert.match(r.error, /command not found/);
});

test("does not mistake a successful pulse for an auth failure", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: SUCCESS_JSON,
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.authFailure, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `ClaudeCliExecutor.parseResult is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `ClaudeCliExecutor.js`, above the class:

```js
/**
 * Authentication failures that retrying cannot resolve. These need a human to
 * re-authenticate, so further attempts only waste a cycle.
 * @param {string} text
 * @returns {boolean}
 */
function isAuthFailure(text) {
  if (!text) {
    return false;
  }

  // Responses that name an authentication problem in their message.
  const namesAuthProblem =
    /authentication_error|invalid_grant|OAuth access token has expired|Please run \/login|only authorized for use with Claude Code/i.test(
      text,
    );

  // A 401 or 403 is an authorization decision on its own. Some carry no
  // message text to match, so the status has to be enough.
  const rejectedByStatus = /API Error:\s*40[13]\b/i.test(text);

  return namesAuthProblem || rejectedByStatus;
}
```

Add as a static method on the class:

```js
  /**
   * Convert raw subprocess output into a pulse result.
   * @param {Object} raw
   * @param {string} raw.stdout
   * @param {string} raw.stderr
   * @param {number} raw.exitCode
   * @returns {Object}
   */
  static parseResult({ stdout, stderr, exitCode }) {
    let parsed = null;

    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = null;
    }

    if (parsed && !parsed.is_error && exitCode === 0) {
      return {
        success: true,
        authFailure: false,
        message: {
          total_cost_usd: parsed.total_cost_usd,
          duration_ms: parsed.duration_ms,
          session_id: parsed.session_id,
        },
      };
    }

    const detail = parsed?.result || stderr || "Claude CLI failed";

    return {
      success: false,
      authFailure: isAuthFailure(detail),
      error: detail,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 30 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/features/claude/executor/ClaudeCliExecutor.js test/ClaudeCliExecutor.parse.test.js
git commit -m "feat: parse Claude CLI pulse results and classify auth failures"
```

---

### Task 3: Run the subprocess

**Files:**
- Modify: `src/features/claude/executor/ClaudeCliExecutor.js`
- Test: `test/ClaudeCliExecutor.run.test.js`

**Interfaces:**
- Consumes: `buildArgs` and `parseResult` from Tasks 1-2.
- Produces: `async pulse(promptText)` returning the `parseResult` shape. Task 4 calls this from the scheduler.

- [ ] **Step 1: Write the failing test**

Uses a stub binary so the test needs no network and no real CLI.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ClaudeCliExecutor } from "../src/features/claude/executor/ClaudeCliExecutor.js";

const NOOP_LOGGER = { info() {}, warn() {}, debug() {}, error() {} };

/** Write an executable stub that prints the given stdout and exits with code. */
async function writeStub(dir, stdout, exitCode) {
  const file = path.join(dir, "fake-claude");
  await fs.writeFile(
    file,
    `#!/bin/sh\ncat <<'EOF'\n${stdout}\nEOF\nexit ${exitCode}\n`,
  );
  await fs.chmod(file, 0o755);
  return file;
}

test("returns a successful result from the CLI's JSON output", async () => {
  // Arrange
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-exec-"));
  const stub = await writeStub(
    dir,
    JSON.stringify({
      is_error: false,
      result: "ok",
      session_id: "s-1",
      duration_ms: 10,
      total_cost_usd: 0.0076,
    }),
    0,
  );
  const executor = new ClaudeCliExecutor({
    logger: NOOP_LOGGER,
    cwd: dir,
    binary: stub,
  });

  // Act
  const result = await executor.pulse("pulse check");

  // Assert
  assert.equal(result.success, true);
  assert.equal(result.message.session_id, "s-1");
});

test("surfaces a non-zero exit as a failure", async () => {
  // Arrange
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-exec-"));
  const stub = await writeStub(dir, "", 1);
  const executor = new ClaudeCliExecutor({
    logger: NOOP_LOGGER,
    cwd: dir,
    binary: stub,
  });

  // Act
  const result = await executor.pulse("pulse check");

  // Assert
  assert.equal(result.success, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `executor.pulse is not a function`.

- [ ] **Step 3: Write minimal implementation**

Extend the constructor to accept `binary` (defaulting to `"claude"`), and add:

```js
  /**
   * Run one pulse.
   * @param {string} promptText
   * @returns {Promise<Object>} parseResult shape
   */
  async pulse(promptText) {
    const args = ClaudeCliExecutor.buildArgs(promptText);

    return new Promise((resolve) => {
      const child = spawn(this.binary, args, {
        cwd: this.cwd,
        env: { ...process.env, MAX_THINKING_TOKENS: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("error", (err) => {
        resolve(
          ClaudeCliExecutor.parseResult({
            stdout: "",
            stderr: err.message,
            exitCode: 127,
          }),
        );
      });

      child.on("close", (exitCode) => {
        resolve(ClaudeCliExecutor.parseResult({ stdout, stderr, exitCode }));
      });
    });
  }
```

Constructor addition:

```js
    this.binary = options.binary || "claude";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 32 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/features/claude/executor/ClaudeCliExecutor.js test/ClaudeCliExecutor.run.test.js
git commit -m "feat: run pulses as a Claude Code subprocess"
```

---

### Task 4: Point the scheduler at the executor

**Files:**
- Modify: `src/features/scheduling/automation/scheduler.js` (the `_sendPulse` method)
- Modify: `src/index.js` (wiring)
- Test: `test/scheduler.pulse.test.js`

**Interfaces:**
- Consumes: `ClaudeCliExecutor.pulse()` from Task 3.
- Produces: `PulseScheduler` constructed with `{ executor, sessionTracker, logger, config }` instead of `{ client, ... }`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const NOOP_LOGGER = {
  info() {},
  warn() {},
  debug() {},
  error() {},
  startTimer: () => ({ end() {} }),
  endTimer: () => ({ ms: 1 }),
  child() {
    return NOOP_LOGGER;
  },
};

test("sends the pulse through the executor", async () => {
  // Arrange
  const calls = [];
  const scheduler = new PulseScheduler({
    executor: {
      pulse: async (text) => {
        calls.push(text);
        return {
          success: true,
          authFailure: false,
          message: { total_cost_usd: 0.0076, duration_ms: 10, session_id: "s" },
        };
      },
    },
    sessionTracker: { registerSessionLimitSignal() {} },
    logger: NOOP_LOGGER,
    config: { PROMPT_TEXT: "pulse check", MAX_RETRIES: 3 },
  });

  // Act
  const result = await scheduler._sendPulse();

  // Assert
  assert.deepEqual(calls, ["pulse check"]);
  assert.equal(result.success, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `PulseScheduler requires client dependency`.

- [ ] **Step 3: Write minimal implementation**

In `scheduler.js`, replace the `client` dependency check and assignment:

```js
    if (!options.executor) {
      throw new Error("PulseScheduler requires executor dependency");
    }
```
```js
    this.executor = options.executor;
```

Replace the live branch of `_sendPulse` (keep the existing `dryRun` branch untouched):

```js
    const result = await this.executor.pulse(this.config.promptText);
    const duration = this.logger.endTimer(timer);

    if (result.success) {
      this.logger.info("pulse", "Pulse successful", {
        cost: result.message?.total_cost_usd,
        duration: result.message?.duration_ms,
        sessionId: result.message?.session_id,
        timerDurationMs: duration?.ms,
      });
      return { success: true, message: result.message };
    }

    return { success: false, error: result.error };
```

In `src/index.js`, replace the SDK import and wiring:

```js
import { ClaudeCliExecutor } from "./features/claude/executor/ClaudeCliExecutor.js";
```
```js
  const pulseCwd = path.join(os.tmpdir(), "claudepulse-pulse");
  await fs.mkdir(pulseCwd, { recursive: true });

  const executor = new ClaudeCliExecutor({ logger, cwd: pulseCwd });
```

Pass `executor` where `client` was passed to `PulseScheduler`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 33 tests passing. Pre-existing scheduler tests still pass because they construct the scheduler themselves; update their `client:` key to `executor:` if any fail.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/automation/scheduler.js src/index.js test/scheduler.pulse.test.js
git commit -m "feat: schedule pulses through the Claude CLI executor"
```

---

### Task 5: Delete the credential layer

**Files:**
- Delete: `src/features/auth/oauth/OAuthManager.js`
- Delete: `src/features/auth/CredentialStore.js`
- Delete: `src/features/auth/OAuthStateStore.js`
- Delete: `src/core/config/auth-config.js`
- Delete: `src/features/claude/executor/SdkExecutor.js`
- Delete: `src/features/claude/client/ClaudeClient.js`
- Delete: `src/features/claude/client/ClaudeSdkAdapter.js`
- Delete: `src/features/claude/client/ApiClient.js` (constructed with `sdkAdapter`; dead once the SDK chain goes)
- Delete: `src/scripts/oauth-verify.js`, `src/scripts/oauth-status.js`
- Delete: `test/ClaudeClient.auth.test.js`
- Modify: `src/index.js`, `package.json`, `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`
- Test: `test/no-credential-code.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a codebase with no credential handling.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

test("no source file rewrites subscriptionType", async () => {
  const files = await walk("src");
  const offenders = [];

  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    if (text.includes("subscriptionType")) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});

test("no source file reads or writes the credentials file", async () => {
  const files = await walk("src");
  const offenders = [];

  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    if (text.includes(".credentials.json")) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});

test("the Agent SDK is no longer a dependency", async () => {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.equal(pkg.dependencies?.["@anthropic-ai/claude-agent-sdk"], undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — offenders lists `OAuthManager.js`, `CredentialStore.js`, `auth-config.js`; the SDK assertion fails.

- [ ] **Step 3: Write minimal implementation**

```bash
git rm src/features/auth/oauth/OAuthManager.js \
       src/features/auth/CredentialStore.js \
       src/features/auth/OAuthStateStore.js \
       src/core/config/auth-config.js \
       src/features/claude/executor/SdkExecutor.js \
       src/features/claude/client/ClaudeClient.js \
       src/features/claude/client/ClaudeSdkAdapter.js \
       src/features/claude/client/ApiClient.js \
       src/scripts/oauth-verify.js \
       src/scripts/oauth-status.js \
       test/ClaudeClient.auth.test.js

npm uninstall @anthropic-ai/claude-agent-sdk
```

Remove from `package.json` scripts: `oauth-verify`, `oauth-status`, `docker:oauth-verify`.

Remove from `Dockerfile` the line `chmod +x src/scripts/oauth-verify.js` and drop "OAuth authentication" from the header comment.

Remove the `claudepulse-data` volume and its `volumes:` block from `docker-compose.yml` and `docker-compose.dev.yml`. Nothing writes it now.

Remove the now-dead imports and instantiations of `AuthConfig`, `CredentialStore`, `OAuthStateStore`, `OAuthManager`, `ApiClient` and `ClaudeClient` from `src/index.js`, along with the OAuth wait loop (`watchCredentialsAndRetry`) and its call site.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. Then `node --check src/index.js` and `find src test -name '*.js' -exec node --check {} \;` report no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete OAuth credential layer and Agent SDK dependency"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`, `ENVIRONMENT.md`
- Delete: `oauth linux investigation.txt`

**Interfaces:**
- Consumes: nothing.
- Produces: documentation matching the implementation.

- [ ] **Step 1: Update the authentication section**

In `ENVIRONMENT.md`, replace the `oauth-verify` flow under "Authentication Configuration" with:

```markdown
ClaudePulse runs Claude Code as a subprocess and does not manage credentials
itself. Authenticate the CLI with a long-lived token:

    claude setup-token

Set the result as `CLAUDE_CODE_OAUTH_TOKEN`, supplied from a secrets file so it
stays out of `docker inspect` output and stack listings. No credentials file and
no volume mount are involved.
```

Remove the `CLAUDE_CODE_OAUTH_TOKEN` entry's reference to short-circuiting an
internal auth check; it now simply authenticates the CLI.

- [ ] **Step 2: Remove the superseded investigation notes**

`oauth linux investigation.txt` documents a credential flow that no longer
exists and contains OAuth tokens in plaintext. The user has confirmed those
tokens are revoked. Removing the file from the working tree does not remove it
from git history; that is tracked separately.

```bash
git rm "oauth linux investigation.txt"
```

- [ ] **Step 3: Update README**

Replace the two `docker exec -it claudepulse npm run oauth-verify <code>` blocks
with the `claude setup-token` flow above.

- [ ] **Step 4: Verify**

Run: `npm test` and `grep -rn "oauth-verify" README.md ENVIRONMENT.md package.json`
Expected: tests pass, grep returns nothing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: document Claude CLI authentication and drop OAuth flow"
```

---

## Self-Review

**Spec coverage:** Credential layer removed (Task 5). `forceSubscriptionTypePro` deleted and guarded by test (Task 5). SDK dependency dropped (Task 5). Cheap pulse configuration implemented and guarded (Task 1). `--bare` exclusion tested (Task 1). System-prompt override exclusion tested (Task 1). Empty cwd (Tasks 3-4). `MAX_THINKING_TOKENS=0` (Task 3). Auth-failure classification (Task 2). Failure handling via exit code (Tasks 2-3). Volume mount removed (Task 5). Documentation (Task 6).

The four retained fixes are already implemented on this branch and are untouched by these tasks.

**Placeholder scan:** No TBD, TODO, or "handle errors appropriately" steps. Every code step contains runnable code.

**Type consistency:** `parseResult` returns `{ success, authFailure, message?, error? }` in Task 2; Task 3 resolves that shape; Task 4 consumes `result.success`, `result.message`, `result.error`. `buildArgs` returns `string[]` throughout. Constructor is `{ logger, cwd, binary? }` in Tasks 1 and 3.

**Known gap:** the scheduler's existing `isUnrecoverableAuthError` duplicates `isAuthFailure` in the executor. After Task 4, the scheduler can read `result.authFailure` directly. Fold that into Task 4's implementation step if both are present at review.
