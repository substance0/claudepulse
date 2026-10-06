#!/usr/bin/env node
/**
 * Decide whether a Dependabot pull request may be merged without a person
 * reading it.
 *
 * Only patch and minor updates qualify, and only when the change stays inside
 * the release tooling (the root package.json and package-lock.json) or the
 * workflow files, and every check on the pull request has passed. The Claude
 * CLI in docker/claude-cli, the Dockerfile and any major update need a person:
 * they decide how pulses run, or may break the build.
 *
 * The command reads the output of
 * `gh pr view --json author,files,commits,statusCheckRollup` from stdin,
 * prints the decision and exits 0 when the pull request is eligible, 1 when it
 * is not.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** `gh` prints an app's login with an `app/` prefix; the API says `[bot]`. */
const DEPENDABOT_LOGINS = new Set(["dependabot[bot]", "app/dependabot"]);

const SAFE_UPDATE_TYPES = new Set([
  "version-update:semver-patch",
  "version-update:semver-minor",
]);

const NPM_FILES = new Set(["package.json", "package-lock.json"]);
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;

/** Conclusions of a finished check that do not hold a merge back. */
const PASSING_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** Lines such as `  update-type: version-update:semver-minor` in a commit body. */
const METADATA_LINE = /^\s*(update-type|dependency-type):\s*(\S+)\s*$/gm;

/** @returns {Record<"update-type" | "dependency-type", string[]>} */
function readMetadata(commits) {
  const found = { "update-type": [], "dependency-type": [] };
  for (const commit of commits) {
    for (const [, key, value] of (commit.messageBody ?? "").matchAll(METADATA_LINE)) {
      found[key].push(value);
    }
  }
  return found;
}

/**
 * @param {Object[]} [rollup] - `statusCheckRollup` of the pull request
 * @returns {"none" | "running" | "failed" | "passed"} A failure outranks a
 *   check that is still running
 */
function checkState(rollup = []) {
  if (rollup.length === 0) {
    return "none";
  }

  let running = false;
  for (const item of rollup) {
    if (item.__typename === "StatusContext") {
      if (item.state === "SUCCESS") continue;
      if (item.state === "PENDING" || item.state === "EXPECTED") running = true;
      else return "failed";
    } else if (item.status !== "COMPLETED") {
      running = true;
    } else if (!PASSING_CONCLUSIONS.has(item.conclusion)) {
      return "failed";
    }
  }
  return running ? "running" : "passed";
}

const refuse = (reason) => ({ eligible: false, reason });

/**
 * @param {{author?: {login?: string}, files?: {path: string}[], commits?: {messageBody?: string}[]}} pr
 *   Pull request as `gh pr view --json author,files,commits` prints it
 * @returns {{eligible: boolean, reason: string}}
 */
export function assessPullRequest(pr) {
  if (!DEPENDABOT_LOGINS.has(pr.author?.login)) {
    return refuse("it was not opened by Dependabot");
  }

  const paths = (pr.files ?? []).map((file) => file.path);
  if (paths.length === 0) {
    return refuse("it changes no files");
  }

  const touchesNpm = paths.every((path) => NPM_FILES.has(path));
  const touchesWorkflows = paths.every((path) => WORKFLOW_FILE.test(path));
  if (!touchesNpm && !touchesWorkflows) {
    return refuse(
      `it changes files outside the root npm manifest and the workflows: ${paths.join(", ")}`,
    );
  }

  const metadata = readMetadata(pr.commits ?? []);
  if (metadata["update-type"].length === 0) {
    return refuse("no update type is recorded");
  }

  const unsafe = metadata["update-type"].find((type) => !SAFE_UPDATE_TYPES.has(type));
  if (unsafe) {
    return refuse(`it includes a ${unsafe.replace("version-update:semver-", "")} update`);
  }

  if (touchesNpm && metadata["dependency-type"].includes("direct:production")) {
    return refuse("it updates a runtime dependency");
  }

  const checks = checkState(pr.statusCheckRollup);
  if (checks !== "passed") {
    return refuse(
      {
        none: "no check has reported yet",
        running: "a check is still running",
        failed: "a check failed",
      }[checks],
    );
  }

  return {
    eligible: true,
    reason: touchesNpm
      ? "patch and minor updates to the release tooling"
      : "patch and minor updates to workflow actions",
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = assessPullRequest(JSON.parse(readFileSync(0, "utf8")));
  process.stdout.write(`${result.eligible ? "eligible" : "not eligible"}: ${result.reason}\n`);
  process.exit(result.eligible ? 0 : 1);
}
