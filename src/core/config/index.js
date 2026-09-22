/**
 * Centralized Configuration Management for ClaudePulse
 * Consolidates all environment variables and defaults in one place
 */

/** Config keys whose values must never reach logs, alerts, or error payloads. */
const SECRET_CONFIG_KEYS = ["DISCORD_WEBHOOK_URL", "CLAUDE_CODE_OAUTH_TOKEN"];

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

export const DEFAULT_CONFIG = {
  PROMPT_TEXT: "pulse check",
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MULTIPLIER: 2,
  MAX_BACKOFF_MINUTES: 30,
  DEBUG: false,
  NODE_ENV: "production",
  LOG_LEVEL: "INFO",
  DRY_RUN: false,
  KEEP_PULSE_ON_FAILURE: false,
  SCHEDULED_START_HOUR: undefined,

  IMMEDIATE_PULSE_AFTER_AUTH: true,
  DISCORD_WEBHOOK_URL: undefined,
};

/**
 * Parse and validate environment variables
 * @returns {Object} Environment configuration object
 */
export function parseEnvironmentVariables() {
  return {
    PROMPT_TEXT: process.env.PROMPT_TEXT,
    MAX_RETRIES: process.env.MAX_RETRIES,
    RETRY_BACKOFF_MULTIPLIER: process.env.RETRY_BACKOFF_MULTIPLIER,
    MAX_BACKOFF_MINUTES: process.env.MAX_BACKOFF_MINUTES,
    DEBUG: process.env.DEBUG,
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    DRY_RUN: process.env.DRY_RUN,
    KEEP_PULSE_ON_FAILURE: process.env.KEEP_PULSE_ON_FAILURE,
    SCHEDULED_START_HOUR: process.env.SCHEDULED_START_HOUR,

    IMMEDIATE_PULSE_AFTER_AUTH: process.env.IMMEDIATE_PULSE_AFTER_AUTH,
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
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
  config.DEBUG = config.DEBUG === "true";
  config.DRY_RUN = config.DRY_RUN === "true";
  config.KEEP_PULSE_ON_FAILURE = config.KEEP_PULSE_ON_FAILURE === "true";
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

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join("\n")}`);
  }

  return true;
}

export default {
  DEFAULT_CONFIG,
  loadConfig,
  validateConfig,
  parseEnvironmentVariables,
};
