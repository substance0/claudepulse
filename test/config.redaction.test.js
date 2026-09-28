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

test("masks the window notification webhook URL", () => {
  // Arrange
  const config = {
    DISCORD_WINDOW_WEBHOOK_URL: "https://discord.com/api/webhooks/456/s3cr3t",
  };

  // Act
  const redacted = redactConfigSecrets(config);

  // Assert
  assert.equal(redacted.DISCORD_WINDOW_WEBHOOK_URL, "[REDACTED]");
});

test("reads the window notification webhook from the environment", async () => {
  // Arrange
  const { loadConfig } = await import("../src/core/config/index.js");
  process.env.DISCORD_WINDOW_WEBHOOK_URL = "https://discord.com/api/webhooks/7/w";

  try {
    // Act
    const config = loadConfig();

    // Assert
    assert.equal(
      config.DISCORD_WINDOW_WEBHOOK_URL,
      "https://discord.com/api/webhooks/7/w",
    );
  } finally {
    delete process.env.DISCORD_WINDOW_WEBHOOK_URL;
  }
});

test("has no settings that nothing reads", async () => {
  // Arrange
  const { loadConfig } = await import("../src/core/config/index.js");

  // Act
  const config = loadConfig();

  // Assert
  assert.equal("NODE_ENV" in config, false);
  assert.equal("DEBUG" in config, false);
});

test("reads the account label from the environment", async () => {
  // Arrange
  const { loadConfig } = await import("../src/core/config/index.js");
  process.env.ACCOUNT_LABEL = "work";

  try {
    // Act
    const config = loadConfig();

    // Assert
    assert.equal(config.ACCOUNT_LABEL, "work");
  } finally {
    delete process.env.ACCOUNT_LABEL;
  }
});

test("an empty account label counts as unset", async () => {
  const { loadConfig } = await import("../src/core/config/index.js");
  process.env.ACCOUNT_LABEL = "";

  try {
    assert.equal(loadConfig().ACCOUNT_LABEL, undefined);
  } finally {
    delete process.env.ACCOUNT_LABEL;
  }
});

test("rejects an account label with characters Discord would format", async () => {
  const { loadConfig, validateConfig } = await import("../src/core/config/index.js");

  for (const label of ["a*b", "a`b", "line\nbreak", "x".repeat(33)]) {
    const config = { ...loadConfig(), ACCOUNT_LABEL: label };
    assert.throws(() => validateConfig(config), /ACCOUNT_LABEL/, JSON.stringify(label));
  }
});

test("accepts a plain account label", async () => {
  const { loadConfig, validateConfig } = await import("../src/core/config/index.js");

  const config = { ...loadConfig(), ACCOUNT_LABEL: "Team A_1.b-2" };

  assert.equal(validateConfig(config), true);
});

test("trims spaces around the account label", async () => {
  const { loadConfig } = await import("../src/core/config/index.js");

  try {
    process.env.ACCOUNT_LABEL = " work ";
    assert.equal(loadConfig().ACCOUNT_LABEL, "work");

    process.env.ACCOUNT_LABEL = "   ";
    assert.equal(loadConfig().ACCOUNT_LABEL, undefined);
  } finally {
    delete process.env.ACCOUNT_LABEL;
  }
});

test("reads the work-hours settings", async () => {
  const { loadConfig } = await import("../src/core/config/index.js");
  Object.assign(process.env, {
    WORK_START: "09:00",
    WORK_END: "19:00",
    WORK_DAYS: "Mon-Fri",
    HOURS_LEFT_AT_START: "2",
  });

  try {
    const config = loadConfig();
    assert.equal(config.WORK_START, "09:00");
    assert.equal(config.WORK_END, "19:00");
    assert.equal(config.WORK_DAYS, "Mon-Fri");
    assert.equal(config.HOURS_LEFT_AT_START, "2");
  } finally {
    for (const key of ["WORK_START", "WORK_END", "WORK_DAYS", "HOURS_LEFT_AT_START"]) {
      delete process.env[key];
    }
  }
});

test("rejects work hours that end before they start", async () => {
  const { loadConfig, validateConfig } = await import("../src/core/config/index.js");
  const config = {
    ...loadConfig(),
    WORK_HOURS_ENABLED: true,
    WORK_START: "19:00",
    WORK_END: "09:00",
  };

  assert.throws(() => validateConfig(config), /WORK_END must be later than WORK_START/);
});

test("work hours are off unless WORK_HOURS_ENABLED is true", async () => {
  const { loadConfig } = await import("../src/core/config/index.js");

  try {
    assert.equal(loadConfig().WORK_HOURS_ENABLED, false);
    process.env.WORK_HOURS_ENABLED = "true";
    assert.equal(loadConfig().WORK_HOURS_ENABLED, true);
  } finally {
    delete process.env.WORK_HOURS_ENABLED;
  }
});

test("reads the token expiry date", async () => {
  const { loadConfig } = await import("../src/core/config/index.js");
  process.env.TOKEN_EXPIRES_AT = "2027-09-25";

  try {
    assert.equal(loadConfig().TOKEN_EXPIRES_AT, "2027-09-25");
  } finally {
    delete process.env.TOKEN_EXPIRES_AT;
  }
});

test("rejects a token expiry that is not a real date", async () => {
  const { loadConfig, validateConfig } = await import("../src/core/config/index.js");
  const config = { ...loadConfig(), TOKEN_EXPIRES_AT: "2027-02-30" };

  assert.throws(() => validateConfig(config), /TOKEN_EXPIRES_AT must be a date as YYYY-MM-DD/);
});
