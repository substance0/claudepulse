import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assessPullRequest } from "../scripts/dependabot-eligibility.mjs";

const SCRIPT = fileURLToPath(
  new URL("../scripts/dependabot-eligibility.mjs", import.meta.url),
);

const PATCH = "version-update:semver-patch";
const MINOR = "version-update:semver-minor";
const MAJOR = "version-update:semver-major";

/** A commit message body in the format Dependabot writes. */
function commitBody(updates) {
  const lines = ["Bumps the group with updates.", "", "---", "updated-dependencies:"];
  for (const { type = "direct:development", update } of updates) {
    lines.push("- dependency-name: some-package");
    lines.push(`  dependency-type: ${type}`);
    lines.push(`  update-type: ${update}`);
  }
  lines.push("...", "");
  return lines.join("\n");
}

const check = (status, conclusion, name = "test") => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
});

/** What a pull request whose checks all finished well reports, as GitHub does. */
const GREEN = [
  check("COMPLETED", "SUCCESS", "test"),
  check("COMPLETED", "NEUTRAL", "CodeQL"),
  check("COMPLETED", "SKIPPED", "links"),
];

/** The shape of `gh pr view --json author,files,commits,statusCheckRollup`. */
function pullRequest({
  author = "app/dependabot",
  files = ["package.json", "package-lock.json"],
  updates = [{ update: MINOR }],
  checks = GREEN,
} = {}) {
  return {
    author: { login: author },
    files: files.map((path) => ({ path })),
    commits: [{ messageHeadline: "chore(deps-dev): bump", messageBody: commitBody(updates) }],
    statusCheckRollup: checks,
  };
}

test("accepts a minor update to the root development tooling", () => {
  const result = assessPullRequest(pullRequest());

  assert.equal(result.eligible, true);
});

test("accepts a patch update to an indirect development dependency", () => {
  const result = assessPullRequest(
    pullRequest({ updates: [{ type: "indirect", update: PATCH }] }),
  );

  assert.equal(result.eligible, true);
});

test("accepts a minor update to workflow actions, which Dependabot labels as production", () => {
  const result = assessPullRequest(
    pullRequest({
      files: [".github/workflows/release.yml"],
      updates: [{ type: "direct:production", update: MINOR }],
    }),
  );

  assert.equal(result.eligible, true);
});

test("accepts both spellings of the Dependabot author", () => {
  for (const author of ["app/dependabot", "dependabot[bot]"]) {
    assert.equal(assessPullRequest(pullRequest({ author })).eligible, true, author);
  }
});

test("refuses a group that contains a major update", () => {
  const result = assessPullRequest(
    pullRequest({ updates: [{ update: MINOR }, { update: MAJOR }] }),
  );

  assert.equal(result.eligible, false);
  assert.match(result.reason, /major/);
});

test("refuses a major update to workflow actions", () => {
  const result = assessPullRequest(
    pullRequest({
      files: [".github/workflows/release.yml"],
      updates: [{ type: "direct:production", update: MAJOR }],
    }),
  );

  assert.equal(result.eligible, false);
});

test("refuses the Claude CLI the image runs, even for a patch", () => {
  const result = assessPullRequest(
    pullRequest({
      files: ["docker/claude-cli/package.json", "docker/claude-cli/package-lock.json"],
      updates: [{ type: "direct:production", update: PATCH }],
    }),
  );

  assert.equal(result.eligible, false);
  assert.match(result.reason, /docker\/claude-cli/);
});

test("refuses a change that also touches the Dockerfile", () => {
  const result = assessPullRequest(
    pullRequest({ files: ["package.json", "Dockerfile"] }),
  );

  assert.equal(result.eligible, false);
});

test("refuses an update that records no update type", () => {
  const pr = pullRequest();
  pr.commits[0].messageBody = "Bumps glob.\n\n---\nupdated-dependencies:\n- dependency-name: glob\n  dependency-type: indirect\n...\n";

  const result = assessPullRequest(pr);

  assert.equal(result.eligible, false);
  assert.match(result.reason, /update type/);
});

test("refuses a pull request that a person opened", () => {
  const result = assessPullRequest(pullRequest({ author: "substance0" }));

  assert.equal(result.eligible, false);
  assert.match(result.reason, /Dependabot/);
});

test("refuses a runtime dependency among the root npm updates", () => {
  const result = assessPullRequest(
    pullRequest({ updates: [{ type: "direct:production", update: MINOR }] }),
  );

  assert.equal(result.eligible, false);
});

test("refuses a pull request with no changed files or no commits", () => {
  assert.equal(assessPullRequest(pullRequest({ files: [] })).eligible, false);
  assert.equal(assessPullRequest({ ...pullRequest(), commits: [] }).eligible, false);
});

test("waits while a check is still running", () => {
  const result = assessPullRequest(
    pullRequest({ checks: [...GREEN, check("IN_PROGRESS", null, "secrets")] }),
  );

  assert.equal(result.eligible, false);
  assert.match(result.reason, /still running/);
});

test("refuses when any check failed, even if others are still running", () => {
  for (const conclusion of ["FAILURE", "CANCELLED", "TIMED_OUT"]) {
    const result = assessPullRequest(
      pullRequest({
        checks: [check("QUEUED", null, "links"), check("COMPLETED", conclusion, "test")],
      }),
    );

    assert.equal(result.eligible, false, conclusion);
    assert.match(result.reason, /failed/, conclusion);
  }
});

test("refuses when no check has reported", () => {
  assert.equal(assessPullRequest(pullRequest({ checks: [] })).eligible, false);
  const { statusCheckRollup, ...withoutRollup } = pullRequest();
  assert.equal(statusCheckRollup.length > 0, true);
  assert.equal(assessPullRequest(withoutRollup).eligible, false);
});

test("reads commit statuses as well as check runs", () => {
  const status = (state) => ({ __typename: "StatusContext", context: "ci", state });

  assert.equal(assessPullRequest(pullRequest({ checks: [status("SUCCESS")] })).eligible, true);
  assert.match(assessPullRequest(pullRequest({ checks: [status("PENDING")] })).reason, /still running/);
  assert.match(assessPullRequest(pullRequest({ checks: [status("FAILURE")] })).reason, /failed/);
  assert.match(assessPullRequest(pullRequest({ checks: [status("ERROR")] })).reason, /failed/);
});

test("the command exits 0 for an eligible pull request and 1 otherwise, with the reason", () => {
  const eligible = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(pullRequest()),
    encoding: "utf8",
  });
  const refused = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(pullRequest({ updates: [{ update: MAJOR }] })),
    encoding: "utf8",
  });

  assert.equal(eligible.status, 0);
  assert.match(eligible.stdout, /^eligible: /);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /^not eligible: .*major/);
});
