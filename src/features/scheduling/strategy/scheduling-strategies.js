/**
 * Strategy pattern for different scheduling approaches
 */
import { DateUtility } from "../../../core/utils/DateUtility.js";

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
 * Reset signal strategy - handles explicit next run time from session limiting
 * Responds to Claude's rate limit messages with reset times
 */
class ResetSignalStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    if (!context.nextRunTime) {
      context.logger?.info(
        "strategy",
        "reset_signal: Not applicable - no session limit message received during current session",
      );
      return null;
    }

    context.logger?.info(
      "strategy",
      `reset_signal: Applicable - scheduling based on session limit reset time ${DateUtility.formatLocalIso(context.nextRunTime)}`,
    );

    return {
      time: context.alignToHourPlusTen(context.nextRunTime),
      strategy: "reset_signal",
    };
  }

  getStrategyName() {
    return "reset_signal";
  }

  getPriority() {
    return 1; // Highest priority
  }
}

/**
 * Scheduled start strategy - schedules first pulse only at configured hour
 * Only applies when no previous schedule exists (lastScheduledTime is null)
 */
class ScheduledStartStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    if (context.lastScheduledTime) {
      context.logger?.info(
        "strategy",
        "scheduled_start: Not applicable - only used for first pulse, already scheduled once",
      );
      return null; // Only for initial scheduling
    }

    const fromReset = context.nextFromInitialPulseHourPlusTen(context.now);
    if (!fromReset) {
      context.logger?.info(
        "strategy",
        "scheduled_start: Not applicable - no SCHEDULED_START_HOUR configured in environment",
      );
      return null;
    }

    context.logger?.info(
      "strategy",
      `scheduled_start: Applicable - scheduling first pulse at configured SCHEDULED_START_HOUR`,
    );

    return {
      time: fromReset,
      strategy: "scheduled_start",
    };
  }

  getStrategyName() {
    return "scheduled_start";
  }

  getPriority() {
    return 2;
  }
}

/**
 * Active cycle strategy - schedules based on current session expiry + 10 seconds
 * Detects active cycles and schedules pulse right after expiry
 */
class ActiveCycleStrategy extends SchedulingStrategy {
  async computeNextRunTime(context) {
    if (context.lastScheduledTime) {
      context.logger?.info(
        "strategy",
        "active_cycle: Not applicable - only used for initial scheduling, already scheduled once",
      );
      return null; // Only for initial scheduling
    }

    try {
      const expiry = context.sessionTracker.getSessionWindowExpiry();

      if (expiry && expiry > context.now) {
        context.logger?.info(
          "strategy",
          `active_cycle: Applicable - detected active session window expiring at ${DateUtility.formatLocalIso(expiry)}, scheduling 10 seconds after expiry`,
        );
        return {
          time: new Date(expiry.getTime() + 10 * 60 * 1000),
          strategy: "active_cycle",
        };
      }

      context.logger?.info(
        "strategy",
        "active_cycle: Not applicable - no cycle limit message found, cannot determine active cycle without reset time",
      );
    } catch (error) {
      context.logger?.info(
        "strategy",
        `active_cycle: Not applicable - unable to read Claude project logs (${error.message})`,
      );
    }

    return null;
  }

  getStrategyName() {
    return "active_cycle";
  }

  getPriority() {
    return 3;
  }
}

/**
 * Cruise strategy - maintains 5-hour intervals after cycle detection
 *
 * Only applies when:
 * - A cycle limit message has been detected (confirming cycle boundaries)
 * - A pulse was previously executed (lastScheduledTime exists)
 *
 * Uses 5-hour intervals aligned with known cycle boundaries to maintain
 * regular cadence between cycle resets.
 */
class CruiseStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    if (!context.lastScheduledTime) {
      context.logger?.info(
        "strategy",
        "cruise: Not applicable - no previous pulse executed yet (first run)",
      );
      return null;
    }

    // Only use cruise strategy if we have detected a cycle limit message
    const hasLimitMessage =
      context.sessionTracker?.latestCycleLimitReset != null;

    if (!hasLimitMessage) {
      context.logger?.info(
        "strategy",
        "cruise: Not applicable - no cycle detected yet, discovery mode still active",
      );
      return null;
    }

    const intervalHours = Math.round(
      context.fixedIntervalMs / (1000 * 60 * 60),
    );

    context.logger?.info(
      "strategy",
      `cruise: Applicable - scheduling ${intervalHours}h after last pulse (cycle detected)`,
    );

    return {
      time: new Date(
        context.lastScheduledTime.getTime() + context.fixedIntervalMs,
      ),
      strategy: "cruise",
    };
  }

  getStrategyName() {
    return "cruise";
  }

  getPriority() {
    return 4;
  }
}

/**
 * Discovery strategy - send hourly pulses to discover cycle boundaries
 * Used when no cycle limit information is available yet
 */
class DiscoveryStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    // This is always available as a fallback
    context.logger?.info(
      "strategy",
      "discovery: Applicable - no cycle information available, using hourly pulse strategy",
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
    return 99; // Very low priority - fallback when no cycle info available
  }
}

/**
 * Scheduler that manages and applies scheduling strategies
 */
class SchedulingStrategyManager {
  constructor() {
    this.strategies = [
      new ResetSignalStrategy(),
      new ScheduledStartStrategy(),
      new ActiveCycleStrategy(),
      new CruiseStrategy(),
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
  ResetSignalStrategy,
  ScheduledStartStrategy,
  ActiveCycleStrategy,
  CruiseStrategy,
  DiscoveryStrategy,
  SchedulingStrategyManager,
};
