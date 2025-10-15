/**
 * API Client Service
 * High-level client for Claude API interactions
 * Handles retry logic, timeouts, and business logic coordination
 */
export class ApiClient {
  /**
   * Create ApiClient instance
   * @param {Object} options - Configuration options
   * @param {Object} options.sdkAdapter - Claude SDK adapter instance
   * @param {Object} options.logger - Logger instance
   * @param {number} [options.maxRetries=3] - Maximum retry attempts
   * @param {number} [options.retryBackoffMultiplier=2] - Backoff multiplier for retries
   * @param {number} [options.maxBackoffMinutes=30] - Maximum backoff time in minutes
   */
  constructor({
    sdkAdapter,
    logger,
    maxRetries = 3,
    retryBackoffMultiplier = 2,
    maxBackoffMinutes = 30,
  }) {
    if (!sdkAdapter) {
      throw new Error("ApiClient requires sdkAdapter dependency");
    }
    if (!logger) {
      throw new Error("ApiClient requires logger dependency");
    }

    this.sdkAdapter = sdkAdapter;
    this.logger = logger;
    this.maxRetries = maxRetries;
    this.retryBackoffMultiplier = retryBackoffMultiplier;
    this.maxBackoffMinutes = maxBackoffMinutes;
    this.requestId = 0;
  }

  /**
   * Send message to Claude with retry logic
   * @param {string} prompt - The prompt to send
   * @param {Object} opts - Options
   * @param {boolean} [opts.silent] - Suppress logging
   * @param {number} [opts.maxRetries] - Override default max retries
   * @returns {Promise<Object>} Response with success flag and data
   */
  async sendMessage(prompt, opts = {}) {
    // Validate input
    if (typeof prompt !== "string") {
      throw new TypeError("Prompt must be a string");
    }

    if (prompt.trim().length === 0) {
      return {
        success: false,
        error: "Prompt cannot be empty",
        exitCode: -1,
      };
    }

    const MAX_PROMPT_LENGTH = 100000;
    if (prompt.length > MAX_PROMPT_LENGTH) {
      this.logger.warn("api-client", "Prompt exceeds recommended length", {
        promptLength: prompt.length,
        maxLength: MAX_PROMPT_LENGTH,
      });
    }

    const requestId = ++this.requestId;
    const silent = !!opts.silent;
    const maxRetries =
      opts.maxRetries !== undefined ? opts.maxRetries : this.maxRetries;

    if (!silent) {
      this.logger.debug("api-client", "Sending message to Claude", {
        requestId,
        promptLength: prompt.length,
      });
    }

    // Execute with retry logic
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Execute query via SDK adapter
        const response = await this.sdkAdapter.executeQuery(prompt, opts);

        // Parse response
        const parsed = await this.sdkAdapter.parseSdkResponse(
          response,
          requestId,
          opts,
        );

        // If session limit reached, return immediately (don't retry)
        if (parsed.sessionLimitReached) {
          return parsed;
        }

        // If successful, return
        if (parsed.success) {
          if (attempt > 0 && !silent) {
            this.logger.info("api-client", "Retry successful", {
              requestId,
              attempt,
            });
          }
          return parsed;
        }

        // If this is not a transient error, return immediately (don't retry)
        if (!this._isTransientError(parsed)) {
          return parsed;
        }

        // Store error for potential retry
        lastError = parsed;

        // If we have retries left, wait and retry
        if (attempt < maxRetries) {
          const backoffMs = this._calculateBackoff(attempt);
          if (!silent) {
            this.logger.warn("api-client", "Transient error, will retry", {
              requestId,
              attempt: attempt + 1,
              maxRetries,
              backoffMs,
              error: parsed.error,
            });
          }
          await this._sleep(backoffMs);
        }
      } catch (error) {
        if (!silent) {
          this.logger.error(
            "api-client",
            "Send message exception",
            {
              requestId,
              attempt,
              error: error.message,
            },
            {
              component: "ApiClient",
              errorCode: "SEND_MESSAGE_EXCEPTION",
            },
          );
        }

        lastError = {
          success: false,
          error: error.message,
          exitCode: -1,
        };

        // Retry on exceptions if retries remain
        if (attempt < maxRetries) {
          const backoffMs = this._calculateBackoff(attempt);
          if (!silent) {
            this.logger.warn("api-client", "Exception occurred, will retry", {
              requestId,
              attempt: attempt + 1,
              maxRetries,
              backoffMs,
            });
          }
          await this._sleep(backoffMs);
        }
      }
    }

    // All retries exhausted
    if (!silent) {
      this.logger.error(
        "api-client",
        "All retry attempts exhausted",
        {
          requestId,
          maxRetries,
          lastError: lastError?.error,
        },
        {
          component: "ApiClient",
          errorCode: "RETRY_EXHAUSTED",
        },
      );
    }

    return (
      lastError || {
        success: false,
        error: "All retry attempts failed",
        exitCode: -1,
      }
    );
  }

  /**
   * Send pulse message
   * @param {string} message - Pulse message text
   * @returns {Promise<Object>} Response with success flag and data
   */
  async pulse(message = "pulse check") {
    this.logger.info("pulse", "Sending pulse message", { message });
    const result = await this.sendMessage(message);
    this.logger.info("pulse", "Pulse completed", {
      success: result.success,
      error: result.error,
    });
    return result;
  }

  /**
   * Determine if an error is transient (worth retrying)
   * @param {Object} parsed - Parsed response
   * @returns {boolean} True if error is transient
   */
  _isTransientError(parsed) {
    if (parsed.sessionLimitReached) {
      return false; // Don't retry session limits
    }

    // Network/timeout errors are transient
    if (parsed.error) {
      const errorLower = parsed.error.toLowerCase();
      if (
        errorLower.includes("timeout") ||
        errorLower.includes("network") ||
        errorLower.includes("econnreset") ||
        errorLower.includes("enotfound") ||
        errorLower.includes("etimedout")
      ) {
        return true;
      }
    }

    // 5xx errors are transient
    if (parsed.exitCode >= 500 && parsed.exitCode < 600) {
      return true;
    }

    // Default: not transient
    return false;
  }

  /**
   * Calculate exponential backoff delay
   * @param {number} attempt - Current attempt number (0-indexed)
   * @returns {number} Backoff delay in milliseconds
   */
  _calculateBackoff(attempt) {
    // Exponential backoff: baseDelay * (multiplier ^ attempt)
    const baseDelayMs = 1000; // 1 second
    const delayMs =
      baseDelayMs * Math.pow(this.retryBackoffMultiplier, attempt);
    const maxDelayMs = this.maxBackoffMinutes * 60 * 1000;
    return Math.min(delayMs, maxDelayMs);
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default ApiClient;
