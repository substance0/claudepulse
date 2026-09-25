import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dockerfile = () => fs.readFileSync("Dockerfile", "utf8");
const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

const CLI_DIR = "docker/claude-cli";
const CLI_PACKAGE = "@anthropic-ai/claude-code";

test("the Claude CLI version is pinned exactly", () => {
  const range = readJson(`${CLI_DIR}/package.json`).dependencies[CLI_PACKAGE];
  assert.match(range, /^\d+\.\d+\.\d+$/, `expected an exact version, got ${range}`);
});

test("the CLI lockfile installs the pinned version", () => {
  const pinned = readJson(`${CLI_DIR}/package.json`).dependencies[CLI_PACKAGE];
  const lock = readJson(`${CLI_DIR}/package-lock.json`);
  assert.equal(lock.packages[`node_modules/${CLI_PACKAGE}`].version, pinned);
});

test("the CLI is installed from its lockfile, never from the registry's latest", () => {
  const text = dockerfile();
  assert.doesNotMatch(text, /npm install -g @anthropic-ai\/claude-code/);
  assert.match(text, /COPY docker\/claude-cli\/package\.json docker\/claude-cli\/package-lock\.json/);
  assert.match(text, /npm ci/);
});

test("the installed CLI stays on the PATH", () => {
  const text = dockerfile();
  assert.match(text, /ENV PATH="\/opt\/claude-cli\/node_modules\/\.bin:\$PATH"/);
  assert.doesNotMatch(text, /rm -rf \/opt\/claude-cli/);
});

test("the base image is the active Node LTS", () => {
  assert.match(dockerfile(), /^FROM node:24-alpine$/m);
});

test("per-build values come after the expensive layers", () => {
  // BUILD_DATE differs on every build; any layer after it misses the cache.
  const text = dockerfile();
  const cliInstall = text.indexOf("npm ci");
  const appSource = text.indexOf("COPY src/");
  const buildDate = text.indexOf("ARG BUILD_DATE");
  assert.ok(cliInstall > -1 && appSource > -1 && buildDate > -1);
  assert.ok(buildDate > appSource && buildDate > cliInstall);
});

test("the healthcheck runs the Claude CLI", () => {
  assert.match(dockerfile(), /HEALTHCHECK[\s\S]*claude --version/);
});
