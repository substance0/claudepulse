import { test } from "node:test";
import assert from "node:assert/strict";

import { Logger } from "../src/core/utils/logger.js";

const WEBHOOK = "https://discord.com/api/webhooks/1/test-webhook";

test("a child logger keeps the Discord webhook of its parent", () => {
  // Arrange
  const parent = new Logger({
    service: "claudepulse",
    discordWebhookUrl: WEBHOOK,
  });

  // Act
  const child = parent.child({ component: "scheduler" });

  // Assert - without this, alerts raised by components are silently dropped
  assert.equal(child.discordWebhookUrl, WEBHOOK);
});

test("a child of a logger with no webhook still has none", () => {
  // Arrange
  const parent = new Logger({ service: "claudepulse" });

  // Act
  const child = parent.child({ component: "scheduler" });

  // Assert
  assert.equal(child.discordWebhookUrl, undefined);
});
