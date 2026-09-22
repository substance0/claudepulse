import { test } from "node:test";
import assert from "node:assert/strict";

import { redactConfigSecrets } from "../src/core/config/index.js";

test("masks the Discord webhook URL", () => {
  // Arrange
  const config = {
    DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/s3cr3t-value",
  };

  // Act
  const redacted = redactConfigSecrets(config);

  // Assert
  assert.equal(redacted.DISCORD_WEBHOOK_URL, "[REDACTED]");
});

test("masks the OAuth token", () => {
  // Arrange
  const config = { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-s3cr3t" };

  // Act
  const redacted = redactConfigSecrets(config);

  // Assert
  assert.equal(redacted.CLAUDE_CODE_OAUTH_TOKEN, "[REDACTED]");
});

test("leaves non-secret values untouched", () => {
  // Arrange
  const config = { LOG_LEVEL: "INFO", MAX_RETRIES: 3, DRY_RUN: false };

  // Act
  const redacted = redactConfigSecrets(config);

  // Assert
  assert.deepEqual(redacted, { LOG_LEVEL: "INFO", MAX_RETRIES: 3, DRY_RUN: false });
});

test("reports unset secrets as unset rather than redacted", () => {
  // Arrange
  const config = { DISCORD_WEBHOOK_URL: undefined, LOG_LEVEL: "INFO" };

  // Act
  const redacted = redactConfigSecrets(config);

  // Assert - masking an absent value would wrongly imply one is configured
  assert.equal(redacted.DISCORD_WEBHOOK_URL, undefined);
});

test("does not mutate the config it is given", () => {
  // Arrange
  const config = { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/x" };

  // Act
  redactConfigSecrets(config);

  // Assert
  assert.equal(
    config.DISCORD_WEBHOOK_URL,
    "https://discord.com/api/webhooks/1/x",
  );
});
