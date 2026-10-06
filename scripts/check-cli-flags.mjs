#!/usr/bin/env node
/**
 * Check that a Claude CLI still lists every flag a pulse passes to it.
 *
 * A pulse is lean only because of its flags (--tools "", --system-prompt,
 * --strict-mcp-config and the rest). A newer CLI that renamed or dropped one
 * would turn pulses expensive or make them fail, so this runs against the
 * version pinned in docker/claude-cli before that pin changes.
 *
 * It reads the CLI's `--help`, which proves a flag still exists, not that it
 * still behaves the same.
 *
 * Usage: node scripts/check-cli-flags.mjs <path to the claude executable>
 * Exits 0 when every flag is listed, 1 when one is missing or the CLI cannot
 * run, 2 when no path is given.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { ClaudeCliExecutor } from "../src/features/claude/executor/ClaudeCliExecutor.js";

/**
 * The flags in a pulse's arguments, without their values.
 * @param {string[]} args - Arguments from ClaudeCliExecutor.buildArgs()
 * @returns {string[]} -p and every long option, in order
 */
export function flagsOf(args) {
  return args.filter((arg) => arg === "-p" || (arg.startsWith("--") && arg.length > 2));
}

/**
 * The options a help text declares. An option is declared in the part of a
 * line that comes before the description column, so a flag that is only
 * mentioned in a description, or is the start of a longer flag, is not.
 * @param {string} helpText - Output of `claude --help`
 * @returns {Set<string>} Short and long option names
 */
function declaredFlags(helpText) {
  const declared = new Set();
  for (const line of helpText.split("\n")) {
    const declaration = line.match(/^\s+(-\S.*?)(?:\s{2,}|$)/);
    if (!declaration) continue;
    for (const token of declaration[1].split(/[\s,]+/)) {
      if (token.startsWith("-")) declared.add(token.split("=")[0]);
    }
  }
  return declared;
}

/**
 * The flags a help text does not declare.
 * @param {string[]} flags - Flags a pulse passes
 * @param {string} helpText - Output of `claude --help`
 * @returns {string[]} Missing flags, in the order given
 */
export function missingFlags(flags, helpText) {
  const declared = declaredFlags(helpText);
  return flags.filter((flag) => !declared.has(flag));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const claude = process.argv[2];
  if (!claude) {
    process.stderr.write("usage: node scripts/check-cli-flags.mjs <path to the claude executable>\n");
    process.exit(2);
  }

  let help;
  try {
    help = execFileSync(claude, ["--help"], { encoding: "utf8" });
  } catch (error) {
    process.stderr.write(`cannot run ${claude} --help: ${error.message}\n`);
    process.exit(1);
  }

  const flags = flagsOf(ClaudeCliExecutor.buildArgs("pulse check"));
  const missing = missingFlags(flags, help);
  if (missing.length > 0) {
    process.stdout.write(`the CLI no longer lists: ${missing.join(", ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`ok: the CLI lists all ${flags.length} flags a pulse passes\n`);
}
