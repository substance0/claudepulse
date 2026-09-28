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

/** Discord markup for a date and time days away: full date, then countdown. */
function discordDateTime(date) {
  const epoch = Math.floor(date.getTime() / 1000);
  return `<t:${epoch}:F> (<t:${epoch}:R>)`;
}

/**
 * Whether a rejected pulse is blocked by the weekly limit. A reported limit
 * type decides; every seven_day* type is a weekly limit. The type is
 * undocumented, so without one a reset matching the weekly window's counts.
 * @param {Object} rateLimit
 * @returns {boolean}
 */
function isWeeklyRejection(rateLimit) {
  if (rateLimit.limitType) {
    return rateLimit.limitType.startsWith("seven_day");
  }
  const weeklyReset = rateLimit.weekly?.resetsAt;
  return (
    isValidDate(weeklyReset) &&
    isValidDate(rateLimit.resetsAt) &&
    weeklyReset.getTime() === rateLimit.resetsAt.getTime()
  );
}

/**
 * A line showing weekly usage, or "" when the weekly window is unknown.
 * @param {?{utilization: ?number, resetsAt: ?Date}} weekly
 * @returns {string}
 */
function weeklyUsageLine(weekly) {
  if (!Number.isFinite(weekly?.utilization) || !isValidDate(weekly.resetsAt)) {
    return "";
  }
  const percent = Math.round(weekly.utilization * 100);
  const epoch = Math.floor(weekly.resetsAt.getTime() / 1000);
  return `\nWeekly usage: ${percent}% · resets <t:${epoch}:R>`;
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
    if (isWeeklyRejection(rateLimit)) {
      return {
        title: "Weekly limit reached",
        description: `Pulsing resumes when the weekly limit lifts on ${discordDateTime(rateLimit.resetsAt)}.`,
        level: "WARN",
      };
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
    description: `The current window resets at ${discordTime(windowReset)}.${weeklyUsageLine(rateLimit.weekly)}`,
    level: "SUCCESS",
  };
}

/**
 * Create a notifier that posts window announcements to one webhook.
 * @param {string} webhookUrl - Discord webhook for window announcements
 * @param {{send?: Function, label?: string}} [options] - Discord sender
 *   (overridable in tests) and the account label prefixed to titles
 * @returns {{notify: (pulseResult: Object) => Promise<void>}}
 */
export function createWindowNotifier(
  webhookUrl,
  { send = sendDiscordAlert, label } = {},
) {
  return {
    async notify(pulseResult) {
      const payload = buildWindowNotification(pulseResult);
      if (!payload) {
        return;
      }
      const title = label ? `${label} · ${payload.title}` : payload.title;
      await send({ ...payload, title }, webhookUrl);
    },
  };
}
