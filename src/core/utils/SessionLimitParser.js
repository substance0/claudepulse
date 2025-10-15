/**
 * Parser for Claude cycle limit messages.
 * Supports messages such as:
 *  - "5-hour limit reached ∙ resets 2pm"
 *  - "Session limit reached ∙ resets 9pm"
 * Allows optional override regex via env SESSION_LIMIT_TIME_REGEX (capture time in group 1).
 */
export class SessionLimitParser {
  constructor(formatLocalIso = null) {
    this.formatLocalIso = formatLocalIso;
    this.extraTimeRegex = null;
    try {
      const envRegex = process.env.SESSION_LIMIT_TIME_REGEX;
      if (envRegex) {
        this.extraTimeRegex = new RegExp(envRegex, "i");
      }
    } catch {}
  }

  _parseTimeString(timeStr, referenceTime = null) {
    if (!timeStr) return null;
    const normalized = String(timeStr).trim().toLowerCase();
    const refTime = referenceTime ? new Date(referenceTime) : new Date();

    // Match HH:MM am/pm, HH am/pm
    let match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = match[2] ? parseInt(match[2], 10) : 0;
      if (
        Number.isNaN(hours) ||
        Number.isNaN(minutes) ||
        hours < 1 ||
        hours > 12 ||
        minutes < 0 ||
        minutes > 59
      ) {
        return null;
      }
      let hours24 = hours % 12;
      if (match[3].toLowerCase() === "pm") hours24 += 12;
      const reset = new Date(refTime);
      reset.setHours(hours24, minutes, 0, 0);
      if (reset <= refTime) reset.setDate(reset.getDate() + 1);
      return reset;
    }

    // Match 24-hour HH:MM
    match = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const reset = new Date(refTime);
      reset.setHours(hours, minutes, 0, 0);
      if (reset <= refTime) reset.setDate(reset.getDate() + 1);
      return reset;
    }

    return null;
  }

  /**
   * Parse Claude session limit message and extract reset time
   * @param {string} errorText - The error message text
   * @param {Object} logger - Optional logger for debugging
   * @param {Date|string} referenceTime - Reference time for parsing relative times (default: now)
   * @returns {Object|null} Session limit info or null if not a session limit
   */
  parseSessionLimit(errorText, logger = null, referenceTime = null) {
    if (!errorText) return null;

    const text = String(errorText);

    // Skip auth errors
    if (text.includes("Invalid API key · Please run /login")) return null;

    // Basic validation to ensure this is a limit message
    const looksLikeLimit = /(session|rate|hour)\s+limit\s+reached/i.test(text);
    if (!looksLikeLimit) return null;

    // Extract time using built-in pattern: "resets <time>" (bullet optional)
    let timeCandidate = null;
    const resetMatch = text.match(
      /resets(?:\s+at)?\s+([0-2]?\d(?::[0-5]\d)?\s*(?:am|pm)?)/i,
    );
    if (resetMatch) {
      timeCandidate = resetMatch[1];
    }

    // Custom regex override (must capture time in group 1)
    if (!timeCandidate && this.extraTimeRegex) {
      const customMatch = text.match(this.extraTimeRegex);
      if (customMatch && customMatch[1]) {
        timeCandidate = customMatch[1];
      }
    }

    const resetTime = this._parseTimeString(timeCandidate, referenceTime);
    if (!resetTime) return null;

    if (logger && this.formatLocalIso) {
      try {
        const localIso = this.formatLocalIso(resetTime);
        logger.debug("sessionlimit", "Parsed Claude session limit reset time", {
          originalText: text,
          resetAt: resetTime.toISOString(),
          localIso,
          method: "claude_limit",
        });
      } catch {}
    }

    return {
      method: "claude_limit",
      resetAt: resetTime.toISOString(),
      resetTimeRaw: errorText,
    };
  }
}

export default SessionLimitParser;
