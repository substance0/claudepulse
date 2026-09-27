# Persisted Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `STATE_DIR` set, a restarted container resumes the planned pulse instead of pulsing at startup.

**Architecture:** A `stateStore` service reads and writes `<STATE_DIR>/state.json` (write to temp, then rename). The scheduler saves after every scheduling decision and, at startup, restores a future `nextPulseAt` with its rate-limit state in place of the startup pulse. Work hours still constrain a restored time.

**Tech Stack:** Node.js 22 ESM, `node:fs/promises`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-27-scheduling-and-alerts-design.md` §6

## Global Constraints

- Node ≥ 22, no runtime npm dependencies; tests use `node:test` and `node:assert/strict` only.
- Branch `feat/persisted-schedule` from `main`; one PR; conventional commits.
- State file format: `{ "version": 1, "nextPulseAt": ISO, "rateLimit": {…}|null, "savedAt": ISO }`.
- Without `STATE_DIR`, behaviour is exactly as before this feature.
- A state that cannot be read or saved is logged at WARN and never stops pulsing.
- The image creates `/data` owned by `claudepulse`, so a named volume there is writable.
- Comments and docs describe what the code does now.

## Review Focus

- A state file from a container killed mid-write (truncated JSON) → ignored with a warning; the startup pulse runs.
- A saved `nextPulseAt` in the past (container down for a day) → ignored; startup behaves as without state.
- A restored pulse time that falls outside work hours → moved to the working day, like any planned time.
- A read-only or full volume → a save warning per scheduling, pulsing continues.
- Dates inside the restored rate-limit state (`resetsAt`, `weekly.resetsAt`) → revived as `Date`, not left as strings.

---

### Task 1: State store

**Files:**
- Create: `src/core/services/stateStore.js`
- Test: create `test/stateStore.test.js`

**Interfaces:**
- Produces: `createStateStore(dir: string): {load(): Promise<{nextPulseAt: Date, rateLimit: Object|null} | null>, save({nextPulseAt: Date, rateLimit: Object|null}): Promise<void>}`. `load` returns null when no file exists and throws on an unreadable one.

- [ ] **Step 1: Write the failing tests** (`test/stateStore.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStateStore } from "../src/core/services/stateStore.js";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claudepulse-state-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const RATE_LIMIT = {
  status: "allowed",
  resetsAt: new Date("2026-09-30T09:00:00.000Z"),
  fiveHourResetsAt: new Date("2026-09-30T09:00:00.000Z"),
  limitType: "five_hour",
  weekly: { utilization: 0.2, resetsAt: new Date("2026-10-02T07:00:00.000Z") },
};

test("restores what it saved, with dates as dates", async (t) => {
  const store = createStateStore(await tempDir(t));
  const nextPulseAt = new Date("2026-09-30T09:00:10.000Z");

  await store.save({ nextPulseAt, rateLimit: RATE_LIMIT });
  const loaded = await store.load();

  assert.deepEqual(loaded, { nextPulseAt, rateLimit: RATE_LIMIT });
});

test("has nothing to restore before the first save", async (t) => {
  const store = createStateStore(await tempDir(t));

  assert.equal(await store.load(), null);
});

test("creates the state directory when missing", async (t) => {
  const dir = path.join(await tempDir(t), "nested");
  const store = createStateStore(dir);

  await store.save({ nextPulseAt: new Date(), rateLimit: null });

  assert.ok((await fs.stat(path.join(dir, "state.json"))).isFile());
});

test("refuses a truncated state file", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(path.join(dir, "state.json"), '{"version":1,"nextPu');

  await assert.rejects(createStateStore(dir).load());
});

