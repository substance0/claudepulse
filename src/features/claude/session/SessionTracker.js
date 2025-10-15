import logger from "../../../core/utils/logger.js";
import DateUtility from "../../../core/utils/DateUtility.js";
import ProjectLogAggregator from "./ProjectLogAggregator.js";
import CycleComputer from "./CycleComputer.js";

/**
 * Session Tracker (Facade)
 *
 * Compatibility layer that delegates to:
 * - ProjectLogAggregator (I/O): Reads logs, collects messages, tracks sessions
 * - CycleComputer (Logic): Computes cycle boundaries from aggregated data
 *
 * Maintains backward compatibility with existing API while using the new architecture.
 */
export class SessionTracker {
  constructor(options = {}) {
    // Validate required dependencies
    if (!options.logReader) {
      throw new Error("SessionTracker requires logReader dependency");
    }

    this.logger = logger.child({ component: "session-tracker" });
    this.dateUtility = new DateUtility(options);

    // Delegate to new architecture
    this.aggregator = new ProjectLogAggregator({
      logReader: options.logReader,
      ...options,
    });
    this.cycleComputer = new CycleComputer({
      dateUtility: this.dateUtility,
    });

    // Track state for change detection
    this.lastKnownExpiry = null;
  }

  // Expose aggregator properties for backward compatibility
  get latestCycleLimitReset() {
    return this.aggregator.latestCycleLimitReset;
  }

  get allProjectsMessages() {
    return this.aggregator.allProjectsMessages;
  }

  get sessions() {
    return this.aggregator.sessions;
  }

  /**
   * Get active session (delegates to aggregator)
   */
  getActiveSession() {
    return this.aggregator.getActiveSession();
  }

  /**
   * Get cycle expiry (delegates to cycle computer)
   *
   * Discovery Mode: Returns null when no cycle limit message exists
   * Normal Mode: Returns Date when cycle expires based on limit anchor
   */
  getGlobalCycleExpiry() {
    return this.cycleComputer.computeCycleExpiry({
      allProjectsMessages: this.aggregator.allProjectsMessages,
      latestCycleLimitReset: this.aggregator.latestCycleLimitReset,
    });
  }

  /**
   * Legacy alias for getGlobalCycleExpiry()
   */
  getSessionWindowExpiry() {
    return this.getGlobalCycleExpiry();
  }

  /**
   * Get time remaining until cycle reset
   */
  getTimeToReset() {
    const expiry = this.getGlobalCycleExpiry();
    return this.cycleComputer.getTimeToReset(expiry);
  }

  /**
   * Update session tracking by reading all log files
   */
  async updateSessionTracking() {
    // Delegate aggregation to ProjectLogAggregator
    const aggregationResult = await this.aggregator.updateAggregation();

    // Compute cycle expiry
    const currentExpiry = this.getGlobalCycleExpiry();

    // Log only on change
    const prevExpiryMs = this.lastKnownExpiry?.getTime?.();
    const newExpiryMs = currentExpiry?.getTime?.();

    if (prevExpiryMs !== newExpiryMs) {
      const activeSession = aggregationResult.activeSession;

      this.logger.info(
        "expiry",
        "Calculated global Claude subscription cycle expiry",
        {
          cycleExpiry: currentExpiry ? currentExpiry.toISOString() : null,
          activeSessionId: activeSession?.id,
          mode: this.latestCycleLimitReset ? "normal" : "discovery",
        },
      );
      this.lastKnownExpiry = currentExpiry || null;
    }

    const activeSession = aggregationResult.activeSession;
    const sessionCount = aggregationResult.totalSessions;
    const activeSessionCount = aggregationResult.activeSessions;

    this.logger.info("update", "Session tracking updated", {
      totalSessions: sessionCount,
      activeSessions: activeSessionCount,
      messagesCollected: this.allProjectsMessages.length,
      currentSessionId: activeSession?.id,
      windowExpiry: currentExpiry?.toISOString(),
      mode: this.latestCycleLimitReset ? "normal" : "discovery",
    });

    return {
      totalSessions: sessionCount,
      currentSession: activeSession,
      timeToReset: this.getTimeToReset(),
    };
  }

  /**
   * Get session tracking status
   */
  getStatus() {
    const activeSession = this.getActiveSession();
    const timeToReset = this.getTimeToReset();
    const windowExpiry = this.getGlobalCycleExpiry();

    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(
        (s) => s.isActive,
      ).length,
      currentSession: activeSession
        ? {
            id: activeSession.id,
            startTime: activeSession.startTime,
            lastActivity: activeSession.lastActivity,
            messageCount: activeSession.messageCount,
            isActive: activeSession.isActive,
          }
        : null,
      windowExpiry: windowExpiry?.toISOString(),
      timeToReset: timeToReset
        ? {
            hours: timeToReset.hours,
            minutes: timeToReset.minutes,
            isExpired: timeToReset.isExpired,
          }
        : null,
      mode: this.latestCycleLimitReset ? "normal" : "discovery",
    };
  }

  // Legacy method kept for compatibility (unused but may be called externally)
  registerSessionLimitSignal(info = {}) {
    // No-op: self-correction logic removed in refactor
    this.logger.debug(
      "limit-signal",
      "Legacy registerSessionLimitSignal called (no-op)",
    );
  }
}

export default SessionTracker;
