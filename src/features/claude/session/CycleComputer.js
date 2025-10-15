import logger from "../../../core/utils/logger.js";

/**
 * Cycle Computer (Logic Layer)
 *
 * Pure logic for computing Claude Pro/Max 5-hour cycle boundaries.
 * No I/O operations - works only with data provided by ProjectLogAggregator.
 *
 * Discovery Mode: Without a cycle limit message, cannot reliably determine
 * if there's an active cycle. Returns null to trigger discovery mode (hourly pulses).
 *
 * Normal Mode: Uses the most recent cycle limit message as an anchor to compute
 * accurate cycle boundaries from actual message timestamps.
 */
export class CycleComputer {
  constructor(options = {}) {
    this.logger = logger.child({ component: "cycle-computer" });
    this.dateUtility = options.dateUtility;
  }

  /**
   * Round timestamp down to the hour (UTC)
   */
  _roundToHour(timestamp) {
    const d = new Date(timestamp);
    d.setUTCMinutes(0, 0, 0);
    return d;
  }

  /**
   * Compute cycle expiry based on aggregated data
   *
   * @param {Object} aggregatedData - Data from ProjectLogAggregator
   * @param {Array} aggregatedData.allProjectsMessages - All messages across projects
   * @param {Object|null} aggregatedData.latestCycleLimitReset - Most recent limit message
   * @returns {Date|null} Cycle expiry time, or null if no active cycle
   */
  computeCycleExpiry(aggregatedData) {
    const { allProjectsMessages, latestCycleLimitReset } = aggregatedData;
    const now = new Date();

    // Discovery Mode: No cycle limit message found
    if (!latestCycleLimitReset) {
      this.logger.debug(
        "expiry",
        "Discovery mode: no cycle limit message found - cannot reliably determine active cycle",
      );
      return null;
    }

    // Normal Mode: Use cycle limit message as anchor
    const limitResetTime = new Date(latestCycleLimitReset.resetAt);
    const limitMessageTime = new Date(latestCycleLimitReset.messageTimestamp);

    this.logger.debug(
      "expiry",
      "Normal mode: using cycle limit message as anchor",
      {
        limitResetAt: limitResetTime.toISOString(),
        limitMessageAt: limitMessageTime.toISOString(),
      },
    );

    // Find all messages AFTER the limit reset time
    const messagesAfterLimit = allProjectsMessages
      .map((m) => ({ ...m, t: new Date(m.timestamp) }))
      .filter((m) => !isNaN(m.t.getTime()) && m.t >= limitResetTime)
      .sort((a, b) => a.t - b.t);

    if (messagesAfterLimit.length === 0) {
      // No messages sent after the limit reset - waiting for the reset
      if (limitResetTime > now) {
        this.logger.debug(
          "expiry",
          "No messages after limit reset, reset time is in future",
          { limitResetAt: limitResetTime.toISOString() },
        );
        return limitResetTime;
      } else {
        // Reset time has passed, ready for immediate pulse
        this.logger.debug(
          "expiry",
          "No messages after limit reset, reset time is in past - ready for new cycle",
          { limitResetAt: limitResetTime.toISOString() },
        );
        return null;
      }
    }

    // Compute cycles starting from the reset time
    let currentCycleStart = limitResetTime;
    let currentCycleEnd = new Date(
      currentCycleStart.getTime() + 5 * 60 * 60 * 1000,
    );

    for (const msg of messagesAfterLimit) {
      // If message is within current cycle, continue
      if (msg.t >= currentCycleStart && msg.t < currentCycleEnd) {
        continue;
      }

      // Message is after current cycle ended - start a new cycle
      // New cycle starts at the message time rounded down to the hour
      currentCycleStart = this._roundToHour(msg.t);
      currentCycleEnd = new Date(
        currentCycleStart.getTime() + 5 * 60 * 60 * 1000,
      );
    }

    // Check if we're currently in the computed cycle
    if (now >= currentCycleStart && now < currentCycleEnd) {
      this.logger.debug("expiry", "Current cycle computed from limit anchor", {
        cycleStart: currentCycleStart.toISOString(),
        cycleEnd: currentCycleEnd.toISOString(),
      });
      return currentCycleEnd;
    }

    // We're past the last computed cycle - ready for a new cycle
    this.logger.debug(
      "expiry",
      "Past the last computed cycle - ready for new cycle",
      {
        lastCycleEnd: currentCycleEnd.toISOString(),
        now: now.toISOString(),
      },
    );
    return null;
  }

  /**
   * Get time remaining until cycle reset
   * @param {Date|null} cycleExpiry - Cycle expiry from computeCycleExpiry()
   * @returns {Object|null} Time remaining info
   */
  getTimeToReset(cycleExpiry) {
    if (!cycleExpiry) {
      return null;
    }

    const now = new Date();
    const timeRemaining = cycleExpiry.getTime() - now.getTime();

    return {
      totalMs: timeRemaining,
      hours: Math.floor(timeRemaining / (60 * 60 * 1000)),
      minutes: Math.floor((timeRemaining % (60 * 60 * 1000)) / (60 * 1000)),
      isExpired: timeRemaining <= 0,
    };
  }
}

export default CycleComputer;
