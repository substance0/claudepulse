import { DateUtility } from "./DateUtility.js";
import { sendDiscordAlert } from "../services/notificationService.js";
/**
 * Structured Logging Utility for ClaudePulse
 * Provides JSON-formatted, container-friendly logging with configurable levels
 */

/**
 * Log levels with numeric values for filtering
 */
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4,
};

/**
 * Operation timing
 */
class PerformanceTracker {
  constructor() {
    this.metrics = new Map();
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
        return "";

      case "config":
        // Display all provided key=value pairs (env-style), stable order
        const entries = Object.entries(data || {})
          .filter(([k, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`);
        return entries.join(", ");

      case "scheduler":
        if (data.intervalMs) {
          const nextRun = DateUtility.formatLocalIso(
            new Date(data.nextRunTime),
          );
          const strat = data.strategy || "fixed";
          return `next_run=${nextRun}, strategy=${strat}`;
        }
        return "";

      case "pulse": {
        const parts = [];
        if (data.success === true) parts.push("success");
        if (data.success === false) parts.push("failed");
        // Shown whenever present: failures are logged without a success flag,
        // and the error is what explains an outage.
        if (data.error) parts.push(`error="${data.error}"`);
        if (data.windowResetsAt) {
          parts.push(
            `window_resets=${DateUtility.formatLocalIso(new Date(data.windowResetsAt))}`,
          );
        }
        if (data.resetsAt) {
          parts.push(
            `resets=${DateUtility.formatLocalIso(new Date(data.resetsAt))}`,
          );
        }
        if (data.cost !== undefined) parts.push(`cost=${data.cost}`);
        return parts.join(", ");
      }

      case "schedule":
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

      case "dry-run":
        if (data.optimalSchedule) {
          const optimal = DateUtility.formatLocalIso(
            new Date(data.optimalSchedule),
          );
          return `scheduled_for=${optimal}`;
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
    this._log(LOG_LEVELS.WARN, category, message, data, {
      severity: "warning",
      ...metadata,
    });
  }

  /**
   * Log info message
   */
  info(category, message, data = null, metadata = {}) {
    this._log(LOG_LEVELS.INFO, category, message, data, {
      severity: "info",
      ...metadata,
    });
  }

  /**
   * Log debug message
   */
  debug(category, message, data = null, metadata = {}) {
    this._log(LOG_LEVELS.DEBUG, category, message, data, {
      severity: "debug",
      ...metadata,
    });
  }

  /**
   * Log scheduler events
   */
  logScheduler(event, data = null, metadata = {}) {
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
   * End timing and return the duration
   */
  endTimer(timerKey) {
    return this.performance.endTimer(timerKey);
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
}
