/**
 * Token Expiry Warnings
 * The token from `claude setup-token` lasts a year and ClaudePulse cannot
 * read its expiry, so the operator records it in TOKEN_EXPIRES_AT. Warnings
 * go out as expiry approaches, once per threshold.
 */

import { sendDiscordAlert } from "./notificationService.js";
import { DateUtility } from "../utils/DateUtility.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days left at which a warning is sent; 0 means expired. */
export const WARNING_THRESHOLDS_DAYS = [14, 7, 1, 0];

/**
 * Parse YYYY-MM-DD as local midnight at the start of that day.
 * @param {string} text
 * @returns {Date|null} Null for a malformed or non-existent date
 */
export function parseExpiryDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? "");
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  const exists =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
  return exists ? date : null;
}

/**
 * Whole days left before expiry, counted in local calendar days so a clock
 * change does not shift a warning by an hour; the rest of today counts as a
 * full day.
 * @param {Date} expiresAt - Local midnight at the start of the expiry day
 * @param {Date} now
 * @returns {number} 0 or less once expired
 */
export function daysLeft(expiresAt, now) {
  const calendarDay = (date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((calendarDay(expiresAt) - calendarDay(now)) / DAY_MS);
}

/**
 * The warning threshold that applies with this many days left.
 * @param {number} days
 * @returns {number|null} Null when no warning applies yet
 */
export function dueThreshold(days) {
  if (days <= 0) {
    return 0;
  }
  const above = WARNING_THRESHOLDS_DAYS.filter((t) => t > 0 && t >= days);
  return above.length > 0 ? Math.min(...above) : null;
}

/**
 * The Discord payload warning about expiry.
 * @param {number} days - Days left, 0 or less once expired
 * @param {Date} expiresAt
 * @param {string} [label] - Account label prefixed to the title
 * @returns {{title: string, description: string, level: string}}
 */
export function buildExpiryWarning(days, expiresAt, label) {
  const epoch = Math.floor(expiresAt.getTime() / 1000);
  const renew =
    "Run `claude setup-token`, replace CLAUDE_CODE_OAUTH_TOKEN in claudepulse.env, update TOKEN_EXPIRES_AT and recreate the container.";
  const title =
    days <= 0
      ? "Claude token expired"
      : `Claude token expires in ${days} ${days === 1 ? "day" : "days"}`;

  return {
    title: label ? `${label} · ${title}` : title,
    description:
      days <= 0
        ? `Pulses fail until the token is renewed. ${renew}`
        : `It expires on <t:${epoch}:D>. ${renew}`,
    level: days <= 0 ? "ERROR" : "WARN",
  };
}

/**
 * Create a monitor that delivers each due warning once. A warning Discord did
 * not accept is retried at the next check; each warning is logged only once.
 * @param {Object} options
 * @param {Date} options.expiresAt
 * @param {string|undefined} options.webhookUrl - Discord webhook; log only when unset
 * @param {string} [options.label] - Account label
 * @param {{warn: Function}} options.logger
 * @param {(payload: Object, url: string) => Promise<boolean>} [options.send] -
 *   Discord sender reporting delivery (overridable in tests)
 * @param {() => Date} [options.now] - Clock (overridable in tests)
 * @returns {{check: () => Promise<void>}}
 */
export function createTokenExpiryMonitor({
  expiresAt,
  webhookUrl,
  label,
  logger,
  send = sendDiscordAlert,
  now = () => new Date(),
}) {
  const loggedThresholds = new Set();
  const deliveredThresholds = new Set();

  return {
    async check() {
      const days = daysLeft(expiresAt, now());
      const threshold = dueThreshold(days);
      if (threshold === null || deliveredThresholds.has(threshold)) {
        return;
      }

      const warning = buildExpiryWarning(days, expiresAt, label);
      if (!loggedThresholds.has(threshold)) {
        loggedThresholds.add(threshold);
        // Logged at warn even once expired: logger.error posts to the error
        // webhook itself, which would duplicate the alert sent below. The
        // title is built without the label, which the logger already shows.
        logger.warn("token", buildExpiryWarning(days, expiresAt).title, {
          expiresAt: DateUtility.formatLocalIso(expiresAt),
          daysLeft: days,
        });
      }

      // Without a webhook the log is the only channel, and it is done.
      if (!webhookUrl || (await send(warning, webhookUrl))) {
        deliveredThresholds.add(threshold);
      }
    },
  };
}
