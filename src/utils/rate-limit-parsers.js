/**
 * Parser for Claude 5-hour rate limit messages
 * Handles format: "5-hour limit reached ∙ resets 2pm"
 */
class ClaudeRateLimitParser {
  constructor(formatLocalIso = null) {
    this.formatLocalIso = formatLocalIso;
  }

  /**
   * Parse Claude rate limit message and extract reset time
   * @param {string} errorText - The error message text
   * @param {Object} logger - Optional logger for debugging
   * @returns {Object|null} Rate limit info or null if not a rate limit
   */
  parse(errorText, logger = null) {
    if (!errorText) return null;

    const text = String(errorText);

    // Skip auth errors
    if (text.includes("Invalid API key · Please run /login")) return null;

    // Look for the specific Claude rate limit format: "5-hour limit reached ∙ resets 2pm"
    const match = text.match(/5-hour limit reached.*?resets\s+(\d{1,2})pm/i);
    if (!match) return null;

    const resetHour = parseInt(match[1], 10);
    if (isNaN(resetHour) || resetHour < 1 || resetHour > 12) return null;

    // Convert to 24-hour format (assuming PM)
    const hours24 = resetHour === 12 ? 12 : resetHour + 12;

    // Create reset time for today
    const now = new Date();
    const resetTime = new Date();
    resetTime.setHours(hours24, 0, 0, 0);

    // If reset time has passed today, schedule for tomorrow
    if (resetTime <= now) {
      resetTime.setDate(resetTime.getDate() + 1);
    }

    if (logger && this.formatLocalIso) {
      try {
        const localIso = this.formatLocalIso(resetTime);
        logger.debug("ratelimit", "Parsed Claude rate limit reset time", {
          originalText: text,
          resetHour: resetHour + "pm",
          resetAt: resetTime.toISOString(),
          localIso
        });
      } catch {}
    }

    return {
      method: "claude_limit",
      resetAt: resetTime.toISOString(),
      resetHour: resetHour + "pm",
      resetTimeRaw: errorText
    };
  }
}

/**
 * Factory for Claude rate limit parsing
 */
class RateLimitParserFactory {
  constructor(formatLocalIso = null) {
    this.parser = new ClaudeRateLimitParser(formatLocalIso);
  }

  /**
   * Parse Claude rate limit information
   * @param {string} errorText - The error message text
   * @param {Object} logger - Optional logger for debugging
   * @returns {Object|null} Parsed rate limit information or null
   */
  parseRateLimit(errorText, logger = null) {
    return this.parser.parse(errorText, logger);
  }
}

export {
  ClaudeRateLimitParser,
  RateLimitParserFactory
};