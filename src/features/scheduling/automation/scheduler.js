import ClaudeClient from "../../claude/client/ClaudeClient.js";
import logger from "../../../core/utils/logger.js";
import { DateUtility } from "../../../core/utils/DateUtility.js";
import SessionTracker from "../../claude/session/SessionTracker.js";
import { SchedulingStrategyManager } from "../strategy/scheduling-strategies.js";

/**
 * Claude Session Automation Scheduler
 * Manages periodic pulse messages to maintain Claude sessions
 *
 * Discovery Mode vs Normal Mode
 * ==============================
 *
 * Discovery Mode:
 * - Triggered when no cycle limit message exists in historical logs
 * - Cannot reliably determine active cycle without "resets at X" message
 * - Sends hourly pulses to systematically discover cycle boundaries
 * - Exits when a cycle limit response is received
 *
 * Normal Mode:
 * - Uses most recent cycle limit message as authoritative anchor
 * - Computes accurate 5-hour cycle boundaries from the limit
 * - Schedules pulses at cycle expiry + 10s
 * - Maintains 5-hour cadence between pulses
 */
function parseConfig(options) {
  return {
    promptText: options.PROMPT_TEXT,
    // Hardcoded fixed interval of 5 hours
    intervalHours: 5,
    maxRetries: options.MAX_RETRIES || 3,
    retryBackoffMultiplier: options.RETRY_BACKOFF_MULTIPLIER || 2,
    maxBackoffMinutes: options.MAX_BACKOFF_MINUTES || 30,
    dryRun: options.DRY_RUN || false,
    initialPulseHour:
      typeof options.SCHEDULED_START_HOUR === "number"
        ? options.SCHEDULED_START_HOUR
        : undefined,
    immediatePulseAfterAuth: options.IMMEDIATE_PULSE_AFTER_AUTH !== false,
  };
}

/**
 * Claude Session Automation Scheduler
 * Manages periodic pulse messages to maintain Claude sessions
 * @class PulseScheduler
 */
export class PulseScheduler {
  /**
   * Create PulseScheduler instance with injected dependencies
   * @param {Object} options - Configuration options
   * @param {Object} options.client - ClaudeClient instance
   * @param {Object} options.sessionTracker - SessionTracker instance
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.config - Configuration object
   */
  constructor(options = {}) {
    // Validate required dependencies
    if (!options.client) {
      throw new Error("PulseScheduler requires client dependency");
    }
    if (!options.sessionTracker) {
      throw new Error("PulseScheduler requires sessionTracker dependency");
    }
    if (!options.logger) {
      throw new Error("PulseScheduler requires logger dependency");
    }
    if (!options.config) {
      throw new Error("PulseScheduler requires config dependency");
    }

    // Injected dependencies
    this.client = options.client;
    this.sessionTracker = options.sessionTracker;
    this.logger = options.logger.child({
      component: "scheduler",
      intervalHours: options.config.intervalHours || 5,
      promptText: options.config.PROMPT_TEXT,
    });

    // Parse and store configuration
    this.config = parseConfig(options.config);

    // State management
    this.running = false;
    this.timer = null;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = null;
    this.lastAttemptTime = null;
    this.shutdownRequested = false;
    this.lastScheduledTime = null; // track last planned run start
    this.fixedIntervalMs = 5 * 60 * 60 * 1000; // 5 hours

    this.schedulingManager = new SchedulingStrategyManager();

    // Don't update session tracking yet - do it after authentication to avoid interrupting OAuth menu
    this.logger.info("scheduler", "PulseScheduler initialized", {
      intervalHours: this.config.intervalHours,
      promptText: this.config.promptText,
      dryRun: this.config.dryRun,
    });
  }

  /**
   * Check if we're in discovery mode (no cycle limit message found yet)
   * Discovery mode uses hourly pulses to systematically discover cycle boundaries
   * @returns {boolean} True if in discovery mode, false if in normal mode
   */
  _isInDiscoveryMode() {
    return this.sessionTracker?.latestCycleLimitReset == null;
  }

  _calculateBackoffDelay(attempt) {
    const baseDelayMinutes = 1;
    const backoffMinutes = Math.min(
      baseDelayMinutes * Math.pow(this.config.retryBackoffMultiplier, attempt),
      this.config.maxBackoffMinutes,
    );
    return Math.floor(backoffMinutes * 60 * 1000);
  }

