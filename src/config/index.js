/**
 * Centralized Configuration Management for ClaudePulse
 * Consolidates all environment variables and defaults in one place
 */

export const DEFAULT_CONFIG = {
  PROMPT_TEXT: "pulse check",
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MULTIPLIER: 2,
  MAX_BACKOFF_MINUTES: 30,
  DEBUG: false,
  NODE_ENV: "production",
  LOG_LEVEL: "INFO",
  LOG_FORMAT: "inline",
  DRY_RUN: false,
  KEEP_PULSE_ON_FAILURE: false,
  RESET_HOUR: undefined,
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
    LOG_FORMAT: process.env.LOG_FORMAT,
    DRY_RUN: process.env.DRY_RUN,
    KEEP_PULSE_ON_FAILURE: process.env.KEEP_PULSE_ON_FAILURE,
    RESET_HOUR: process.env.RESET_HOUR,
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
  Object.keys(envConfig).forEach(key => {
    if (envConfig[key] !== undefined) {
      config[key] = envConfig[key];
    }
  });

  // Type conversions
  config.MAX_RETRIES = parseInt(config.MAX_RETRIES);
  config.RETRY_BACKOFF_MULTIPLIER = parseFloat(config.RETRY_BACKOFF_MULTIPLIER);
  config.MAX_BACKOFF_MINUTES = parseInt(config.MAX_BACKOFF_MINUTES);
  config.DEBUG = config.DEBUG === 'true';
  config.DRY_RUN = config.DRY_RUN === 'true';
  config.KEEP_PULSE_ON_FAILURE = config.KEEP_PULSE_ON_FAILURE === 'true';
  if (config.RESET_HOUR !== undefined) {
    const rh = parseInt(config.RESET_HOUR);
    config.RESET_HOUR = Number.isFinite(rh) ? rh : undefined;
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

  if (!config.PROMPT_TEXT || typeof config.PROMPT_TEXT !== 'string') {
    errors.push('PROMPT_TEXT must be a non-empty string');
  }

  if (config.MAX_RETRIES < 1 || config.MAX_RETRIES > 10) {
    errors.push('MAX_RETRIES must be between 1 and 10');
  }

  if (config.RETRY_BACKOFF_MULTIPLIER < 1 || config.RETRY_BACKOFF_MULTIPLIER > 5) {
    errors.push('RETRY_BACKOFF_MULTIPLIER must be between 1 and 5');
  }

  if (config.MAX_BACKOFF_MINUTES < 1 || config.MAX_BACKOFF_MINUTES > 300) {
    errors.push('MAX_BACKOFF_MINUTES must be between 1 and 300');
  }

  const validLogLevels = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
  if (!validLogLevels.includes(config.LOG_LEVEL.toUpperCase())) {
    errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
  }

  if (config.RESET_HOUR !== undefined) {
    if (typeof config.RESET_HOUR !== 'number' || config.RESET_HOUR < 0 || config.RESET_HOUR > 23) {
      errors.push('RESET_HOUR must be an integer between 0 and 23');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return true;
}

export default {
  DEFAULT_CONFIG,
  loadConfig,
  validateConfig,
  parseEnvironmentVariables,
};