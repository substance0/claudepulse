/**
 * Strategy pattern for different scheduling approaches
 */
import { DateUtility } from "../../../core/utils/DateUtility.js";

/**
 * Delay after a window resets before pulsing, so the pulse lands in the new
 * window rather than racing its boundary.
 */
const WINDOW_RESET_BUFFER_MS = 10 * 1000;

/**
 * Compute when to pulse next from the rate-limit state reported by a pulse.
 *
 * An allowed pulse means a window is open, so the next pulse should open the
 * following one, just after the 5-hour reset. A rejected pulse means requests
 * are refused until the blocking window resets, which may be the weekly one;
 * pulsing earlier would only be rejected again.
 *
 * The reset is not rounded to the hour: windows do not start on the hour.
 * @param {{status: string, resetsAt: Date|null, fiveHourResetsAt: Date|null}|null} rateLimit
 * @param {Date} now - Current time
 * @returns {Date|null} Next pulse time, or null when it cannot be determined
 */
export function nextPulseFromRateLimit(rateLimit, now) {
  if (!rateLimit) {
    return null;
  }

  const reset =
    rateLimit.status === "rejected"
      ? rateLimit.resetsAt
      : rateLimit.fiveHourResetsAt;

  if (!reset || reset.getTime() <= now.getTime()) {
    return null;
  }

  return new Date(reset.getTime() + WINDOW_RESET_BUFFER_MS);
}

/**
 * Base class for scheduling strategies
 */
class SchedulingStrategy {
  /**
   * Compute the next run time based on this strategy
   * @param {Object} context - Scheduling context object
   * @returns {Object|null} Scheduling result with { time: Date, strategy: string } or null if not applicable
   */
  computeNextRunTime(context) {
    throw new Error(
      "computeNextRunTime() method must be implemented by subclasses",
    );
  }

  /**
   * Get the strategy name for logging
   * @returns {string} Strategy name
   */
  getStrategyName() {
    throw new Error(
      "getStrategyName() method must be implemented by subclasses",
    );
  }

  /**
   * Get the priority of this strategy (lower numbers = higher priority)
   * @returns {number} Priority value
   */
  getPriority() {
    return 100; // Default low priority
  }
}

/**
 * Scheduled start strategy - schedules the first pulse at a configured hour.
 * An explicit SCHEDULED_START_HOUR is user intent, so it outranks the window,
 * but only for the first scheduled pulse; every later pulse follows the window.
 */
class ScheduledStartStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    if (context.lastScheduledTime) {
      context.logger?.info(
        "strategy",
        "scheduled_start: Not applicable - only used for first pulse, already scheduled once",
      );
      return null;
    }

    const configuredStart = context.nextFromInitialPulseHourPlusTen(context.now);
    if (!configuredStart) {
      context.logger?.info(
        "strategy",
        "scheduled_start: Not applicable - no SCHEDULED_START_HOUR configured in environment",
      );
      return null;
    }

    context.logger?.info(
      "strategy",
      "scheduled_start: Applicable - scheduling first pulse at configured SCHEDULED_START_HOUR",
    );

    return {
      time: configuredStart,
      strategy: "scheduled_start",
    };
  }

  getStrategyName() {
    return "scheduled_start";
  }

  getPriority() {
    return 1;
  }
}

/**
 * Window reset strategy - pulses when the current rate-limit window resets,
 * using the rate-limit state the last pulse reported.
 */
class WindowResetStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    const time = nextPulseFromRateLimit(context.rateLimit, context.now);

    if (!time) {
      context.logger?.info(
        "strategy",
        "window_reset: Not applicable - no upcoming window reset reported by the last pulse",
      );
      return null;
    }

    context.logger?.info(
      "strategy",
      `window_reset: Applicable - ${context.rateLimit.status} pulse, window resets ${DateUtility.formatLocalIso(time)}`,
    );

    return {
      time,
      strategy: "window_reset",
    };
  }

  getStrategyName() {
    return "window_reset";
  }

  getPriority() {
    return 2;
  }
}

/**
 * Discovery strategy - pulses on the next hour when no window is known, for
 * example after a pulse that failed before reporting its rate-limit state.
 * A single successful pulse is enough to learn the window.
 */
class DiscoveryStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    context.logger?.info(
      "strategy",
      "discovery: Applicable - no window known, pulsing on the next hour to learn it",
    );

    return {
      time: context.nextHourPlusTen(),
      strategy: "discovery",
    };
  }

  getStrategyName() {
    return "discovery";
  }

  getPriority() {
    return 99; // Fallback when no window is known
  }
}

/**
 * Scheduler that manages and applies scheduling strategies
 */
class SchedulingStrategyManager {
  constructor() {
    this.strategies = [
      new ScheduledStartStrategy(),
      new WindowResetStrategy(),
      new DiscoveryStrategy(),
    ].sort((a, b) => a.getPriority() - b.getPriority());
  }

  /**
   * Compute next run time using the first applicable strategy
   * @param {Object} context - Scheduling context
   * @returns {Object} Scheduling result with { time: Date, strategy: string }
   */
  async computeNextRunTime(context) {
    context.logger?.info(
      "strategy",
      "Evaluating scheduling strategies in priority order",
    );

    for (const strategy of this.strategies) {
      const strategyName = strategy.getStrategyName();
      try {
        const result = await strategy.computeNextRunTime(context);
        if (result) {
          context.logger?.info(
            "strategy",
            `✓ Strategy selected: ${strategyName} → scheduling next pulse at ${DateUtility.formatLocalIso(result.time)}`,
          );
          return result;
        }
      } catch (error) {
        context.logger?.error("strategy", `Error in strategy ${strategyName}`, {
          error: error.message,
          stack: error.stack,
        });
      }
    }

    // This should never happen since DiscoveryStrategy is always available
    throw new Error("No scheduling strategy could compute next run time");
  }

  /**
   * Get all available strategies
   * @returns {Array} Array of strategy instances
   */
  getStrategies() {
    return [...this.strategies];
  }

  /**
   * Add a custom strategy
   * @param {SchedulingStrategy} strategy - Strategy instance
   */
  addStrategy(strategy) {
    if (!(strategy instanceof SchedulingStrategy)) {
      throw new Error("Strategy must extend SchedulingStrategy");
    }
    this.strategies.push(strategy);
    this.strategies.sort((a, b) => a.getPriority() - b.getPriority());
  }
}

export {
  SchedulingStrategy,
  ScheduledStartStrategy,
  WindowResetStrategy,
  DiscoveryStrategy,
  SchedulingStrategyManager,
};
