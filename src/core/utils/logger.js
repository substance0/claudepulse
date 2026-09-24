import { DateUtility } from "./DateUtility.js";
import { sendDiscordAlert } from "../services/notificationService.js";
/**
 * Structured Logging Utility for ClaudePulse
 * Provides JSON-formatted, container-friendly logging with configurable levels
 */

/**
 * Log levels with numeric values for filtering
 */
export const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4,
};

/**
 * Performance metrics tracking
 */
class PerformanceTracker {
  constructor() {
    this.metrics = new Map();
    this.counters = new Map();
  }

  startTimer(operation) {
    const key = `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.metrics.set(key, {
      operation,
      startTime: Date.now(),
      startHrTime: process.hrtime.bigint(),
    });
    return key;
  }

  /**
   * End timing and return duration
   */
  endTimer(timerKey) {
    const metric = this.metrics.get(timerKey);
    if (!metric) return null;

    const endTime = Date.now();
    const endHrTime = process.hrtime.bigint();

    const duration = {
      ms: endTime - metric.startTime,
      ns: Number(endHrTime - metric.startHrTime),
      operation: metric.operation,
    };

    this.metrics.delete(timerKey);
    return duration;
  }

  /**
   * Increment a counter
   */
  incrementCounter(name, value = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  /**
   * Get counter value
   */
  getCounter(name) {
    return this.counters.get(name) || 0;
  }

  /**
   * Get all metrics snapshot
   */
  getSnapshot() {
    return {
      counters: Object.fromEntries(this.counters),
      activeTimers: this.metrics.size,
      timestamp: DateUtility.DateUtility.formatLocalIso(new Date()),
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.clear();
    this.counters.clear();
  }
}

/**
 * Main Logger class
 */
export class Logger {
  constructor(options = {}) {
    this.logLevel = this._parseLogLevel(
      options.logLevel || process.env.LOG_LEVEL || "INFO",
    );
    this.service = options.service || "claudepulse";
    this.version = options.version || "1.0.0";
    this.discordWebhookUrl = options.discordWebhookUrl || undefined;

    // Color control: honor NO_COLOR/FORCE_COLOR, then fallback to TTY detection
    const envForceColor = (process.env.FORCE_COLOR || "")
      .toString()
      .toLowerCase();
    const envNoColor = (process.env.NO_COLOR || "").toString().toLowerCase();
    const forceColor =
      envForceColor && envForceColor !== "0" && envForceColor !== "false";
    const noColor = envNoColor && envNoColor !== "0" && envNoColor !== "false";
    let enableColors =
      options.enableColors !== undefined
        ? options.enableColors
        : process.stdout.isTTY;
    if (forceColor) enableColors = true;
    if (noColor) enableColors = false;
    this.enableColors = enableColors;

    this.performance = new PerformanceTracker();
    this.processInfo = {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    };
  }

  // Sticky footer (TTY-only) shared across all logger instances
  static _footerActive = false;
  static _footerText = "";
  static _footerVisible = false;

  static _isTTY() {
    return process.stdout && process.stdout.isTTY;
  }

  static _clearFooter() {
    if (!Logger._isTTY() || !Logger._footerVisible) return;
    try {
      process.stdout.write("\r\x1b[K");
    } catch {}
    Logger._footerVisible = false;
  }

  static _renderFooter() {
    if (!Logger._isTTY() || !Logger._footerActive || !Logger._footerText)
      return;
    const dim = "\x1b[90m";
    const reset = "\x1b[0m";
    try {
      process.stdout.write("\r" + dim + Logger._footerText + reset);
    } catch {}
    Logger._footerVisible = true;
  }

  static enableFooter(text) {
    Logger._footerText = text || Logger._footerText;
    Logger._footerActive = true;
    Logger._renderFooter();
  }

  static disableFooter() {
    Logger._clearFooter();
    Logger._footerActive = false;
  }

  static updateFooter(text) {
    Logger._footerText = text || "";
    if (Logger._footerActive) Logger._renderFooter();
  }

  /**
   * Parse log level from string or number
   */
  _parseLogLevel(level) {
    if (typeof level === "number") return level;
    if (typeof level === "string") {
      const upperLevel = level.toUpperCase();
      return LOG_LEVELS[upperLevel] !== undefined
        ? LOG_LEVELS[upperLevel]
        : LOG_LEVELS.INFO;
    }
    return LOG_LEVELS.INFO;
  }

  /**
   * Check if message should be logged at given level
   */
  _shouldLog(level) {
    return level <= this.logLevel;
  }

  /**
   * Format data for inline display - extract key properties elegantly
   */
  _formatDataForInline(data, category) {
    if (!data || typeof data !== "object") return data?.toString() || "";

    // Category-specific formatting for better readability
    switch (category.toLowerCase()) {
      case "start":
        if (data.version) return `v${data.version}`;
        if (data.authStatus) return "auth_status_checked";
        return "";

      case "config":
        // Display all provided key=value pairs (env-style), stable order
        const entries = Object.entries(data || {})
          .filter(([k, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`);
        return entries.join(", ");

