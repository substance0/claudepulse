#!/usr/bin/env node

import ClaudeClient from "./api/claude-client.js";
import { Logger } from "./utils/logger.js";
import ClaudeScheduler from "./automation/scheduler.js";
import { loadConfig, validateConfig } from "./config/index.js";
import fs from "fs/promises";
const APP_VERSION = "1.0.0";

function setupShutdownHandlers(heartbeatInterval, scheduler) {
  const shutdown = (signal) => {
    const logger = new Logger({ service: "claudepulse-shutdown" });
    logger.info("shutdown", `Received ${signal} signal`);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (scheduler) scheduler.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function setupProcessErrorHandlers(scheduler) {
  const errLogger = new Logger({ service: "claudepulse-error" });

  const handleFatal = async (type, err) => {
    try {
      const payload = err && typeof err === 'object'
        ? { message: err.message, stack: err.stack }
        : { reason: String(err) };
      errLogger.error(type, `Fatal ${type} encountered`, payload);
      if (scheduler && typeof scheduler.shutdown === 'function') {
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
  const credPath = (typeof scheduler.getCredentialsPath === 'function') ? scheduler.getCredentialsPath() : null;
  logger.info("auth", credPath ? `Auth required. Login via 'claude' then '/login' (watching ${credPath})` : "Auth required. Login via 'claude' then '/login' (watching credentials)");

  async function statMtime(p) {
    try { const s = await fs.stat(p); return s.mtimeMs; } catch { return null; }
  }

  let lastMtime = credPath ? await statMtime(credPath) : null;
  let retrying = false;
  return await new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (!credPath) return; // wait until client is fully initialized
      const mtime = await statMtime(credPath);
      if (mtime && (!lastMtime || mtime > lastMtime)) {
        lastMtime = mtime;
        if (retrying) return;
        retrying = true;
        logger.info("auth", "Credentials detected, retrying authentication");
        try {
          const ok = await scheduler.start();
          if (ok === true) {
            clearInterval(interval);
            logger.info("auth", "Authentication succeeded");
            resolve(true);
            return;
          }
          // If scheduler is busy (undefined) or still auth-failed, keep watching
          if (ok === undefined || scheduler.lastStartFailureReason === 'auth') {
            return;
          }
          // Some other failure: stop watching and bubble up
          clearInterval(interval);
          resolve(Boolean(ok));
        } finally {
          retrying = false;
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
  const scheduler = await ClaudeScheduler.create(config);
  const startResult = await scheduler.start();

  // Handle dry run mode - exit early
  if (config.DRY_RUN) {
    logger.info("dry-run", "Dry run complete, exiting.");
    process.exit(0);
  }

  // Handle startup failures
  if (!startResult) {
    logger.error("start", "Failed to start automation scheduler");
    if (scheduler.lastStartFailureReason === 'auth') {
      const ok = await watchCredentialsAndRetry(scheduler, logger);
      if (ok) return { scheduler, heartbeatInterval: null };
    }
    if (config.KEEP_PULSE_ON_FAILURE) {
      logger.warn("hold", "KEEP_PULSE_ON_FAILURE=true - holding process for debugging");
      const holdInterval = setInterval(() => {}, 60 * 1000);
      return { scheduler: null, heartbeatInterval: holdInterval };
    }
    return { error: "Failed to start automation scheduler", scheduler: null, heartbeatInterval: null };
  }

  logger.info("start", "ClaudePulse automation running... Press Ctrl+C to stop");
  return { scheduler, heartbeatInterval: null };
}

async function main() {
  try {
    const config = loadConfig();
    validateConfig(config);

    const logger = new Logger({ service: "claudepulse" });

    logger.info("start", "ClaudePulse: Maintain steady pulse on Claude Pro/Max sessions for maximum coding availability", {
      version: APP_VERSION,
      nodeVersion: process.version
    });

    logger.info("config", "Environment Configuration", config);

    const result = await runScheduler(config, logger);

    if (result.error) {
      logger.error("init", result.error);
      process.exit(1);
    }

    const { scheduler, heartbeatInterval } = result;
    setupShutdownHandlers(heartbeatInterval, scheduler);
    setupProcessErrorHandlers(scheduler);

  } catch (error) {
    const logger = new Logger({ service: "claudepulse-error" });
    logger.error("start", "Application error", {
      message: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Run the application
main().catch((error) => {
  const logger = new Logger({ service: "claudepulse-error" });
  logger.error("main", "Unhandled error", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});