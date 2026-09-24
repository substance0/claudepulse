#!/usr/bin/env node

import { Logger } from "./core/utils/logger.js";
import PulseScheduler from "./features/scheduling/automation/scheduler.js";
import {
  loadConfig,
  redactConfigSecrets,
  validateConfig,
} from "./core/config/index.js";
import { ClaudeCliExecutor } from "./features/claude/executor/ClaudeCliExecutor.js";
import { createWindowNotifier } from "./core/services/windowNotification.js";
import { displayBanner } from "./core/utils/banner.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

function setupShutdownHandlers(heartbeatInterval, scheduler) {
  const shutdown = (signal) => {
    const logger = new Logger({ service: "claudepulse-shutdown" });
    logger.disableFooter();
    logger.info("shutdown", `Received ${signal} signal`);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (scheduler) scheduler.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function setupProcessErrorHandlers(scheduler, config) {
  const errLogger = new Logger({
    service: "claudepulse-error",
    discordWebhookUrl: config?.DISCORD_WEBHOOK_URL,
  });

  const handleFatal = async (type, err) => {
    try {
      const payload =
        err && typeof err === "object"
          ? { message: err.message, stack: err.stack }
          : { reason: String(err) };
      errLogger.error(type, `Fatal ${type} encountered`, payload);
      if (scheduler && typeof scheduler.shutdown === "function") {
        await scheduler.shutdown();
      }
    } catch {}
    return { success: false, error: `Fatal ${type}: ${err}` };
  };

  process.on("unhandledRejection", (reason) => {
    handleFatal("unhandledRejection", reason);
  });
  process.on("uncaughtException", (error) => {
    handleFatal("uncaughtException", error);
  });
}

/**
 * Initialize and start the ClaudePulse automation scheduler
 * @param {Object} config - Application configuration
 * @param {Object} logger - Logger instance
 * @returns {Promise<Object>} Scheduler and heartbeat interval (if any)
 */
async function runScheduler(config, logger) {
  // === Composition Root: Build dependency graph ===

  // 1. Create child logger for the executor
  const clientLogger = logger.child({ component: "claude-client" });

  // 2. Create the pulse executor. It runs Claude Code in a directory of its
  // own, so a pulse never loads the application's files or configuration.
  const pulseCwd = path.join(os.tmpdir(), "claudepulse-pulse");
  const pulseConfigDir = path.join(os.tmpdir(), "claudepulse-config");
  await fs.mkdir(pulseCwd, { recursive: true });
  await fs.mkdir(pulseConfigDir, { recursive: true });

  const executor = new ClaudeCliExecutor({
    logger: clientLogger,
    cwd: pulseCwd,
    configDir: pulseConfigDir,
  });

  // 3. Create PulseScheduler with all dependencies. Window announcements are
  // sent only when their own webhook is configured.
  const notifier = config.DISCORD_WINDOW_WEBHOOK_URL
    ? createWindowNotifier(config.DISCORD_WINDOW_WEBHOOK_URL)
    : undefined;

  const scheduler = new PulseScheduler({
    executor,
    logger,
    config,
    notifier,
  });

  // === End Composition Root ===

  // Handle dry run mode - exit early
  if (config.DRY_RUN) {
    await scheduler.start(); // Will handle dry run internally and exit
    logger.info("dry-run", "Dry run complete, exiting.");
    process.exit(0);
  }

  // The Claude CLI authenticates each pulse itself, so there is no credential
  // state to wait on before starting. A credential that is absent or no longer
  // accepted surfaces as a failed pulse, which the scheduler reports without
  // spending its remaining attempts on it.

  const startResult = await scheduler.start();
  if (!startResult) {
    logger.error("start", "Failed to start automation scheduler");
    if (config.KEEP_PULSE_ON_FAILURE) {
      logger.warn(
        "hold",
        "KEEP_PULSE_ON_FAILURE=true - holding process for debugging",
      );
      const holdInterval = setInterval(() => {}, 60 * 1000);
      return { scheduler: null, heartbeatInterval: holdInterval };
    }
    return {
      error: "Failed to start automation scheduler",
      scheduler: null,
      heartbeatInterval: null,
    };
  }

  logger.info(
    "start",
    "ClaudePulse automation running... Press Ctrl+C to stop",
  );
  // Show sticky footer in TTY consoles
  try {
    logger.enableFooter(
      "ClaudePulse automation running... Press Ctrl+C to stop",
    );
  } catch {}
  return { scheduler, heartbeatInterval: null };
}

async function main() {
  try {
    const config = loadConfig();
    validateConfig(config);

    // Display ASCII banner at startup
    displayBanner();

    const logger = new Logger({
      service: "claudepulse",
      discordWebhookUrl: config.DISCORD_WEBHOOK_URL,
    });

    logger.info(
      "config",
      "Environment Configuration",
      redactConfigSecrets(config),
    );

    // Log local timezone information
    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const offsetSign = offsetMinutes >= 0 ? "+" : "-";
    const offsetStr = `UTC${offsetSign}${String(offsetHours).padStart(2, "0")}:${String(offsetMins).padStart(2, "0")}`;

    // Get timezone name/abbreviation and IANA identifier
    const timezoneIANA = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezoneName =
      new Intl.DateTimeFormat("en", {
        timeZoneName: "short",
      })
        .formatToParts(now)
        .find((part) => part.type === "timeZoneName")?.value || "Unknown";

    logger.info(
      "config",
      `Local timezone: ${timezoneIANA} (${timezoneName}, ${offsetStr}) - all timestamps will be displayed in local time with UTC offset`,
    );

    const result = await runScheduler(config, logger);

    if (result.error) {
      logger.error("init", result.error);
      process.exit(1);
    }

    const { scheduler, heartbeatInterval } = result;
    setupShutdownHandlers(heartbeatInterval, scheduler);
    setupProcessErrorHandlers(scheduler, config);
  } catch (error) {
    // Always try console.error first as absolute fallback
    console.error("[FATAL] Application error:", error.message);
    console.error("[FATAL] Stack trace:");
    console.error(error.stack);

    try {
      const logger = new Logger({ service: "claudepulse-error" });
      logger.error("start", "Application error", {
        message: error.message,
        stack: error.stack,
      });
    } catch (loggerError) {
      // Fallback if logger fails
      console.error(
        "[FATAL] Logger initialization also failed:",
        loggerError.message,
      );
      console.error(loggerError.stack);
    }
    process.exit(1);
  }
}

// Run the application
main().catch((error) => {
  // Always try console.error first as absolute fallback
  console.error("[FATAL] Unhandled error in main():", error.message);
  console.error("[FATAL] Stack trace:");
  console.error(error.stack);

  try {
    const logger = new Logger({ service: "claudepulse-error" });
    logger.error("main", "Unhandled error", {
      error: error.message,
      stack: error.stack,
    });
  } catch (loggerError) {
    // Fallback if logger fails
    console.error(
      "[FATAL] Logger initialization also failed:",
      loggerError.message,
    );
    console.error(loggerError.stack);
  }
  process.exit(1);
});