      case "system":
        return data.timezone || data.usedTimezone || "";

      case "client":
        const parts = [];
        if (data.claudeCliPath) parts.push(`cli=${data.claudeCliPath}`);
        if (data.credentialsPath) parts.push(`creds=${data.credentialsPath}`);
        if (data.cliVersion) parts.push(`cli_ver=${data.cliVersion}`);
        if (
          data.environmentVariables &&
          data.environmentVariables.claudeCliPathOverride &&
          data.environmentVariables.claudeCliPathOverride !== "not set"
        )
          parts.push("override=env");
        return parts.join(", ");

      case "update":
        const sessions = `${data.activeSessions}/${data.totalSessions} sessions`;
        const current = data.currentSessionId
          ? `current=${data.currentSessionId.substring(0, 8)}`
          : "";
        const expiry = data.windowExpiry
          ? `expires=${DateUtility.formatLocalIso(new Date(data.windowExpiry))}`
          : "";
        return [sessions, current, expiry].filter(Boolean).join(", ");

      case "scheduler":
        if (data.config) {
          return `interval=${data.config.intervalHours}h, prompt="${data.config.promptText}", dry_run=${data.config.dryRun}`;
        }
        if (data.intervalMs) {
          const nextRun = DateUtility.formatLocalIso(
            new Date(data.nextRunTime),
          );
          const strat = data.strategy || "fixed";
          return `next_run=${nextRun}, strategy=${strat}`;
        }
        if (data.status === "success") {
          return "started successfully";
        }
        return "";

      case "message": {
        const parts = [];
        if (data.requestId !== undefined) parts.push(`req=${data.requestId}`);
        // request properties
        const len =
          typeof data.promptLength === "number"
            ? data.promptLength
            : data.prompt
              ? String(data.prompt).length
              : undefined;
        if (typeof len === "number") parts.push(`prompt_len=${len}`);
        if (data.prompt)
          parts.push(`prompt="${String(data.prompt).slice(0, 120)}"`);
        // response properties
        if (data.sessionId)
          parts.push(`session=${String(data.sessionId).substring(0, 8)}`);
        if (data.totalCostUsd !== undefined)
          parts.push(`cost=$${data.totalCostUsd}`);
        if (data.durationMs !== undefined)
          parts.push(`duration=${data.durationMs}ms`);
        if (data.resultLength !== undefined)
          parts.push(`resp_len=${data.resultLength}`);
        if (data.result) {
          const preview = String(data.result)
            .replace(/\s+/g, " ")
            .slice(0, 200);
          parts.push(
            `result="${preview}${data.result.length > 200 ? "…" : ""}"`,
          );
        }
        return parts.join(", ");
      }

      case "auth":
        if (data.connectionTest && data.connectionTest.success !== undefined) {
          return data.connectionTest.success
            ? "connection_test_passed"
            : "connection_test_failed";
        }
        if (typeof data.authenticated === "boolean")
          return data.authenticated ? "authenticated" : "not_authenticated";
        // Debug information for credential checks
        if (data.path) {
          const parts = [`path=${data.path}`];
          if (data.error) parts.push(`error="${data.error}"`);
          if (typeof data.hasCredentialsFile === "boolean")
            parts.push(`exists=${data.hasCredentialsFile}`);
          if (typeof data.hasValidOAuth === "boolean")
            parts.push(`validOAuth=${data.hasValidOAuth}`);
          return parts.join(", ");
        }
        return "";

      case "pulse":
        if (data.success !== undefined) {
          if (data.success) {
            return "success";
          } else {
            // Include error details for failed pulses
            const parts = ["failed"];
            if (data.error) parts.push(`error="${data.error}"`);
            if (data.sessionLimitReached) parts.push("session_limited=true");
            return parts.join(", ");
          }
        }
        return "";

