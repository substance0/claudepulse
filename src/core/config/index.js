/**
 * Centralized Configuration Management for ClaudePulse
 * Consolidates all environment variables and defaults in one place
 */

import { workHoursErrors } from "../../features/scheduling/workHours.js";
import { parseExpiryDate } from "../services/tokenExpiry.js";

/** Config keys whose values must never reach logs, alerts, or error payloads. */
const SECRET_CONFIG_KEYS = [
  "DISCORD_WEBHOOK_URL",
  "DISCORD_WINDOW_WEBHOOK_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
];

/**
 * Return a copy of the config with secret values masked, for safe logging.
 * Keys that hold no value are left as-is, so an unset secret is not mistaken
 * for a configured one.
 * @param {Object} config - Configuration object
 * @returns {Object} New config object with secrets masked
 */
export function redactConfigSecrets(config) {
  const redacted = { ...config };

  for (const key of SECRET_CONFIG_KEYS) {
    if (redacted[key]) {
      redacted[key] = "[REDACTED]";
    }
  }

  return redacted;
}

const DEFAULT_CONFIG = {
  PROMPT_TEXT: "pulse check",
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MULTIPLIER: 2,
  MAX_BACKOFF_MINUTES: 30,
  LOG_LEVEL: "INFO",
  DRY_RUN: false,
  KEEP_PULSE_ON_FAILURE: false,
  SCHEDULED_START_HOUR: undefined,

  IMMEDIATE_PULSE_AFTER_AUTH: true,
  DISCORD_WEBHOOK_URL: undefined,
  DISCORD_WINDOW_WEBHOOK_URL: undefined,
  ACCOUNT_LABEL: undefined,
  TOKEN_EXPIRES_AT: undefined,
  WORK_HOURS_ENABLED: false,
  WORK_START: undefined,
  WORK_END: undefined,
  WORK_DAYS: undefined,
  HOURS_LEFT_AT_START: undefined,
};

/**
 * Parse and validate environment variables
 * @returns {Object} Environment configuration object
 */
function parseEnvironmentVariables() {
  return {
    PROMPT_TEXT: process.env.PROMPT_TEXT,
    MAX_RETRIES: process.env.MAX_RETRIES,
    RETRY_BACKOFF_MULTIPLIER: process.env.RETRY_BACKOFF_MULTIPLIER,
    MAX_BACKOFF_MINUTES: process.env.MAX_BACKOFF_MINUTES,
    LOG_LEVEL: process.env.LOG_LEVEL,
    DRY_RUN: process.env.DRY_RUN,
    KEEP_PULSE_ON_FAILURE: process.env.KEEP_PULSE_ON_FAILURE,
    SCHEDULED_START_HOUR: process.env.SCHEDULED_START_HOUR,

    IMMEDIATE_PULSE_AFTER_AUTH: process.env.IMMEDIATE_PULSE_AFTER_AUTH,
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
    DISCORD_WINDOW_WEBHOOK_URL: process.env.DISCORD_WINDOW_WEBHOOK_URL,
    // Trimmed: a stray space in an env file would otherwise show in every label
    ACCOUNT_LABEL: process.env.ACCOUNT_LABEL?.trim() || undefined,
    TOKEN_EXPIRES_AT: process.env.TOKEN_EXPIRES_AT || undefined,
    WORK_HOURS_ENABLED: process.env.WORK_HOURS_ENABLED,
    WORK_START: process.env.WORK_START || undefined,
    WORK_END: process.env.WORK_END || undefined,
    WORK_DAYS: process.env.WORK_DAYS || undefined,
    HOURS_LEFT_AT_START: process.env.HOURS_LEFT_AT_START || undefined,
  };
}

/**
 * Load and merge configuration from defaults and environment
 * @returns {Object} Complete configuration object with validated values
 */
export function loadConfig() {
  const envConfig = parseEnvironmentVariables();
  const config = { ...DEFAULT_CONFIG };

  // Override with environment variables where provided
  Object.keys(envConfig).forEach((key) => {
    if (envConfig[key] !== undefined) {
      config[key] = envConfig[key];
    }
  });

  // Type conversions
  config.MAX_RETRIES = parseInt(config.MAX_RETRIES);
  config.RETRY_BACKOFF_MULTIPLIER = parseFloat(config.RETRY_BACKOFF_MULTIPLIER);
  config.MAX_BACKOFF_MINUTES = parseInt(config.MAX_BACKOFF_MINUTES);
  config.DRY_RUN = config.DRY_RUN === "true";
  config.KEEP_PULSE_ON_FAILURE = config.KEEP_PULSE_ON_FAILURE === "true";
  config.WORK_HOURS_ENABLED = config.WORK_HOURS_ENABLED === "true";
  config.IMMEDIATE_PULSE_AFTER_AUTH =
    config.IMMEDIATE_PULSE_AFTER_AUTH !== "false";

  if (config.SCHEDULED_START_HOUR !== undefined) {
    const rh = parseInt(config.SCHEDULED_START_HOUR);
    config.SCHEDULED_START_HOUR = Number.isFinite(rh) ? rh : undefined;
  }

  return config;
}

/**
 * Validate configuration values
 * @param {Object} config - Configuration object to validate
 * @throws {Error} Throws error if configuration is invalid
 */
export function validateConfig(config) {
  const errors = [];

  if (!config.PROMPT_TEXT || typeof config.PROMPT_TEXT !== "string") {
    errors.push("PROMPT_TEXT must be a non-empty string");
  }

  if (config.MAX_RETRIES < 1 || config.MAX_RETRIES > 10) {
    errors.push("MAX_RETRIES must be between 1 and 10");
  }

  if (
    config.RETRY_BACKOFF_MULTIPLIER < 1 ||
    config.RETRY_BACKOFF_MULTIPLIER > 5
  ) {
    errors.push("RETRY_BACKOFF_MULTIPLIER must be between 1 and 5");
  }

  if (config.MAX_BACKOFF_MINUTES < 1 || config.MAX_BACKOFF_MINUTES > 300) {
    errors.push("MAX_BACKOFF_MINUTES must be between 1 and 300");
  }

  const validLogLevels = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];
  if (!validLogLevels.includes(config.LOG_LEVEL.toUpperCase())) {
    errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(", ")}`);
  }

  if (config.SCHEDULED_START_HOUR !== undefined) {
    if (
      typeof config.SCHEDULED_START_HOUR !== "number" ||
      config.SCHEDULED_START_HOUR < 0 ||
      config.SCHEDULED_START_HOUR > 23
    ) {
      errors.push("SCHEDULED_START_HOUR must be an integer between 0 and 23");
    }
  }

  if (
    config.ACCOUNT_LABEL !== undefined &&
    !/^[A-Za-z0-9 ._-]{1,32}$/.test(config.ACCOUNT_LABEL)
  ) {
    errors.push(
      "ACCOUNT_LABEL must be 1-32 letters, digits, spaces, dots, underscores or hyphens",
    );
  }

  if (
    config.TOKEN_EXPIRES_AT !== undefined &&
    !parseExpiryDate(config.TOKEN_EXPIRES_AT)
  ) {
    errors.push("TOKEN_EXPIRES_AT must be a date as YYYY-MM-DD, e.g. 2027-09-25");
  }

  errors.push(...workHoursErrors(config));

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join("\n")}`);
  }

  return true;
}