  // Round up to the next full hour and add 10 seconds safety buffer
  _nextHourPlusTen(fromDate = new Date()) {
    const d = new Date(fromDate);
    d.setUTCHours(d.getUTCHours() + 1, 0, 10, 0);
    return d;
  }

  // Align a given time to hour boundary + 10 seconds (round up if needed)
  _alignToHourPlusTen(date) {
    const d = new Date(date);
    const sameHour = new Date(d);
    sameHour.setUTCMinutes(0, 10, 0);
    if (d <= sameHour && d.getUTCHours() === sameHour.getUTCHours()) {
      return sameHour;
    }
    return this._nextHourPlusTen(d);
  }

  _nextFromInitialPulseHourPlusTen(fromDate = new Date()) {
    if (typeof this.config.initialPulseHour !== "number") return null;
    const d = new Date(fromDate);
    // Use container local time for SCHEDULED_START_HOUR anchor
    const candidate = new Date(d);
    candidate.setHours(this.config.initialPulseHour, 0, 10, 0);
    if (candidate <= d) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  /**
   * Sleep utility for delays
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Send pulse message to Claude (or simulate in dry run mode)
   * Pure pulse execution without side effects - use _processPulseResult for handling
   */
  async _sendPulse() {
    const timer = this.logger.startTimer("pulse");
    this.logger.debug("pulse", "Attempting to send pulse message", {
      dryRun: this.config.dryRun,
    });
    this.lastAttemptTime = new Date();

    if (this.config.dryRun) {
      // Simulate dry run response
      const duration = this.logger.endTimer(timer);
      this.logger.info("pulse", "Pulse simulated (dry run)", {
        cost: 0,
        duration: 100,
        sessionId: "dry-run-session-id",
        timerDurationMs: duration?.ms,
        dryRun: true,
      });

      return {
        success: true,
        result: {
          message: {
            total_cost_usd: 0,
            duration_ms: 100,
            session_id: "dry-run-session-id",
          },
        },
        timerDurationMs: duration?.ms,
      };
    }

    try {
      const result = await this.client.pulse(this.config.promptText);
      const duration = this.logger.endTimer(timer);

      if (result.success) {
        this.logger.info("pulse", "Pulse successful", {
          cost: result.message?.total_cost_usd,
          duration: result.message?.duration_ms,
          sessionId: result.message?.session_id,
          timerDurationMs: duration?.ms,
        });

        return {
          success: true,
          result,
          timerDurationMs: duration?.ms,
        };
      }

      // Handle failures, including session limits
      this.logger.error("pulse", "Pulse failed", {
        error: result.error,
        consecutiveFailures: this.consecutiveFailures + 1,
        timerDurationMs: duration?.ms,
        sessionLimitReached: result.sessionLimitReached,
      });

      return {
        success: false,
        error: result.error,
        sessionLimitReached: result.sessionLimitReached,
        sessionLimitInfo: result.sessionLimitInfo,
        timerDurationMs: duration?.ms,
      };
    } catch (error) {
      const duration = this.logger.endTimer(timer);
      this.logger.error("pulse", "Pulse exception", {
        error: error.message,
        consecutiveFailures: this.consecutiveFailures + 1,
        timerDurationMs: duration?.ms,
      });

      return {
        success: false,
        error: error.message,
        timerDurationMs: duration?.ms,
      };
    }
  }

  /**
   * Process pulse result with centralized session limit detection and state management
   * @param {Object} pulseResult - Result from _sendPulse()
   * @param {boolean} shouldReschedule - Whether to reschedule on session limit (default: true)
   * @returns {Object} Processed result with session limit handling applied
   */
  async _processPulseResult(pulseResult, shouldReschedule = true) {
    if (pulseResult.success) {
      // Reset failure count on success
      this.consecutiveFailures = 0;
      this.lastSuccessTime = new Date();
      return pulseResult;
    }

    // Handle failures
    this.consecutiveFailures++;

    // Feed session limit signal to session tracker for self-correction
    if (pulseResult.sessionLimitReached && pulseResult.sessionLimitInfo) {
      try {
        this.sessionTracker.registerSessionLimitSignal(
          pulseResult.sessionLimitInfo,
        );
      } catch {}

      // Handle session limit rescheduling if requested
      if (shouldReschedule) {
        this.logger.info(
          "pulse",
          "Session limit reached - rescheduling next pulse to reset time",
        );
        await this._handleSessionLimit(pulseResult.sessionLimitInfo);
      }
    }

    return pulseResult;
  }

  async _handleSessionLimit(sessionLimitInfo) {
    if (!sessionLimitInfo) {
      this.logger.warn(
        "sessionlimit",
        "Session limit handler called without valid info",
      );
      return;
    }

    const { resetTimeRaw, resetAt } = sessionLimitInfo;
    this.logger.warn(
      "ratelimit",
      "Session limit reached, calculating next run time",
      { resetTimeRaw, resetAt },
    );

    let nextRunTime = null;
    if (resetAt) {
      const dt = new Date(resetAt);
      if (!isNaN(dt.getTime())) nextRunTime = dt;
    }

    if (!nextRunTime && resetTimeRaw) {
      const timeMatch = resetTimeRaw.match(/(\d{1,2}):?(\d{2})?(am|pm)/i);
      if (!timeMatch) {
        this.logger.error(
          "ratelimit",
          "Could not parse reset time from raw value",
          { resetTimeRaw },
        );
        return;
      }

      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3].toLowerCase();

      if (period === "pm" && hours !== 12) {
        hours += 12;
      } else if (period === "am" && hours === 12) {
        hours = 0;
      }

      nextRunTime = new Date();
      nextRunTime.setUTCHours(hours, minutes, 0, 0);

      if (nextRunTime < new Date()) {
        nextRunTime.setUTCDate(nextRunTime.getUTCDate() + 1);
      }
    }

    if (!nextRunTime) {
      this.logger.warn(
        "ratelimit",
        "No reset time parsed; using next hour + 10 seconds",
      );
      nextRunTime = this._nextHourPlusTen();
    }

    // Always align to exact hour + 10 seconds
    nextRunTime = this._alignToHourPlusTen(nextRunTime);

    await this._scheduleNext(nextRunTime);
  }