      case "ready":
        return "";

      case "expiry":
        if (
          data.cycleStartUTC ||
          data.hourBoundaryExpiry ||
          data.firstMessageUTC
        ) {
          const parts = [];
          if (data.cycleStartUTC)
            parts.push(
              `start=${DateUtility.formatLocalIso(new Date(data.cycleStartUTC))}`,
            );
          if (data.hourBoundaryExpiry)
            parts.push(
              `expiry=${DateUtility.formatLocalIso(new Date(data.hourBoundaryExpiry))}`,
            );
          if (data.firstMessageUTC)
            parts.push(
              `first=${DateUtility.formatLocalIso(new Date(data.firstMessageUTC))}`,
            );
          return parts.join(", ");
        }
        if (data.reason) return data.reason;
        if (data.sessionId) return `session=${data.sessionId.substring(0, 8)}`;
        return "";

      case "schedule":
        if (data.sessionExpiry) {
          const expiryIso = DateUtility.formatLocalIso(
            new Date(data.sessionExpiry),
          );
          return `session_expires=${expiryIso}`;
        }
        if (data.planned || data.strategy || data.intervalMs !== undefined) {
          const parts = [];
          if (data.planned)
            parts.push(
              `planned=${DateUtility.formatLocalIso(new Date(data.planned))}`,
            );
          if (data.strategy) parts.push(`strategy=${data.strategy}`);
          if (data.intervalMs !== undefined)
            parts.push(`intervalMs=${data.intervalMs}`);
          return parts.join(", ");
        }
        return "";

      case "ratelimit": {
        const parts = [];
        if (data.resetTimeRaw)
          parts.push(
            `raw="${String(data.resetTimeRaw).slice(0, 80)}${String(data.resetTimeRaw).length > 80 ? "…" : ""}"`,
          );
        if (data.method) parts.push(`method=${data.method}`);
        const base = data.localIso
          ? new Date(data.localIso)
          : new Date(data.resetAt || data.iso || Date.now());
        parts.push(`at=${DateUtility.formatLocalIso(base)}`);
        return parts.join(", ");
      }

      case "cli":
        if (data.exitCode !== undefined) return `exit=${data.exitCode}`;
        return "";

      case "dry-run":
        if (data.optimalSchedule) {
          const optimal = DateUtility.formatLocalIso(
            new Date(data.optimalSchedule),
          );
          return `scheduled_for=${optimal}`;
        }
        return "";

      case "scan":
        if (data.dir && data.projectCount !== undefined) {
          return `dir=${data.dir}, projects=${data.projectCount}`;
        }
        return "";

      case "files":
        if (data.projectPath && data.count !== undefined) {
          return `count=${data.count}, path=${data.projectPath}`;
        }
        return "";

      default:
        // For unknown categories, try to extract meaningful properties
        const meaningful = [];

        // Common meaningful properties
        [
          "error",
          "message",
          "status",
          "duration",
          "count",
          "id",
          "name",
          "path",
        ].forEach((prop) => {
          if (data[prop] !== undefined) {
            let value = data[prop];
            // Extract error message if value is an Error object or has a message property
            if (
              prop === "error" &&
              typeof value === "object" &&
              value !== null
            ) {
              if (value instanceof Error) {
                value = value.message;
              } else if (value.message) {
                value = value.message;
              } else if (value.error) {
                value = value.error;
              } else {
                // Try to stringify the object
                try {
                  value = JSON.stringify(value);
                } catch {
                  value = String(value);
                }
              }
            }
            meaningful.push(`${prop}=${value}`);
          }
        });

        if (meaningful.length > 0) {
          return meaningful.slice(0, 3).join(", "); // Limit to 3 properties max
        }

        // Fallback: show object keys count if it's a complex object
        const keys = Object.keys(data);
        if (keys.length > 5) {
          return `{${keys.length} properties}`;
        }

