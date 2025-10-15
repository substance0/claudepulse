#!/usr/bin/env node

import ClaudeClient from "./features/claude/client/ClaudeClient.js";
import { Logger } from "./core/utils/logger.js";
import PulseScheduler from "./features/scheduling/automation/scheduler.js";
import { loadConfig, validateConfig } from "./core/config/index.js";
import AuthConfig from "./core/config/auth-config.js";
import { OAuthManager } from "./features/auth/oauth/OAuthManager.js";
import SessionTracker from "./features/claude/session/SessionTracker.js";
import CredentialStore from "./features/auth/CredentialStore.js";
import ClaudeLogReader from "./features/claude/ClaudeLogReader.js";
import OAuthStateStore from "./features/auth/OAuthStateStore.js";
import SdkExecutor from "./features/claude/executor/SdkExecutor.js";
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

async function watchCredentialsAndRetry(scheduler, logger) {
  const credPath = scheduler.client?.getCredentialsPath() || null;

  async function statMtime(p) {
    try {
      const s = await fs.stat(p);
      return s.mtimeMs;
    } catch {
      return null;
    }
  }

  let lastMtime = credPath ? await statMtime(credPath) : null;
  let authCheckInProgress = null; // Store the promise to prevent race conditions
  return await new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (!credPath) return; // wait until client is fully initialized
      const mtime = await statMtime(credPath);
      if (mtime && (!lastMtime || mtime > lastMtime)) {
        lastMtime = mtime;

        // If already checking, wait for that check to complete
        if (authCheckInProgress) {
          try {
            const result = await authCheckInProgress;
            if (result) {
              clearInterval(interval);
              resolve(true);
            }
          } catch (error) {
            logger.debug("auth", "Existing auth check failed");
          }
          return;
        }

        // Start new check and store promise
        authCheckInProgress = (async () => {
          try {
            logger.info(
              "auth",
              "Credentials detected, verifying authentication",
            );
            // Only check authentication status - don't start scheduler (it will be started later)
            const authStatus = await scheduler.client.getAuthStatus();

            if (authStatus.authenticated) {
              clearInterval(interval);
              logger.debug("auth", "Authentication verification successful");
              return true;
            }

            // If still not authenticated, keep watching
            logger.debug(
              "auth",
              "Credentials found but authentication still not valid, continuing to watch",
            );
            return false;
          } catch (error) {
            logger.debug("auth", "Error checking authentication status", {
              error: error.message,
            });
            return false;
          } finally {
            authCheckInProgress = null;
          }
        })();

        const result = await authCheckInProgress;
        if (result) {
          resolve(true);
        }
      }
    }, 2000);
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

  // 5.5. Create SDK execution chain (SdkExecutor -> ClaudeSdkAdapter -> ApiClient)
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
    client,
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

  // Wait for authentication to be successful BEFORE starting scheduler
  const authStatus = await scheduler.client.getAuthStatus();
  if (!authStatus.authenticated) {
    if (authStatus.isOAuthFlow) {
      logger.info(
        "auth",
        "OAuth authentication in progress - waiting for credential creation",
      );
      const authSucceeded = await watchCredentialsAndRetry(scheduler, logger);
      if (!authSucceeded) {
        if (config.KEEP_PULSE_ON_FAILURE) {
          logger.warn(
            "hold",
            "KEEP_PULSE_ON_FAILURE=true - holding process for debugging",
          );
          const holdInterval = setInterval(() => {}, 60 * 1000);
          return { scheduler: null, heartbeatInterval: holdInterval };
        }
        return {
          error: "Authentication failed",
          scheduler: null,
          heartbeatInterval: null,
        };
      }
      logger.info("auth", "Authentication successful");
    } else {
      logger.error(
        "auth",
        "Authentication required but no OAuth flow initiated",
      );
      if (config.KEEP_PULSE_ON_FAILURE) {
        logger.warn(
          "hold",
          "KEEP_PULSE_ON_FAILURE=true - holding process for debugging",
        );
        const holdInterval = setInterval(() => {}, 60 * 1000);
        return { scheduler: null, heartbeatInterval: holdInterval };
      }
      return {
        error: "Authentication required",
        scheduler: null,
        heartbeatInterval: null,
      };
    }
  } else {
    logger.info("auth", "Authentication already valid");
  }

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

    logger.info("config", "Environment Configuration", config);

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
