import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ClaudeCliExecutor } from "../src/features/claude/executor/ClaudeCliExecutor.js";
import { flagsOf, missingFlags } from "../scripts/check-cli-flags.mjs";

const SCRIPT = "scripts/check-cli-flags.mjs";

// A help text in the shape the CLI prints it: short and long forms, a value
// placeholder after some flags, and neighbours that start with the same letters.
const HELP = `
Options:
  -p, --print                       Print response and exit
  --model <model>                   Model for the session
  --tools <tools...>                Specify the list of available tools
  --allowedTools, --allowed-tools   Tools that run without asking
  --system-prompt <prompt>          System prompt to use
  --strict-mcp-config               Only use MCP servers from --mcp-config
  --settings <file-or-json>         Path to a settings JSON file or a JSON string
  --setting-sources <sources>       Comma-separated list of setting sources
  --no-session-persistence          Disable session persistence
  --output-format <format>          Output format
  --verbose                         Override verbose mode setting
`;

test("flagsOf returns the flags a pulse passes, never their values", () => {
  const flags = flagsOf(ClaudeCliExecutor.buildArgs("pulse check"));
  assert.deepEqual(flags, [
    "-p",
    "--model",
    "--tools",
    "--system-prompt",
    "--strict-mcp-config",
    "--settings",
    "--no-session-persistence",
    "--output-format",
    "--verbose",
  ]);
});

test("flagsOf ignores a value that looks like a word, an empty string or JSON", () => {
  assert.deepEqual(flagsOf(["-p", "hello", "--tools", "", "--settings", "{}"]), [
    "-p",
    "--tools",
    "--settings",
  ]);
});

test("every flag of a pulse is found in a help text that lists them", () => {
  const flags = flagsOf(ClaudeCliExecutor.buildArgs("pulse check"));
  assert.deepEqual(missingFlags(flags, HELP), []);
});

test("a flag the help no longer lists is reported", () => {
  const help = HELP.replace("--no-session-persistence", "--keep-sessions");
  assert.deepEqual(missingFlags(["--no-session-persistence", "--verbose"], help), [
    "--no-session-persistence",
  ]);
});

test("a flag that is only the start of another flag does not count", () => {
  // --tools must not be satisfied by --tools-extra, nor --settings by --setting-sources
  const help = "  --tools-extra <x>   something\n  --setting-sources <s>   other\n";
  assert.deepEqual(missingFlags(["--tools", "--settings"], help), ["--tools", "--settings"]);
});

test("a flag mentioned only inside a description does not count", () => {
  // --strict-mcp-config appears in the description of --mcp-config here, not as an option
  const help = "  --mcp-config <files>   Combine with --strict-mcp-config to ignore others\n";
  assert.deepEqual(missingFlags(["--strict-mcp-config"], help), ["--strict-mcp-config"]);
});

test("a flag in a comma-separated alias list counts", () => {
  assert.deepEqual(missingFlags(["--print", "-p"], HELP), []);
});

// The script runs the CLI it is given, so a stub that prints a chosen help
// text stands in for the real one and no network is needed.
function runWithHelp(helpText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-flags-"));
  try {
    const stub = path.join(dir, "claude");
    fs.writeFileSync(stub, `#!/bin/sh\ncat <<'EOF'\n${helpText}\nEOF\n`, { mode: 0o755 });
    return spawnSync("node", [SCRIPT, stub], { encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the script passes when the CLI lists every flag", () => {
  const result = runWithHelp(HELP);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("the script fails and names the flag the CLI dropped", () => {
  const result = runWithHelp(HELP.replace("--no-session-persistence", "--keep-sessions"));
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /--no-session-persistence/);
});

test("the script fails clearly when the CLI cannot be run", () => {
  const result = spawnSync("node", [SCRIPT, "/nonexistent/claude"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /cannot run/i);
});

test("the script asks for the path of the CLI", () => {
  const result = spawnSync("node", [SCRIPT], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /usage/i);
});

test("a wrapped description line that starts with a flag does not count", () => {
  // The option column holds declarations; a description that wraps onto a
  // deeply indented line may begin with another flag's name.
  const help = [
    "  --output-format <format>              Output format (only works with --print):",
    '                                        "text" or "stream-json" (needs',
    "                                        --strict-mcp-config to ignore others)",
    "  --tools <tools...>                    Specify the list of available tools",
    "                                        --settings, --agents, --plugin-dir.",
    "  --verbose                             Override verbose mode setting",
  ].join("\n");
  assert.deepEqual(missingFlags(["--strict-mcp-config", "--settings"], help), [
    "--strict-mcp-config",
    "--settings",
  ]);
  assert.deepEqual(missingFlags(["--output-format", "--tools", "--verbose"], help), []);
});

test("options all sit in one column, wherever that column is", () => {
  const help = "    --model <model>   Model\n    --verbose   Verbose\n        --tools   wrapped text\n";
  assert.deepEqual(missingFlags(["--model", "--verbose", "--tools"], help), ["--tools"]);
});