  /**
   * Execute one pulse cycle with retry logic
   * @returns {boolean} True if cycle already rescheduled next run (e.g., due to session limit), false otherwise
   */
  async _executePulseCycle() {
    this.logger.info("cycle", "Starting new pulse cycle");

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      if (this.shutdownRequested) {
        this.logger.info("cycle", "Shutdown requested, aborting cycle");
        return false;
      }

      // Apply backoff delay for retries
      if (attempt > 0) {
        const delayMs = this._calculateBackoffDelay(attempt - 1);
        this.logger.info(
          "cycle",
          `Retrying in ${Math.round(delayMs / 1000)} seconds`,
          { attempt: attempt + 1, delayMs },
        );
        await this._sleep(delayMs);
      }

      if (this.shutdownRequested) {
        this.logger.info(
          "cycle",
          "Shutdown requested during backoff, aborting cycle",
        );
        return false;
      }

      const rawResult = await this._sendPulse();
      const result = await this._processPulseResult(rawResult, true);

      if (result.success) {
        this.logger.info("cycle", "Pulse cycle completed successfully");
        return false; // Success, needs normal scheduling
      }

      // Handle session limit - _processPulseResult already handled rescheduling
      if (result.sessionLimitReached) {
        this.logger.debug(
          "cycle",
          "Session limit detected - next run already rescheduled by _processPulseResult",
        );
        return true; // Already rescheduled, don't schedule again
      }

      // Handle other failures
      this.logger.warn("cycle", `Attempt ${attempt + 1} failed`, {
        error: result.error,
        remainingAttempts: this.config.maxRetries - attempt - 1,
      });
    }

