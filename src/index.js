#!/usr/bin/env node

import ClaudeClient from "./features/claude/client/ClaudeClient.js";
import { Logger } from "./core/utils/logger.js";
import PulseScheduler from "./features/scheduling/automation/scheduler.js";
import {
  loadConfig,
  redactConfigSecrets,
  validateConfig,
} from "./core/config/index.js";
import AuthConfig from "./core/config/auth-config.js";
import { OAuthManager } from "./features/auth/oauth/OAuthManager.js";
import SessionTracker from "./features/claude/session/SessionTracker.js";
import CredentialStore from "./features/auth/CredentialStore.js";
import ClaudeLogReader from "./features/claude/ClaudeLogReader.js";
import OAuthStateStore from "./features/auth/OAuthStateStore.js";
import SdkExecutor from "./features/claude/executor/SdkExecutor.js";
import { ClaudeCliExecutor } from "./features/claude/executor/ClaudeCliExecutor.js";
import ClaudeSdkAdapter from "./features/claude/client/ClaudeSdkAdapter.js";
import ApiClient from "./features/claude/client/ApiClient.js";
import { displayBanner } from "./core/utils/banner.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require("../package.json");

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

  // 1. Create AuthConfig and load it
  const authConfig = new AuthConfig();
  await authConfig.load();

  // 2. Create child logger for client
  const clientLogger = logger.child({ component: "claude-client" });

  // 3. Determine credentials path
  const credentialsPath = "/home/claudepulse/.claude/.credentials.json";

  // 4. Create CredentialStore
  const credentialStore = new CredentialStore({
    credentialsPath,
    logger: clientLogger,
    authConfig,
  });

  // 4.5. Create OAuthStateStore
  const oauthStatePath = path.join(
    path.dirname(credentialsPath),
    ".oauth-pending.json",
  );
  const stateStore = new OAuthStateStore({
    statePath: oauthStatePath,
    logger: clientLogger,
  });

  // 5. Create OAuthManager with CredentialStore and StateStore
  const oauthManager = new OAuthManager({
    credentialsPath,
    authConfig,
    logger: clientLogger,
    credentialStore,
    stateStore,
  });

  // 5.5. Create the pulse executor. It runs Claude Code in a directory of its
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

  // 5.6. Create SDK execution chain (SdkExecutor -> ClaudeSdkAdapter -> ApiClient)
  const sdkExecutor = new SdkExecutor({
    logger: clientLogger,
  });

  const sdkAdapter = new ClaudeSdkAdapter({
    sdkExecutor,
    logger: clientLogger,
  });

  const apiClient = new ApiClient({
    sdkAdapter,
    logger: clientLogger,
    maxRetries: config.MAX_RETRIES || 3,
    retryBackoffMultiplier: config.RETRY_BACKOFF_MULTIPLIER || 2,
    maxBackoffMinutes: config.MAX_BACKOFF_MINUTES || 30,
  });

  // 6. Create ClaudeClient with all dependencies
  const client = new ClaudeClient({
    credentialsPath,
    logger: clientLogger,
    authConfig,
    oauthManager,
    credentialStore,
    apiClient,
  });

  // 7. Create ClaudeLogReader for SessionTracker
  const logReaderLogger = logger.child({ component: "log-reader" });
  const logReader = new ClaudeLogReader({
    logger: logReaderLogger,
  });

  // 8. Create SessionTracker with ClaudeLogReader
  const sessionTracker = new SessionTracker({
    logReader,
  });

  // 9. Create PulseScheduler with all dependencies
  const scheduler = new PulseScheduler({
    executor,
    sessionTracker,
    logger,
    config,
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

  // Now that authentication is successful, start scheduler ONCE
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

    // Warn if mock modes are enabled
    const mockSessionLimit = process.env.MOCK_CLAUDE_SESSION_LIMIT_MESSAGE;
    if (mockSessionLimit) {
      logger.warn(
        "config",
        `Mock mode enabled: Simulating session limit error response (MOCK_CLAUDE_SESSION_LIMIT_MESSAGE="${mockSessionLimit}")`,
      );
    }

    const mockPingSuccess = process.env.MOCK_CLAUDE_PING_SUCCESS_MESSAGE;
    if (mockPingSuccess) {
      logger.warn(
        "config",
        `Mock mode enabled: Simulating successful ping response (MOCK_CLAUDE_PING_SUCCESS_MESSAGE="${mockPingSuccess}")`,
      );
    }

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