test("refuses a state file of another version", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(
    path.join(dir, "state.json"),
    JSON.stringify({ version: 2, nextPulseAt: new Date().toISOString() }),
  );

  await assert.rejects(createStateStore(dir).load(), /version/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/stateStore.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`src/core/services/stateStore.js`)

```js
/**
 * State Store
 * Keeps the next planned pulse and the last rate-limit state in a JSON file,
 * so a restarted container resumes its schedule.
 */

import fs from "node:fs/promises";
import path from "node:path";

const STATE_VERSION = 1;
const STATE_FILE = "state.json";

/** ISO string for a Date, or null. */
function toIso(date) {
  return date instanceof Date ? date.toISOString() : null;
}

/** Date from an ISO string, or null when absent or invalid. */
function fromIso(text) {
  if (typeof text !== "string") return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serialiseRateLimit(rateLimit) {
  if (!rateLimit) return null;
  return {
    status: rateLimit.status,
    resetsAt: toIso(rateLimit.resetsAt),
    fiveHourResetsAt: toIso(rateLimit.fiveHourResetsAt),
    limitType: rateLimit.limitType ?? null,
    weekly: rateLimit.weekly
      ? { utilization: rateLimit.weekly.utilization, resetsAt: toIso(rateLimit.weekly.resetsAt) }
      : null,
  };
}

function reviveRateLimit(data) {
  if (!data) return null;
  return {
    status: data.status,
    resetsAt: fromIso(data.resetsAt),
    fiveHourResetsAt: fromIso(data.fiveHourResetsAt),
    limitType: data.limitType ?? null,
    weekly: data.weekly
      ? { utilization: data.weekly.utilization, resetsAt: fromIso(data.weekly.resetsAt) }
      : null,
  };
}

/**
 * Create a store for the state file in dir.
 * @param {string} dir - Directory holding state.json
 * @returns {{load: Function, save: Function}}
 */
export function createStateStore(dir) {
  const file = path.join(dir, STATE_FILE);

  return {
    /**
     * @returns {Promise<{nextPulseAt: Date, rateLimit: Object|null}|null>}
     *   Null when nothing was saved yet
     * @throws {Error} When the file cannot be read or understood
     */
    async load() {
      let text;
      try {
        text = await fs.readFile(file, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }

      const data = JSON.parse(text);
      if (data?.version !== STATE_VERSION) {
        throw new Error(`Unsupported state version: ${data?.version}`);
      }
      const nextPulseAt = fromIso(data.nextPulseAt);
      if (!nextPulseAt) {
        throw new Error("State has no valid nextPulseAt");
      }
      return { nextPulseAt, rateLimit: reviveRateLimit(data.rateLimit) };
    },

    /**
     * Write the state atomically: a crash mid-write leaves the previous file.
     * @param {{nextPulseAt: Date, rateLimit: Object|null}} state
     */
    async save({ nextPulseAt, rateLimit }) {
      await fs.mkdir(dir, { recursive: true });
      const temp = `${file}.tmp`;
      const body = {
        version: STATE_VERSION,
        nextPulseAt: toIso(nextPulseAt),
        rateLimit: serialiseRateLimit(rateLimit),
        savedAt: new Date().toISOString(),
      };
      await fs.writeFile(temp, JSON.stringify(body, null, 2));
      await fs.rename(temp, file);
    },
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/stateStore.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/services/stateStore.js test/stateStore.test.js
git commit -m "feat: store the next planned pulse in a state file"
```

### Task 2: The scheduler saves and restores its schedule

**Files:**
- Modify: `src/features/scheduling/automation/scheduler.js` (constructor, `start`, `_scheduleNext`, new `_restoreState`, `_saveState`)
- Test: create `test/scheduler.state.test.js`

**Interfaces:**
- Consumes: the `load`/`save` contract of Task 1 (injected as `stateStore`); `workHours.nextAllowed` from the work-hours feature.
- Produces: `new PulseScheduler({ …, stateStore })`; scheduled strategy `"restored"`.

- [ ] **Step 1: Write the failing tests** (`test/scheduler.state.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const HOUR_MS = 60 * 60 * 1000;

function allowedPulse(windowReset) {
  return {
    success: true,
    authFailure: false,
    message: { total_cost_usd: 0, duration_ms: 1, session_id: "s" },
    rateLimit: { status: "allowed", resetsAt: windowReset, fiveHourResetsAt: windowReset },
  };
}

function buildScheduler({ stateStore, workHours }) {
  const record = { attempts: 0, scheduled: [], warnings: [] };
  const logger = {
    info() {},
    warn: (_category, message) => record.warnings.push(message),
    debug() {},
    error() {},
    startTimer: () => ({}),
    endTimer: () => ({ ms: 1 }),
    logScheduler: (event, data) => {
      if (event === "next_pulse_scheduled") record.scheduled.push(data);
    },
    child() {
      return logger;
    },
  };
  const scheduler = new PulseScheduler({
    executor: {
      pulse: async () => {
        record.attempts += 1;
        return allowedPulse(new Date(Date.now() + 3 * HOUR_MS));
      },
    },
    logger,
    config: { PROMPT_TEXT: "pulse check", MAX_RETRIES: 3 },
    stateStore,
    workHours,
  });
  return { scheduler, record };
}

async function startAndStop(scheduler) {
  try {
    await scheduler.start();
  } finally {
    await scheduler.shutdown();
  }
}

function memoryStore(initial) {
  return {
    saved: null,
    load: async () => initial,
    async save(state) {
      this.saved = state;
    },
  };
}

test("saves the next planned pulse", async () => {
  const store = memoryStore(null);
  const { scheduler, record } = buildScheduler({ stateStore: store });

  await startAndStop(scheduler);

  assert.equal(
    store.saved.nextPulseAt.getTime(),
    new Date(record.scheduled.at(-1).nextRunTime).getTime(),
  );
  assert.equal(store.saved.rateLimit.status, "allowed");
});

test("resumes a saved future pulse instead of pulsing at startup", async () => {
  // Arrange
  const nextPulseAt = new Date(Date.now() + 2 * HOUR_MS);
  const rateLimit = { status: "allowed", resetsAt: nextPulseAt, fiveHourResetsAt: nextPulseAt };
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore({ nextPulseAt, rateLimit }),
  });

  // Act
  await startAndStop(scheduler);

  // Assert
  assert.equal(record.attempts, 0);
  assert.equal(record.scheduled.at(-1).strategy, "restored");
  assert.equal(new Date(record.scheduled.at(-1).nextRunTime).getTime(), nextPulseAt.getTime());
  assert.equal(scheduler.rateLimit.status, "allowed");
});

test("ignores a saved pulse that is already past", async () => {
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore({ nextPulseAt: new Date(Date.now() - HOUR_MS), rateLimit: null }),
  });

  await startAndStop(scheduler);

  assert.equal(record.attempts, 1);
});

test("ignores an unreadable state with a warning", async () => {
  const { scheduler, record } = buildScheduler({
    stateStore: {
      load: async () => {
        throw new Error("Unexpected end of JSON input");
      },
      save: async () => {},
    },
  });

  await startAndStop(scheduler);

  assert.equal(record.attempts, 1);
  assert.ok(record.warnings.some((m) => /state/i.test(m)));
});

test("keeps scheduling when the state cannot be saved", async () => {
  const { scheduler, record } = buildScheduler({
    stateStore: {
      load: async () => null,
      save: async () => {
        throw new Error("EROFS: read-only file system");
      },
    },
  });

  await startAndStop(scheduler);

  assert.equal(record.scheduled.length, 1);
  assert.ok(record.warnings.some((m) => /state/i.test(m)));
});

test("a restored pulse outside work hours waits for the working day", async () => {
  const nextMorning = new Date(Date.now() + 10 * HOUR_MS);
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore({ nextPulseAt: new Date(Date.now() + 2 * HOUR_MS), rateLimit: null }),
    workHours: { nextAllowed: () => nextMorning, isActive: () => false },
  });

  await startAndStop(scheduler);

  assert.equal(new Date(record.scheduled.at(-1).nextRunTime).getTime(), nextMorning.getTime());
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/scheduler.state.test.js`
Expected: FAIL — nothing saved; startup pulse sent despite a future saved pulse.

- [ ] **Step 3: Implement** in `scheduler.js`

Constructor JSDoc: `@param {{load: Function, save: Function}} [options.stateStore] - Persists the schedule across restarts`. After `this.workHours = …`:

```js
    this.stateStore = options.stateStore ?? null;
    // A saved pulse time to resume at startup, used once
    this.restoredNextPulseAt = null;
```

New methods:

```js
  /**
   * Resume a saved schedule whose next pulse is still ahead.
   * @returns {Promise<boolean>} Whether a schedule was restored
   */
  async _restoreState() {
    if (!this.stateStore) {
      return false;
    }
    try {
      const saved = await this.stateStore.load();
      if (!saved || saved.nextPulseAt <= new Date()) {
        return false;
      }
      this.rateLimit = saved.rateLimit;
      this.restoredNextPulseAt = saved.nextPulseAt;
      this.logger.info("startup", "Resuming saved schedule", {
        planned: saved.nextPulseAt.toISOString(),
      });
      return true;
    } catch (error) {
      this.logger.warn("startup", "Ignoring unreadable state", { error: error.message });
      return false;
    }
  }

  /**
   * Save the next planned pulse; a failure is logged and never stops pulsing.
   * @param {Date} nextPulseAt
   */
  async _saveState(nextPulseAt) {
    if (!this.stateStore) {
      return;
    }
    try {
      await this.stateStore.save({ nextPulseAt, rateLimit: this.rateLimit });
    } catch (error) {
      this.logger.warn("schedule", "Could not save state", { error: error.message });
    }
  }
```

In `start`, wrap the startup-pulse block:

```js
    const restored = await this._restoreState();

    if (!restored && this.config.immediatePulseAfterAuth) {
      // …the existing work-hours check and _sendInitialPulse() call, unchanged…
    }
```

In `_scheduleNext`, replace the strategy call:

```js
    let planned;
    let strategy;
    if (this.restoredNextPulseAt) {
      planned = this.restoredNextPulseAt;
      strategy = "restored";
      this.restoredNextPulseAt = null;
    } else {
      ({ time: planned, strategy } =
        await this.schedulingManager.computeNextRunTime(context));
    }
```

and after `this.lastScheduledTime = finalTime;` (the work-hours constraint stays before it): `await this._saveState(finalTime);`

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/automation/scheduler.js test/scheduler.state.test.js
git commit -m "feat: resume the planned pulse after a restart"
```

### Task 3: Config, wiring, image directory

**Files:**
- Modify: `src/core/config/index.js` (`STATE_DIR`, must be absolute)
- Modify: `src/index.js` (inject `createStateStore(config.STATE_DIR)`)
- Modify: `Dockerfile` (create `/data` before `USER claudepulse`)
- Test: `test/config.redaction.test.js`, `test/dockerfile.test.js`

**Interfaces:**
- Consumes: `createStateStore` (Task 1), `stateStore` option (Task 2).
- Produces: `config.STATE_DIR: string | undefined`; validation error `STATE_DIR must be an absolute path`.

- [ ] **Step 1: Write the failing tests**

Append to `test/config.redaction.test.js`:

```js
test("rejects a relative state directory", async () => {
  const { loadConfig, validateConfig } = await import("../src/core/config/index.js");
  const config = { ...loadConfig(), STATE_DIR: "data" };

  assert.throws(() => validateConfig(config), /STATE_DIR must be an absolute path/);
});

test("reads the state directory", async () => {
  const { loadConfig } = await import("../src/core/config/index.js");
  process.env.STATE_DIR = "/data";

  try {
    assert.equal(loadConfig().STATE_DIR, "/data");
  } finally {
    delete process.env.STATE_DIR;
  }
});
```

Append to `test/dockerfile.test.js` (its `dockerfile()` helper returns the Dockerfile text):

```js
test("creates a writable /data for the state file before dropping root", () => {
  const text = dockerfile();
  const createData = text.search(/mkdir -p \/data && chown claudepulse:claudepulse \/data/);
  const dropRoot = text.indexOf("USER claudepulse");

  assert.ok(createData > -1, "/data is not created");
  assert.ok(createData < dropRoot, "/data must be created before USER claudepulse");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/config.redaction.test.js test/dockerfile.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Config: `import path from "node:path";`; `DEFAULT_CONFIG.STATE_DIR = undefined`; env `STATE_DIR: process.env.STATE_DIR || undefined`; validation:

```js
  if (config.STATE_DIR !== undefined && !path.isAbsolute(config.STATE_DIR)) {
    errors.push("STATE_DIR must be an absolute path, e.g. /data");
  }
```

`src/index.js`: `import { createStateStore } from "./core/services/stateStore.js";` and pass `stateStore: config.STATE_DIR ? createStateStore(config.STATE_DIR) : undefined,` to `new PulseScheduler`.

`Dockerfile`, in the `RUN chown -R claudepulse:claudepulse /app && \` block before `USER claudepulse`:

```dockerfile
# Holds the state file when STATE_DIR=/data; a named volume mounted here
# inherits this ownership.
RUN mkdir -p /data && chown claudepulse:claudepulse /data
```

- [ ] **Step 4: Run the suite and a local container check**

Run: `npm test`
Expected: all PASS.

Run: `podman build -t claudepulse:state . && podman run --rm -e STATE_DIR=/data -e DRY_RUN=true -e CLAUDE_CODE_OAUTH_TOKEN=placeholder -v cp-state:/data claudepulse:state && podman run --rm -v cp-state:/data --entrypoint sh claudepulse:state -c 'touch /data/probe && echo writable'; podman volume rm cp-state`
Expected: the dry run completes, then `writable`.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/index.js src/index.js Dockerfile test/config.redaction.test.js test/dockerfile.test.js
git commit -m "feat: enable the state file with STATE_DIR"
```

### Task 4: Document the state directory

**Files:**
- Modify: `docker-compose.yml` (commented `STATE_DIR` and volume)
- Modify: `README.md` (Settings table; Features "No Stored Credentials" row wording)
- Modify: `ENVIRONMENT.md` (Quick Reference row; `STATE_DIR` section)

- [ ] **Step 1: docker-compose.yml** — under `environment:` after `LOG_LEVEL`:

```yaml
      # Resume the planned pulse after a restart (optional): uncomment this
      # and the volumes below.
      # - STATE_DIR=/data
```

and at the end of the service plus a top-level volume:

```yaml
    # volumes:
    #   - claudepulse-data:/data

# volumes:
#   claudepulse-data:
```

- [ ] **Step 2: README**

Settings row:

```markdown
| `STATE_DIR`                  | unset         | Absolute directory for a state file, so a restart resumes the planned pulse (use a volume, e.g. `/data`) |
```

Features row "No Stored Credentials" description: `Claude Code authenticates each pulse from CLAUDE_CODE_OAUTH_TOKEN; ClaudePulse keeps no credentials, and state only when STATE_DIR is set`.

- [ ] **Step 3: ENVIRONMENT.md**

````markdown
### `STATE_DIR`

**Purpose:** Resume the planned pulse after a restart instead of pulsing at
startup.

**Type:** Absolute path
**Default:** Unset (no state; every start pulses to learn the window)

ClaudePulse writes `state.json` there after every scheduling decision. At
startup, a saved pulse time still ahead is resumed; a past, missing or
unreadable state is ignored. Mount a volume so the file survives the
container:

```bash
docker run -d --name claudepulse --restart unless-stopped \
  -e STATE_DIR=/data -v claudepulse-data:/data \
  --env-file claudepulse.env ghcr.io/substance0/claudepulse:latest
```
````

- [ ] **Step 4: Verify and commit**

Run: `npx --yes markdown-link-check -q README.md && npm test`
Expected: no dead links; all PASS.

```bash
git add docker-compose.yml README.md ENVIRONMENT.md
git commit -m "docs: explain STATE_DIR and the state volume"
```

### After merge (not code)

- [ ] Production (stack 278): add `STATE_DIR=/data` and a named volume `claudepulse-data:/data` in Portainer when deploying the release that contains this feature.
