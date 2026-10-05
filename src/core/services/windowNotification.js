/**
 * Window Notifications
 * Announces on Discord when the current usage window resets, after each
 * pulse. Posts to a webhook of its own so the channel can be muted
 * independently of error alerts.
 *
 * A pulse that ran on paid extra usage is announced in place of the limit
 * message, and can also be posted to the errors webhook, which is not meant
 * to be muted.
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
 * Format a date days away as Discord timestamp markup: the full date and
 * time in each reader's own time zone, then a live relative countdown.
 * @param {Date} date
 * @returns {string}
 */
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
export function isWeeklyRejection(rateLimit) {
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
 * Which limit refused a pulse: the weekly one or the 5-hour window.
 * @param {?{status: string}} rateLimit
 * @returns {?("weekly"|"5-hour")} Null unless the pulse's limit was reached
 */
export function blockingLimit(rateLimit) {
  if (rateLimit?.status !== "rejected") {
    return null;
  }
  return isWeeklyRejection(rateLimit) ? "weekly" : "5-hour";
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
 * Build the Discord payload for a pulse that ran on paid extra usage, or null
 * for any other pulse. A pulse that failed is not billed, so it is not
 * announced.
 * @param {{success: boolean, rateLimit: ?{status: string, resetsAt: ?Date, overage: ?{using: ?boolean}}}} pulseResult
 * @returns {?{title: string, description: string, level: string}}
 */
export function buildExtraUsageNotification(pulseResult) {
  const rateLimit = pulseResult?.rateLimit;
  if (!pulseResult?.success || rateLimit?.overage?.using !== true) {
    return null;
  }

  const limit = blockingLimit(rateLimit);
  const lifts =
    limit && isValidDate(rateLimit.resetsAt)
      ? ` The ${limit} limit is reached and lifts ${
          limit === "weekly"
            ? discordDateTime(rateLimit.resetsAt)
            : discordTime(rateLimit.resetsAt)
        }.`
      : "";

  return {
    title: "Extra usage in use",
    description: `This pulse ran on paid extra usage.${lifts}`,
    level: "WARN",
  };
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

  // The pulse ran, on credits: the limit message would wrongly say that
  // pulsing resumes when the limit lifts.
  const extraUsage = buildExtraUsageNotification(pulseResult);
  if (extraUsage) {
    return extraUsage;
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

  // resetsAt names the current window only when the event is about the
  // 5-hour window, or does not say which window it is about.
  const resetsAtIsCurrentWindow =
    !rateLimit.limitType || rateLimit.limitType === "five_hour";
  const windowReset =
    rateLimit.fiveHourResetsAt ??
    (resetsAtIsCurrentWindow ? rateLimit.resetsAt : null);
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
 * Create a notifier that posts what `build` makes of a pulse to one webhook.
 * @param {(pulseResult: Object) => ?Object} build - Payload builder
 * @param {string} webhookUrl - Discord webhook
 * @param {{send?: Function, label?: string}} [options] - Discord sender
 *   (overridable in tests) and the account label prefixed to titles
 * @returns {{notify: (pulseResult: Object) => Promise<void>}}
 */
function createNotifier(
  build,
  webhookUrl,
  { send = sendDiscordAlert, label } = {},
) {
  return {
    async notify(pulseResult) {
      const payload = build(pulseResult);
      if (!payload) {
        return;
      }
      const title = label ? `${label} · ${payload.title}` : payload.title;
      await send({ ...payload, title }, webhookUrl);
    },
  };
}

/**
 * Create a notifier that posts window announcements to one webhook.
 * @param {string} webhookUrl - Discord webhook for window announcements
 * @param {{send?: Function, label?: string}} [options]
 * @returns {{notify: (pulseResult: Object) => Promise<void>}}
 */
export function createWindowNotifier(webhookUrl, options) {
  return createNotifier(buildWindowNotification, webhookUrl, options);
}

/**
 * Create an alerter that posts only pulses that ran on paid extra usage, to
 * the errors webhook.
 * @param {string} webhookUrl - Discord webhook for errors and alerts
 * @param {{send?: Function, label?: string}} [options]
 * @returns {{notify: (pulseResult: Object) => Promise<void>}}
 */
export function createExtraUsageAlerter(webhookUrl, options) {
  return createNotifier(buildExtraUsageNotification, webhookUrl, options);
}
