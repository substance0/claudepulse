import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Checks that .gitleaks.toml catches the secrets this project handles. The
// fake values are assembled at runtime so the repository never contains a
// string the scanner would flag. Locally the tests skip when gitleaks is not
// installed; CI sets REQUIRE_GITLEAKS=1 so a missing binary fails instead.

const FAKE_BODY = "Xq7Lm2Pz9Rt4Wv8Ky1Bn6Hc3Jd5Fg0Ss7Aq2Ze9Xw4Ec1Rv8Tb6Yn3Um5Ik0Ol7";

/** Runs gitleaks on the given text with the project config. */
function scan(text) {
  return spawnSync(
    "gitleaks",
    // --verbose prints each finding's RuleID, which the assertions check.
    ["stdin", "--config", ".gitleaks.toml", "--no-banner", "--redact", "--verbose"],
    { input: text, encoding: "utf8" },
  );
}

const gitleaksMissing =
  spawnSync("gitleaks", ["version"]).error?.code === "ENOENT";
const skip =
  gitleaksMissing && process.env.REQUIRE_GITLEAKS !== "1"
    ? "gitleaks is not installed"
    : false;

test("flags a Claude Code OAuth token", { skip }, () => {
  const token = ["sk", "ant", "oat01", `${FAKE_BODY}${FAKE_BODY}-AbCdAA`].join("-");

  const result = scan(`CLAUDE_CODE_OAUTH_TOKEN=${token}\n`);

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr + result.stdout, /claude-code-oauth-token/);
});

test("flags a Discord webhook URL", { skip }, () => {
  const url = `https://discord.com/api/webhooks/123456789012345678/${FAKE_BODY}Zk3`;

  const result = scan(`DISCORD_WEBHOOK_URL=${url}\n`);

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr + result.stdout, /discord-webhook-url/);
});

test("ignores the placeholders used in the documentation", { skip }, () => {
  const docs = [
    "CLAUDE_CODE_OAUTH_TOKEN=<token>",
    "DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...",
  ].join("\n");

  const result = scan(docs);

  assert.equal(result.status, 0, result.stderr);
});
