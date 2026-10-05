import { test } from "node:test";
import assert from "node:assert/strict";

import { ClaudeCliExecutor } from "../src/features/claude/executor/ClaudeCliExecutor.js";

test("requests the cheap model", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  const i = args.indexOf("--model");
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], "haiku");
});

test("requests streamed output, which carries the rate-limit event", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  const i = args.indexOf("--output-format");
  assert.equal(args[i + 1], "stream-json");
});

test("passes --verbose, without which the CLI rejects stream-json in print mode", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  assert.ok(args.includes("--verbose"));
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

test("runs with no tools, so a pulse cannot start a multi-step session", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  const i = args.indexOf("--tools");
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], "");
});

test("replaces the system prompt with a one-line instruction to answer one word", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  const i = args.indexOf("--system-prompt");
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], "Reply with the single word ok.");
  assert.ok(!args.includes("--append-system-prompt"));
});

test("--tools takes one value, the empty list, before the next flag", () => {
  // The option accepts several values, so anything after it that is not a flag
  // would be read as a tool name
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  const start = args.indexOf("--tools") + 1;
  const end = args.findIndex((arg, i) => i >= start && arg.startsWith("--"));
  assert.deepEqual(args.slice(start, end), [""]);
});

test("passes the prompt text as the -p value", () => {
  const args = ClaudeCliExecutor.buildArgs("pulse check");
  const i = args.indexOf("-p");
  assert.equal(args[i + 1], "pulse check");
});