        // Small objects: show as JSON (truncated)
        const json = JSON.stringify(data);
        return json; // avoid truncation
    }
  }

  /**
   * Format log entry as inline text
   */
  _formatLogEntry(level, category, message, data = null, metadata = {}) {
    const now = new Date();
    const timestamp = DateUtility.formatLocalIso(now);
    const levelName =
      Object.keys(LOG_LEVELS).find((key) => LOG_LEVELS[key] === level) ||
      "UNKNOWN";

    // Inline format with optional colors
    const color = this.enableColors ? this._getLevelColor(level) : "";
    const reset = this.enableColors ? "\x1b[0m" : "";
    const prefix = `${color}[${timestamp}] [${levelName}] [${category.toUpperCase()}]${reset}`;

    let output = `${prefix} ${message}`;
    if (data !== null && data !== undefined) {
      // Format data elegantly for inline display
      const formattedData = this._formatDataForInline(data, category);
      if (formattedData) {
        const dataColor = this.enableColors ? "\x1b[90m" : ""; // Gray color for data
        output += ` ${dataColor}(${formattedData})${reset}`;
      }
    }

    return output;
  }

  /**
   * Get ANSI color code for log level
   */
  _getLevelColor(level) {
    const colors = {
      [LOG_LEVELS.ERROR]: "\x1b[31m", // Red
      [LOG_LEVELS.WARN]: "\x1b[33m", // Yellow
      [LOG_LEVELS.INFO]: "\x1b[36m", // Cyan
      [LOG_LEVELS.DEBUG]: "\x1b[35m", // Magenta
      [LOG_LEVELS.TRACE]: "\x1b[37m", // White
    };
    return colors[level] || "\x1b[0m";
  }

  /**
   * Core logging method
   */
  _log(level, category, message, data = null, metadata = {}) {
    if (!this._shouldLog(level)) return;

    const formattedMessage = this._formatLogEntry(
      level,
      category,
      message,
      data,
      metadata,
    );

    // Use stderr for errors and warnings, stdout for everything else
    const output = level <= LOG_LEVELS.WARN ? process.stderr : process.stdout;
    const hadFooter = Logger._footerActive && Logger._isTTY();
    if (hadFooter) Logger._clearFooter();
    output.write(formattedMessage + "\n");
    if (hadFooter) Logger._renderFooter();
  }

  /**
   * Log error message
   */
  async error(category, message, data = null, metadata = {}) {
    this.performance.incrementCounter("logs.error");
    this._log(LOG_LEVELS.ERROR, category, message, data, {
      severity: "error",
      ...metadata,
    });

    // Send Discord notification if webhook is configured
    if (this.discordWebhookUrl) {
      const fields = [];

      // Add category
      fields.push({
        name: "Category",
        value: category.toUpperCase(),
        inline: true,
      });

      // Add component if provided in metadata
      if (metadata.component) {
        fields.push({
          name: "Component",
          value: metadata.component,
          inline: true,
        });
      }

      // Add error code if provided
      if (metadata.errorCode) {
        fields.push({
          name: "Error Code",
          value: metadata.errorCode,
          inline: true,
        });
      }

      // Add structured data fields
      if (data && typeof data === "object") {
        // Add error message from data if present
        if (data.error) {
          const errorMessage =
            typeof data.error === "string" ? data.error : data.error.message;
          fields.push({
            name: "Error Details",
            value: errorMessage.slice(0, 1024), // Discord field limit
            inline: false,
          });
        }

        // Add status code if present
        if (data.statusCode) {
          fields.push({
            name: "Status Code",
            value: String(data.statusCode),
            inline: true,
          });
        }
      }

      // Send Discord alert (non-blocking)
      sendDiscordAlert(
        {
          title: `🚨 ${this.service} Error`,
          description: message,
          level: "ERROR",
          fields,
          timestamp: new Date().toISOString(),
        },
        this.discordWebhookUrl,
      ).catch((err) => {
        // Silently fail - don't log Discord errors to avoid loops
        console.error("Discord notification failed:", err.message);
      });
    }
  }

  /**
   * Log warning message
   */
  warn(category, message, data = null, metadata = {}) {
    this.performance.incrementCounter("logs.warn");
    this._log(LOG_LEVELS.WARN, category, message, data, {
      severity: "warning",
      ...metadata,
    });
  }

  /**
   * Log info message
   */
  info(category, message, data = null, metadata = {}) {
    this.performance.incrementCounter("logs.info");
    this._log(LOG_LEVELS.INFO, category, message, data, {
      severity: "info",
      ...metadata,
    });
  }

  /**
   * Log debug message
   */
  debug(category, message, data = null, metadata = {}) {
    this.performance.incrementCounter("logs.debug");
    this._log(LOG_LEVELS.DEBUG, category, message, data, {
      severity: "debug",
      ...metadata,
    });
  }

  /**
   * Log trace message
   */
  trace(category, message, data = null, metadata = {}) {
    this.performance.incrementCounter("logs.trace");
    this._log(LOG_LEVELS.TRACE, category, message, data, {
      severity: "trace",
      ...metadata,
    });
  }

  /**
   * Log OAuth authentication events
   */
  logAuth(event, success, data = null, metadata = {}) {
    const level = success ? LOG_LEVELS.INFO : LOG_LEVELS.ERROR;
    const message = `OAuth ${event} ${success ? "successful" : "failed"}`;

    this.performance.incrementCounter(
      success ? "auth.success" : "auth.failure",
    );
    this._log(level, "auth", message, data, {
      authEvent: event,
      authSuccess: success,
      ...metadata,
    });
  }

  /**
   * Log API call events with timing
   */
  logApiCall(method, endpoint, statusCode, duration = null, data = null) {
    const success = statusCode >= 200 && statusCode < 400;
    const level = success ? LOG_LEVELS.INFO : LOG_LEVELS.ERROR;
    const message = `API ${method} ${endpoint} responded with ${statusCode}`;

    this.performance.incrementCounter(success ? "api.success" : "api.failure");

    const metadata = {
      apiMethod: method,
      apiEndpoint: endpoint,
      apiStatusCode: statusCode,
      apiSuccess: success,
    };

    if (duration) {
      metadata.apiDurationMs = duration.ms;
      metadata.apiDurationNs = duration.ns;
    }

    this._log(level, "api", message, data, metadata);
  }

  /**
   * Log scheduler events
   */
  logScheduler(event, data = null, metadata = {}) {
    this.performance.incrementCounter("scheduler.events");
    this._log(LOG_LEVELS.INFO, "scheduler", `Scheduler ${event}`, data, {
      schedulerEvent: event,
      ...metadata,
    });
  }

  /**
   * Start timing an operation
   */
  startTimer(operation) {
    return this.performance.startTimer(operation);
  }

  /**
   * End timing and optionally log the result
   */
  endTimer(timerKey, logResult = false, category = "performance") {
    const duration = this.performance.endTimer(timerKey);

    if (duration && logResult) {
      this.debug(category, `Operation '${duration.operation}' completed`, {
        durationMs: duration.ms,
        durationNs: duration.ns,
      });
    }

    return duration;
  }

  /**
   * Log performance metrics summary
   */
  logMetrics() {
    const snapshot = this.performance.getSnapshot();
    this.info("metrics", "Performance metrics snapshot", snapshot);
  }

  /**
   * Create child logger with additional context
   */
  child(additionalContext = {}) {
    const childLogger = new Logger({
      logLevel: this.logLevel,
      service: this.service,
      version: this.version,
      enableColors: this.enableColors,
      // Without this, alerts raised through a child logger are dropped.
      discordWebhookUrl: this.discordWebhookUrl,
    });

    // Override the _log method to include additional context
    const originalLog = childLogger._log.bind(childLogger);
    childLogger._log = (level, category, message, data, metadata) => {
      return originalLog(level, category, message, data, {
        ...additionalContext,
        ...metadata,
      });
    };

    // Share performance tracker
    childLogger.performance = this.performance;

    return childLogger;
  }

  // Instance helpers for sticky footer
  enableFooter(text) {
    Logger.enableFooter(text);
  }
  disableFooter() {
    Logger.disableFooter();
  }
  updateFooter(text) {
    Logger.updateFooter(text);
  }

  /**
   * Set log level dynamically
   */
  setLogLevel(level) {
    this.logLevel = this._parseLogLevel(level);
    this.info(
      "logger",
      `Log level set to ${Object.keys(LOG_LEVELS).find((key) => LOG_LEVELS[key] === this.logLevel)}`,
    );
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      logLevel: this.logLevel,
      logLevelName: Object.keys(LOG_LEVELS).find(
        (key) => LOG_LEVELS[key] === this.logLevel,
      ),
      service: this.service,
      version: this.version,
      enableColors: this.enableColors,
    };
  }
}

// Create default logger instance
const defaultLogger = new Logger({
  service: "claudepulse",
  version: "1.0.0",
});

export default defaultLogger;
