/**
 * Strategy pattern for different scheduling approaches
 */

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
    throw new Error("computeNextRunTime() method must be implemented by subclasses");
  }

  /**
   * Get the strategy name for logging
   * @returns {string} Strategy name
   */
  getStrategyName() {
    throw new Error("getStrategyName() method must be implemented by subclasses");
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
 * External signal strategy - handles explicit next run time from rate limiting
 */
class ExternalSignalStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    if (!context.nextRunTime) return null;

    return {
      time: context.alignToHourPlusTen(context.nextRunTime),
      strategy: "from_external_signal"
    };
  }

  getStrategyName() {
    return "external_signal";
  }

  getPriority() {
    return 1; // Highest priority
  }
}

/**
 * Reset hour anchor strategy - schedules based on configured reset hour
 */
class ResetHourAnchorStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    if (context.lastScheduledTime) return null; // Only for initial scheduling

    const fromReset = context.nextFromResetHourPlusTen(context.now);
    if (!fromReset) return null;

    return {
      time: fromReset,
      strategy: "reset_hour_anchor"
    };
  }

  getStrategyName() {
    return "reset_hour_anchor";
  }

  getPriority() {
    return 2;
  }
}

/**
 * Session expiry strategy - schedules based on current session expiry + 10 minutes
 */
class SessionExpiryStrategy extends SchedulingStrategy {
  async computeNextRunTime(context) {
    if (context.lastScheduledTime) return null; // Only for initial scheduling

    try {
      context.logger.debug("update", "Rescanning sessions after authentication to refresh scheduling inputs");
      await context.sessionTracker.updateSessionTracking();
      const expiry = context.sessionTracker.getSessionWindowExpiry();

      if (expiry && expiry > context.now) {
        return {
          time: new Date(expiry.getTime() + 10 * 60 * 1000),
          strategy: "session_expiry"
        };
      }
    } catch (error) {
      // Silent catch - errors are expected in this context
    }

    return null;
  }

  getStrategyName() {
    return "session_expiry";
  }

  getPriority() {
    return 3;
  }
}

/**
 * Fixed cadence strategy - schedules based on last scheduled time + fixed interval
 */
class FixedCadenceStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    if (!context.lastScheduledTime) return null;

    return {
      time: new Date(context.lastScheduledTime.getTime() + context.fixedIntervalMs),
      strategy: "fixed_cadence"
    };
  }

  getStrategyName() {
    return "fixed_cadence";
  }

  getPriority() {
    return 4;
  }
}

/**
 * Initial alignment strategy - fallback to next hour + 10 minutes
 */
class InitialAlignStrategy extends SchedulingStrategy {
  computeNextRunTime(context) {
    // This is always available as a fallback
    return {
      time: context.nextHourPlusTen(),
      strategy: "initial_align"
    };
  }

  getStrategyName() {
    return "initial_align";
  }

  getPriority() {
    return 99; // Very low priority - fallback
  }
}

/**
 * Scheduler that manages and applies scheduling strategies
 */
class SchedulingStrategyManager {
  constructor() {
    this.strategies = [
      new ExternalSignalStrategy(),
      new ResetHourAnchorStrategy(),
      new SessionExpiryStrategy(),
      new FixedCadenceStrategy(),
      new InitialAlignStrategy()
    ].sort((a, b) => a.getPriority() - b.getPriority());
  }

  /**
   * Compute next run time using the first applicable strategy
   * @param {Object} context - Scheduling context
   * @returns {Object} Scheduling result with { time: Date, strategy: string }
   */
  async computeNextRunTime(context) {
    for (const strategy of this.strategies) {
      try {
        const result = await strategy.computeNextRunTime(context);
        if (result) {
          return result;
        }
      } catch (error) {
        context.logger?.error("strategy", `Error in strategy ${strategy.getStrategyName()}`, {
          error: error.message,
          stack: error.stack
        });
      }
    }

    // This should never happen since InitialAlignStrategy is always available
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
  ExternalSignalStrategy,
  ResetHourAnchorStrategy,
  SessionExpiryStrategy,
  FixedCadenceStrategy,
  InitialAlignStrategy,
  SchedulingStrategyManager
};