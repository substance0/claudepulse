#!/usr/bin/env node
/**
 * Derive a prerelease version for a non-release build.
 *
 * The version is the next patch after the last release tag, with a
 * prerelease label and the number of commits since that tag, for example
 * 1.0.1-dev.20. It sorts below the next real release, so it never shadows
 * one. It carries no "+build" suffix: Docker tags cannot contain "+"; the
 * image's sha- tag identifies the commit instead.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CHANNELS = new Set(["dev", "snapshot"]);

/** Finds the last stable release tag; prerelease tags (v*-*) are skipped. */
export const DESCRIBE_ARGS = [
  "describe",
  "--tags",
  "--long",
  "--match",
  "v[0-9]*",
  "--exclude",
  "v*-*",
];

/** Output of `git describe --tags --long`, e.g. v1.0.0-20-g761d7ac */
const DESCRIBE = /^v?(\d+)\.(\d+)\.(\d+)-(\d+)-g[0-9a-f]+$/;

/**
 * @param {string|null} describe - `git describe` output, or null when no
 *   release tag is reachable
 * @param {{channel?: string, commitCount?: number}} [options]
 * @returns {string}
 * @throws {Error} When describe output is present but not a stable release
 */
export function devVersion(describe, { channel = "dev", commitCount = 0 } = {}) {
  if (!CHANNELS.has(channel)) {
    throw new Error(`Unknown channel: ${channel}`);
  }

  if (describe === null) {
    return `0.0.1-${channel}.${commitCount}`;
  }

  const match = DESCRIBE.exec(describe.trim());
  if (!match) {
    throw new Error(`Unrecognised git describe output: ${describe}`);
  }

  const [, major, minor, patch, since] = match;
  return `${major}.${minor}.${Number(patch) + 1}-${channel}.${since}`;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const channel = process.argv[2] ?? "dev";
  let describe = null;
  try {
    describe = git(DESCRIBE_ARGS);
  } catch {
    describe = null;
  }
  const commitCount = Number(git(["rev-list", "--count", "HEAD"]));
  process.stdout.write(`${devVersion(describe, { channel, commitCount })}\n`);
}
