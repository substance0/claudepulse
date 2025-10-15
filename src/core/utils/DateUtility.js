/**
 * Date Utility for Claude Session Tracking
 * Provides timestamp parsing, formatting, and validation
 * UTC-based implementation for consistency across environments
 */
export class DateUtility {
  /**
   * Format a Date (or date-like) as ISO 8601 with local timezone offset.
   * Example: 2025-09-26T14:00:00.000+02:00
   * @param {Date|string|number} dateInput - Date object, date string, or timestamp
   * @returns {string} Formatted date string in local ISO format
   */
  static formatLocalIso(dateInput) {
    const d =
      dateInput instanceof Date
        ? new Date(dateInput.getTime())
        : new Date(dateInput);
    if (isNaN(d.getTime())) return "Invalid Date";

    const pad = (n, w = 2) => String(n).padStart(w, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    const millis = pad(d.getMilliseconds(), 3);

    const offsetMinutes = -d.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const oh = pad(Math.floor(Math.abs(offsetMinutes) / 60));
    const om = pad(Math.abs(offsetMinutes) % 60);

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${oh}:${om}`;
  }
  constructor(options = {}) {
    // No dependencies - pure utility class
  }

  /**
   * Parse timestamp from Claude JSONL files with proper timezone handling
   * @param {string} timestampStr - Timestamp string from JSONL
   * @returns {Date|null} Parsed date in UTC or null if invalid
   */
  parseTimestamp(timestampStr) {
    if (!timestampStr) return null;

    try {
      // Detect timestamp format and handle timezone properly
      const normalizedTimestamp = this._normalizeTimestamp(timestampStr);
      const date = new Date(normalizedTimestamp);

      if (isNaN(date.getTime())) {
        // Invalid timestamp - return null
        return null;
      }

      return date;
    } catch (error) {
      // Parse error - return null
      return null;
    }
  }

  /**
   * Normalize timestamp to ensure proper timezone interpretation
   * @param {string} timestamp - Raw timestamp string
   * @returns {string} Normalized timestamp string
   * @private
   */
  _normalizeTimestamp(timestamp) {
    // Handle different timestamp formats from Claude JSONL files

    // Format 1: Already has timezone info (keep as-is)
    if (timestamp.includes("Z") || timestamp.match(/[+-]\d{2}:\d{2}$/)) {
      return timestamp;
    }

    // Format 2: ISO format without timezone - assume UTC
    if (timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?$/)) {
      // Assuming UTC for ISO timestamp without timezone
      return timestamp + "Z";
    }

    // Format 3: Date-only format - assume UTC midnight
    if (timestamp.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Assuming UTC midnight for date-only timestamp
      return timestamp + "T00:00:00.000Z";
    }

    // Format 4: Unix timestamp (seconds or milliseconds)
    if (/^\d+$/.test(timestamp)) {
      const num = parseInt(timestamp, 10);
      // Assume seconds if < 10^10, milliseconds if >= 10^10
      const isMilliseconds = num >= 10000000000;
      // Detected unix timestamp
      return new Date(isMilliseconds ? num : num * 1000).toISOString();
    }

    // Format 5: Unknown format - pass through and let Date constructor handle
    // Unknown timestamp format - passing through
    return timestamp;
  }

  /**
   * Detect the format of a timestamp string for logging
   * @param {string} timestamp - Timestamp string
   * @returns {string} Format description
   * @private
   */
  _detectTimestampFormat(timestamp) {
    if (timestamp.includes("Z")) return "ISO_UTC";
    if (timestamp.match(/[+-]\d{2}:\d{2}$/)) return "ISO_WITH_OFFSET";
    if (timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?$/))
      return "ISO_NO_TIMEZONE";
    if (timestamp.match(/^\d{4}-\d{2}-\d{2}$/)) return "DATE_ONLY";
    if (/^\d+$/.test(timestamp)) return "UNIX_TIMESTAMP";
    return "UNKNOWN";
  }

  /**
   * Ensure datetime is UTC (pass-through since we only work with UTC)
   */
  ensureUTC(date) {
    if (!date) return null;
    if (date instanceof Date) return date;
    return this.parseTimestamp(date);
  }

  /**
   * Get current time in UTC
   */
  now() {
    return new Date();
  }

  /**
   * Calculate time difference in milliseconds
   */
  getTimeDifference(endTime, startTime) {
    const end = this.ensureUTC(endTime);
    const start = this.ensureUTC(startTime);
    if (!end || !start) return null;
    return end.getTime() - start.getTime();
  }

  /**
   * Add time to a date
   */
  addTime(date, milliseconds) {
    const baseDate = this.ensureUTC(date);
    if (!baseDate) return null;
    return new Date(baseDate.getTime() + milliseconds);
  }

  /**
   * Format timestamp for logging
   */
  formatForLogging(date) {
    if (!date) return null;
    const utcDate = this.ensureUTC(date);
    return {
      utc: utcDate.toISOString(),
      timezone: "UTC",
    };
  }

  /**
   * Validate timestamp is within reasonable range
   */
  validateTimestamp(date) {
    const utcDate = this.ensureUTC(date);
    if (!utcDate) return false;

    const now = this.now();
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const oneDayFuture = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return utcDate >= oneYearAgo && utcDate <= oneDayFuture;
  }

  /**
   * Get status information including timezone handling details
   */
  getStatus() {
    return {
      timezone: "UTC",
      currentTime: this.formatForLogging(this.now()),
      implementation: "UTC-only with smart timestamp normalization",
      supportedFormats: [
        "ISO_UTC (2025-09-26T14:30:00.000Z)",
        "ISO_WITH_OFFSET (2025-09-26T14:30:00+02:00)",
        "ISO_NO_TIMEZONE (2025-09-26T14:30:00 -> assumes UTC)",
        "DATE_ONLY (2025-09-26 -> assumes UTC midnight)",
        "UNIX_TIMESTAMP (1632662400 or 1632662400000)",
      ],
    };
  }
}

export default DateUtility;
