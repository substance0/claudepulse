import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * The shell script of a step's `run: |` block in docker-build.yml, read
 * from the file so the tests exercise exactly what CI runs.
 */
function stepScript(stepName) {
  const text = fs.readFileSync(".github/workflows/docker-build.yml", "utf8");
  const step = text.indexOf(`- name: ${stepName}\n`);
  assert.ok(step > -1, `step ${stepName} not found`);
  const run = text.indexOf("run: |\n", step);
  const body = text.slice(run + "run: |\n".length);
  const end = body.search(/\n\n {6}(- name:|#)/);
  return (end === -1 ? body : body.slice(0, end))
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

/** Run the Validate inputs step with the given environment. */
function validate(env) {
  const result = spawnSync("bash", ["-e", "-c", stepScript("Validate inputs")], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
  return { ok: result.status === 0, stderr: result.stderr };
}

test("accepts a release built from its own tag", () => {
  assert.ok(validate({ CHANNEL: "release", VERSION: "2.0.0", REF: "v2.0.0" }).ok);
});

test("rejects a release built from another tag", () => {
  const { ok, stderr } = validate({
    CHANNEL: "release",
    VERSION: "2.0.0",
    REF: "v1.9.0",
  });
  assert.equal(ok, false);
  assert.match(stderr, /must be built from tag v2\.0\.0/);
});

test("accepts a snapshot of a branch", () => {
  const env = { CHANNEL: "snapshot", REF_TYPE: "branch", REF_NAME: "fix/foo" };
  assert.ok(validate(env).ok);
});

test("rejects a snapshot of a tag", () => {
  const env = { CHANNEL: "snapshot", REF_TYPE: "tag", REF_NAME: "v2.0.0" };
  assert.match(validate(env).stderr, /Snapshots are built from branches/);
});

test("rejects a branch name too long for a snapshot tag", () => {
  const env = {
    CHANNEL: "snapshot",
    REF_TYPE: "branch",
    REF_NAME: "b".repeat(120),
  };
  assert.match(validate(env).stderr, /119 or fewer/);
});

test("accepts the longest branch name that fits", () => {
  const env = {
    CHANNEL: "snapshot",
    REF_TYPE: "branch",
    REF_NAME: "b".repeat(119),
  };
  assert.ok(validate(env).ok);
});

test("accepts an edge build of main", () => {
  assert.ok(validate({ CHANNEL: "edge", REF_TYPE: "branch", REF_NAME: "main" }).ok);
});

test("rejects an unknown channel", () => {
  assert.equal(validate({ CHANNEL: "nightly" }).ok, false);
});

/** Run only the version guard of the Compute version step on `v`. */
function versionGuardAccepts(v) {
  const script = stepScript("Compute version");
  const guard = script.slice(
    script.indexOf("if ! printf"),
    script.indexOf("fi", script.indexOf("if ! printf")) + 2,
  );
  const result = spawnSync("bash", ["-e", "-c", `v=${JSON.stringify(v)}\n${guard}`], {
    encoding: "utf8",
  });
  return result.status === 0;
}

test("publishes a well-formed version", () => {
  for (const v of ["2.0.0", "2.0.1-dev.10", "2.0.1-snapshot.3"]) {
    assert.ok(versionGuardAccepts(v), v);
  }
});

test("refuses an empty or garbled version", () => {
  for (const v of ["", "Error: boom", "2.0", "v2.0.0"]) {
    assert.equal(versionGuardAccepts(v), false, JSON.stringify(v));
  }
});