    // All retries exhausted
    this.logger.error("cycle", "All retry attempts exhausted", {
      maxRetries: this.config.maxRetries,
      consecutiveFailures: this.consecutiveFailures,
    });
    return false; // Needs normal scheduling
  }

  /**
   * Schedule the next pulse execution using strategy pattern
   * @param {Date|null} nextRunTime - External signal for next run time (e.g., from session limiting)
   */
  async _scheduleNext(nextRunTime) {
    if (this.shutdownRequested || !this.running) {
      this.logger.debug(
        "schedule",
        "Not scheduling next run (shutdown requested or not running)",
      );
      return;
    }

    // Always clear any existing timer so the new schedule takes precedence
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const now = new Date();

    // Create context for scheduling strategies
    const context = {
      nextRunTime,
      lastScheduledTime: this.lastScheduledTime,
      fixedIntervalMs: this.fixedIntervalMs,
      now,
      sessionTracker: this.sessionTracker,
      logger: this.logger,
      alignToHourPlusTen: (time) => this._alignToHourPlusTen(time),
      nextFromInitialPulseHourPlusTen: (time) =>
        this._nextFromInitialPulseHourPlusTen(time),
      nextHourPlusTen: () => this._nextHourPlusTen(),
    };

    // Use strategy manager to compute next run time
    const { time: planned, strategy } =
      await this.schedulingManager.computeNextRunTime(context);

    // Ensure planned time is in future; if drifted, roll forward in 5h steps
    let finalTime = planned;
    while (finalTime <= now) {
      finalTime = new Date(finalTime.getTime() + this.fixedIntervalMs);
    }
    this.lastScheduledTime = finalTime;

    // Log scheduling result
    const intervalMs = finalTime.getTime() - now.getTime();
    this.logger.debug("schedule", "Computed next run time", {
      strategy,
      planned: finalTime.toISOString(),
      intervalMs,
    });

    this.logger.logScheduler("next_pulse_scheduled", {
      intervalHours: this.config.intervalHours,
      intervalMs,
      nextRunTime: finalTime.toISOString(),
      strategy,
    });

    // Schedule execution
    this.timer = setTimeout(async () => {
      if (this.running && !this.shutdownRequested) {
        const alreadyRescheduled = await this._executePulseCycle();

        // Only schedule next run if cycle didn't already reschedule (e.g., due to session limit)
        if (!alreadyRescheduled && this.running && !this.shutdownRequested) {
          await this._scheduleNext(); // Schedule strictly by fixed cadence
        } else if (alreadyRescheduled) {
          this.logger.debug(
            "schedule",
            "Skipping normal scheduling - already rescheduled by session limit handler",
          );
        }
      }
    }, intervalMs);
  }

  /**
   * Start the automation scheduler
   */
  /**
   * Perform dry run analysis - show what would happen without actually scheduling
   */
  async dryRunAnalysis() {
    this.logger.info("dry-run", "=== DRY RUN MODE - ANALYSIS ONLY ===");

    // Optionally show current status
    await this.sessionTracker.updateSessionTracking();
    const sessionStatus = this.sessionTracker.getStatus();
    this.logger.info("dry-run", "Current Session Status", sessionStatus);

    // Fixed schedule: next hour + 10, then every 5 hours
    const optimalNextRun = this._nextHourPlusTen();
    const intervalMs = optimalNextRun.getTime() - Date.now();

    this.logger.info("dry-run", "Scheduling Analysis", {
      optimalSchedule: optimalNextRun.toISOString(),
      intervalHours: this.config.intervalHours,
      intervalMs,
      sessionAware: false,
      timeUntilRun: `${Math.floor(intervalMs / (60 * 60 * 1000))}h ${Math.floor((intervalMs % (60 * 60 * 1000)) / (60 * 1000))}m`,
    });

    this.logger.info("dry-run", "=== DRY RUN COMPLETE - EXITING ===");
    return true;
  }

  async start() {
    if (this.running) {
      this.logger.warn("start", "Scheduler already running");
      return;
    }

    // Handle dry run mode - analyze and exit
    if (this.config.dryRun) {
      return await this.dryRunAnalysis();
    }

    this.running = true;
    this.shutdownRequested = false;

    this.logger.info("start", "Starting scheduler", {
      promptText: this.config.promptText,
      intervalHours: this.config.intervalHours,
    });

    await this.sessionTracker.updateSessionTracking();

    // Send initial pulse to discover cycle state
    let alreadyRescheduled = false;
    if (this.config.immediatePulseAfterAuth) {
      alreadyRescheduled = await this._sendInitialPulseToDiscoverCycleState();
    }

    // Schedule recurring pulses (only if initial pulse didn't already reschedule)
    if (!alreadyRescheduled) {
      await this._scheduleNext();
    } else {
      this.logger.debug(
        "start",
        "Skipping normal scheduling - initial pulse triggered session limit, already rescheduled",
      );
    }

    this.logger.logScheduler("started");
    return true;
  }

  /**
   * Send initial pulse to discover current cycle state
   *
   * Discovery Mode: If no cycle expiry is known, sends a pulse to probe for limits
   * Normal Mode: If active cycle expiry is known, skips pulse
   *
   * This function focuses on a single concern: determining if we need to send
   * an initial discovery pulse based on whether we know the cycle expiry.
   *
   * @returns {boolean} True if pulse triggered session limit and already rescheduled, false otherwise
   */
  async _sendInitialPulseToDiscoverCycleState() {
    try {
      // Check if we know when the current cycle expires
      const cycleExpiry = this.sessionTracker.getGlobalCycleExpiry();
      const hasKnownExpiry = cycleExpiry !== null;

      // If we know the cycle expiry, skip the discovery pulse
      if (hasKnownExpiry) {
        this.logger.info(
          "startup",
          "Skipping initial pulse - active cycle with known expiry detected",
          {
            cycleExpiry: cycleExpiry.toISOString(),
            mode: "normal"
          },
        );
        return false; // No pulse sent, needs normal scheduling
      }

      // Discovery mode: We don't know the cycle expiry, send a pulse to discover it
      this.logger.info(
        "startup",
        "Sending initial pulse to discover cycle state and confirm authentication",
        { mode: "discovery" },
      );

      try {
        const rawResult = await this._sendPulse();
        const result = await this._processPulseResult(rawResult, true);

        if (result.success) {
          this.logger.info(
            "startup",
            "Initial pulse successful - no limit response, entering discovery mode",
            { mode: "discovery" },
          );
          return false; // No limit, needs normal scheduling
        } else {
          this.logger.warn("startup", "Initial pulse failed", {
            success: false,
            error: result.error,
            sessionLimitReached: result.sessionLimitReached,
          });

          // Cycle limit rescheduling already handled by _processPulseResult
          if (result.sessionLimitReached) {
            this.logger.info(
              "startup",
              "Cycle limit detected! Exiting discovery mode, switching to normal scheduling",
            );
            return true; // Already rescheduled by session limit handler
          }
          return false; // Other failure, needs normal scheduling
        }
      } catch (error) {
        this.logger.warn("startup", "Initial pulse failed", {
          error: error.message,
        });
        return false; // Error, needs normal scheduling
      }
    } catch (error) {
      this.logger.debug("pulse", "Error checking for immediate pulse", {
        error: error.message,
      });
      return false; // Error, needs normal scheduling
    }
  }

  /**
   * Stop the automation scheduler
   */
  async shutdown() {
    if (!this.running && !this.timer) {
      this.logger.debug("shutdown", "Scheduler not running");
      return;
    }

    this.logger.info("shutdown", "Shutting down Claude automation...");

    this.shutdownRequested = true;
    this.running = false;

    // Clear the timer
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.logger.debug("shutdown", "Timer cleared");
    }

    // Log final statistics
    const shutdownStats = {
      lastSuccessTime: this.lastSuccessTime
        ? DateUtility.formatLocalIso(this.lastSuccessTime)
        : null,
      consecutiveFailures: this.consecutiveFailures,
      totalUptime: this.lastSuccessTime
        ? Date.now() - this.lastSuccessTime.getTime()
        : null,
    };

    this.logger.logScheduler("shutdown", shutdownStats);

    this.logger.info("shutdown", "Scheduler shutdown complete", {
      lastSuccessTime: this.lastSuccessTime
        ? DateUtility.formatLocalIso(this.lastSuccessTime)
        : null,
      consecutiveFailures: this.consecutiveFailures,
    });
  }

  /**
   * Get current scheduler status
   */
  getStatus() {
    return {
      running: this.running,
      shutdownRequested: this.shutdownRequested,
      config: this.config,
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessTime: this.lastSuccessTime,
      lastAttemptTime: this.lastAttemptTime,
      nextRunTime: this.timer ? this.lastScheduledTime : null,
    };
  }
}

export default PulseScheduler;
