/**
 * Window Notifications
 * Announces on Discord when the current usage window resets, after each
 * pulse. Posts to a webhook of its own so the channel can be muted
 * independently of error alerts.
 */

import { sendDiscordAlert } from "./notificationService.js";

/**
 * Format a date as Discord timestamp markup, which each reader sees in their
 * own time zone: short time, then a live relative countdown.
 * @param {Date} date
 * @returns {string}
 */
function discordTime(date) {
  const epoch = Math.floor(date.getTime() / 1000);
  return `<t:${epoch}:t> (<t:${epoch}:R>)`;
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Build the Discord payload announcing a pulse's window, or null when the
 * pulse reported no usable window.
 * @param {{success: boolean, rateLimit: ?{status: string, resetsAt: ?Date, fiveHourResetsAt: ?Date}}} pulseResult
 * @returns {?{title: string, description: string, level: string}}
 */
export function buildWindowNotification(pulseResult) {
  const rateLimit = pulseResult?.rateLimit;
  if (!rateLimit) {
    return null;
  }

  if (rateLimit.status === "rejected") {
    if (!isValidDate(rateLimit.resetsAt)) {
      return null;
    }
    return {
      title: "Usage limit reached",
      description: `Pulsing resumes when the limit lifts at ${discordTime(rateLimit.resetsAt)}.`,
      level: "WARN",
    };
  }

  const windowReset = rateLimit.fiveHourResetsAt ?? rateLimit.resetsAt;
  if (!pulseResult.success || !isValidDate(windowReset)) {
    return null;
  }
  return {
    title: "Window open",
    description: `The current window resets at ${discordTime(windowReset)}.`,
    level: "SUCCESS",
  };
}

/**
 * Create a notifier that posts window announcements to one webhook.
 * @param {string} webhookUrl - Discord webhook for window announcements
 * @param {{send?: Function}} [deps] - Override the Discord sender (tests)
 * @returns {{notify: (pulseResult: Object) => Promise<void>}}
 */
export function createWindowNotifier(webhookUrl, { send = sendDiscordAlert } = {}) {
  return {
    async notify(pulseResult) {
      const payload = buildWindowNotification(pulseResult);
      if (payload) {
        await send(payload, webhookUrl);
      }
    },
  };
}
