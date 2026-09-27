import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Secrets come from claudepulse.env so they stay out of `docker inspect` and
// out of the compose file. Compose lets `environment:` override `env_file:`,
// so a secret listed under `environment:` would mask the env file's value.
const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.dev.yml"];
const SECRETS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "DISCORD_WEBHOOK_URL",
  "DISCORD_WINDOW_WEBHOOK_URL",
];

test("compose files read secrets from claudepulse.env", () => {
  for (const name of COMPOSE_FILES) {
    const text = fs.readFileSync(name, "utf8");
    assert.match(text, /env_file:\n\s+- claudepulse\.env/, name);
  }
});

test("compose files never set a secret under environment", () => {
  for (const name of COMPOSE_FILES) {
    const text = fs.readFileSync(name, "utf8");
    for (const secret of SECRETS) {
      assert.doesNotMatch(text, new RegExp(`^\\s+- ${secret}=`, "m"), `${name}: ${secret}`);
    }
  }
});
