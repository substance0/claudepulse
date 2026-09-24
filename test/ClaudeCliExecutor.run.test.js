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

/** Write a stub that records the environment it was given. */
async function writeEnvProbe(dir, varName = "MAX_THINKING_TOKENS") {
  const out = path.join(dir, `env-probe-${varName}.txt`);
  const file = path.join(dir, `probe-claude-${varName}`);
  await fs.writeFile(
    file,
    `#!/bin/sh\nprintf '%s' "$${varName}" > ${out}\necho '{}'\n`,
  );
  await fs.chmod(file, 0o755);
  return { binary: file, out };
}

test("returns a successful result from the CLI's JSON output", async () => {
  // Arrange
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-exec-"));
  const stub = await writeStub(
    dir,
    JSON.stringify({
      type: "result",
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

test("reports a missing binary as a failure rather than throwing", async () => {
  // Arrange
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-exec-"));
  const executor = new ClaudeCliExecutor({
    logger: NOOP_LOGGER,
    cwd: dir,
    binary: path.join(dir, "does-not-exist"),
  });

  // Act
  const result = await executor.pulse("pulse check");

  // Assert
  assert.equal(result.success, false);
  assert.equal(result.authFailure, false);
});

test("disables thinking tokens in the subprocess environment", async () => {
  // Arrange
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-exec-"));
  const { binary, out } = await writeEnvProbe(dir);
  const executor = new ClaudeCliExecutor({
    logger: NOOP_LOGGER,
    cwd: dir,
    binary,
  });

  // Act
  await executor.pulse("pulse check");

  // Assert - thinking was 148 of 169 output tokens by default
  assert.equal(await fs.readFile(out, "utf8"), "0");
});

test("pins the config directory so the pulse loads no host configuration", async () => {
  // Arrange
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-exec-"));
  const configDir = path.join(dir, "config");
  const { binary, out } = await writeEnvProbe(dir, "CLAUDE_CONFIG_DIR");
  const executor = new ClaudeCliExecutor({
    logger: NOOP_LOGGER,
    cwd: dir,
    configDir,
    binary,
  });

  // Act
  await executor.pulse("pulse check");

  // Assert - inheriting the host's config dir measured 2.4x more expensive,
  // because it loads whatever skills, plugins and agents happen to be there
  assert.equal(await fs.readFile(out, "utf8"), configDir);
});
