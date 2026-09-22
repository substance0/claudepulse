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
