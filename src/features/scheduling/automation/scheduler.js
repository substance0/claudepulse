import { DateUtility } from "../../../core/utils/DateUtility.js";
import { SchedulingStrategyManager } from "../strategy/scheduling-strategies.js";

/**
 * Claude Session Automation Scheduler
 * Manages periodic pulse messages to maintain Claude sessions
 *
 * Every pulse reports the rate-limit window it ran in. The next pulse is
 * scheduled just after that window resets, so a new window opens as soon as
 * the previous one ends. When no window is known yet, for example after a
 * pulse that failed before reporting one, pulses fall back to the next hour.
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
 * Decide whether a run of consecutive failures warrants another alert.
 * Alerting on every cycle buries the signal, so alerts are spaced out
 * exponentially: the operator hears about a problem promptly, then at
 * widening intervals for as long as it persists.
 * @param {number} consecutiveFailures - Failures since the last success
 * @returns {boolean}
 */
export function shouldAlertForFailureCount(consecutiveFailures) {
  if (!Number.isInteger(consecutiveFailures) || consecutiveFailures < 1) {
    return false;
  }

  // Powers of two: 1, 2, 4, 8, 16, ...
  return (consecutiveFailures & (consecutiveFailures - 1)) === 0;
}

/**
 * Detect an authentication failure that retrying cannot resolve.
 * These need a human to re-authenticate, so further attempts only waste a cycle.
 * @param {string|Object} error - Error payload from a failed pulse
 * @returns {boolean}
 */
function isUnrecoverableAuthError(error) {
  if (!error) {
    return false;
  }

  const text = typeof error === "string" ? error : JSON.stringify(error);

  // Responses that name an authentication problem in their message.
  const namesAuthProblem =
    /authentication_error|invalid_grant|OAuth access token has expired|Please run \/login|only authorized for use with Claude Code/i.test(
      text,
    );

  // A 401 or 403 is an authorization decision on its own. Some carry no
  // message text to match, so the status has to be enough.
  const rejectedByStatus = /API Error:\s*40[13]\b/i.test(text);

  return namesAuthProblem || rejectedByStatus;
}

/**
 * Whether a pulse was refused because a usage window is exhausted.
 * @param {Object} pulseResult - Result from _sendPulse()
 * @returns {boolean}
 */
function isLimitReached(pulseResult) {
  return pulseResult.rateLimit?.status === "rejected";
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
   * @param {Object} options.executor - Runs a pulse; see ClaudeCliExecutor
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.config - Configuration object
   */
  constructor(options = {}) {
    // Validate required dependencies
    if (!options.executor) {
      throw new Error("PulseScheduler requires executor dependency");
    }
    if (!options.logger) {
      throw new Error("PulseScheduler requires logger dependency");
    }
    if (!options.config) {
      throw new Error("PulseScheduler requires config dependency");
    }

    // Injected dependencies
    this.executor = options.executor;
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
    // Latest rate-limit state reported by a pulse; drives scheduling
    this.rateLimit = null;

    this.schedulingManager = new SchedulingStrategyManager();

    this.logger.info("scheduler", "PulseScheduler initialized", {
      intervalHours: this.config.intervalHours,
      promptText: this.config.promptText,
      dryRun: this.config.dryRun,
    });
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
        rateLimit: null,
        timerDurationMs: duration?.ms,
      };
    }

    try {
      const result = await this.executor.pulse(this.config.promptText);
      const duration = this.logger.endTimer(timer);

      if (result.success) {
        this.logger.info("pulse", "Pulse successful", {
          cost: result.message?.total_cost_usd,
          duration: result.message?.duration_ms,
          sessionId: result.message?.session_id,
          windowResetsAt: result.rateLimit?.fiveHourResetsAt?.toISOString(),
          timerDurationMs: duration?.ms,
        });

        return {
          success: true,
          result,
          rateLimit: result.rateLimit ?? null,
          timerDurationMs: duration?.ms,
        };
      }

      if (isLimitReached(result)) {
        this.logger.info("pulse", "Usage limit reached - waiting for reset", {
          resetsAt: result.rateLimit.resetsAt?.toISOString(),
          timerDurationMs: duration?.ms,
        });
      } else {
        // Logged at warn, not error: error raises an alert, and alerts are
        // raised once per cycle by _reportCycleFailure, spaced out.
        this.logger.warn("pulse", "Pulse failed", {
          error: result.error,
          timerDurationMs: duration?.ms,
        });
      }

      return {
        success: false,
        error: result.error,
        rateLimit: result.rateLimit ?? null,
        timerDurationMs: duration?.ms,
      };
    } catch (error) {
      const duration = this.logger.endTimer(timer);
      this.logger.warn("pulse", "Pulse exception", {
        error: error.message,
        timerDurationMs: duration?.ms,
      });

      return {
        success: false,
        error: error.message,
        rateLimit: null,
        timerDurationMs: duration?.ms,
      };
    }
  }

  /**
   * Record a pulse result's rate-limit state, and reset the failure count on
   * success. Failures are counted per cycle by the caller, not per attempt.
   * @param {Object} pulseResult - Result from _sendPulse()
   * @returns {Object} The same result, with `limitReached` set
   */
  _processPulseResult(pulseResult) {
    // Keep the last reported window until a pulse reports a new one. A
    // transient failure mid-window does not change when the window resets,
    // and a reset that has passed is ignored when scheduling.
    if (pulseResult.rateLimit) {
      this.rateLimit = pulseResult.rateLimit;
    }

    if (pulseResult.success) {
      this.consecutiveFailures = 0;
      this.lastSuccessTime = new Date();
    }

    // An exhausted allowance means Claude is in use, not that ClaudePulse is
    // broken, so callers do not count it as a failure.
    return { ...pulseResult, limitReached: isLimitReached(pulseResult) };
  }

  /**
   * Count a failed cycle and report it. Counting cycles rather than attempts
   * keeps the count on the alert schedule: counting three attempts per cycle
   * gave 3, 6, 9... which never reaches a power of two, so a sustained
   * transient outage never alerted.
   * @param {string} message - Human-readable failure description
   * @param {Object} data - Structured context for the log entry
   */
  _failCycle(message, data) {
    this.consecutiveFailures++;
    this._reportCycleFailure(message, {
      ...data,
      consecutiveFailures: this.consecutiveFailures,
    });
  }

  /**
   * Report a failed cycle, escalating to error level - which raises an alert -
   * only at spaced intervals. A persistent outage otherwise alerts on every
   * cycle, which buries the signal it is meant to raise.
   * @param {string} message - Human-readable failure description
   * @param {Object} data - Structured context for the log entry
   */
  _reportCycleFailure(message, data) {
    if (shouldAlertForFailureCount(this.consecutiveFailures)) {
      this.logger.error("cycle", message, data);
    } else {
      this.logger.warn("cycle", message, data);
    }
  }

  /**
   * Execute one pulse cycle with retry logic
   */
  async _executePulseCycle() {
    this.logger.info("cycle", "Starting new pulse cycle");

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      if (this.shutdownRequested) {
        this.logger.info("cycle", "Shutdown requested, aborting cycle");
        return;
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
        return;
      }

      const result = this._processPulseResult(await this._sendPulse());

      if (result.success) {
        this.logger.info("cycle", "Pulse cycle completed successfully");
        return;
      }

      // Retrying before the window resets would only be refused again.
      if (result.limitReached) {
        this.logger.info(
          "cycle",
          "Usage limit reached - next pulse follows the window reset",
        );
        return;
      }

      // An expired or rejected token cannot be fixed by sending again, so
      // abandon the cycle instead of burning the remaining attempts.
      if (isUnrecoverableAuthError(result.error)) {
        this._failCycle(
          "Authentication rejected - re-authenticate to resume pulsing",
          { error: result.error },
        );
        return;
      }

      // Handle other failures
      this.logger.warn("cycle", `Attempt ${attempt + 1} failed`, {
        error: result.error,
        remainingAttempts: this.config.maxRetries - attempt - 1,
      });
    }

    // All retries exhausted
    this._failCycle("All retry attempts exhausted", {
      maxRetries: this.config.maxRetries,
    });
  }

  /**
   * Schedule the next pulse execution using strategy pattern
   */
  async _scheduleNext() {
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
      now,
      rateLimit: this.rateLimit,
      lastScheduledTime: this.lastScheduledTime,
      logger: this.logger,
      nextFromInitialPulseHourPlusTen: (time) =>
        this._nextFromInitialPulseHourPlusTen(time),
      nextHourPlusTen: () => this._nextHourPlusTen(),
    };

    // Use strategy manager to compute next run time
    const { time: planned, strategy } =
      await this.schedulingManager.computeNextRunTime(context);

    // Strategies return future times; roll forward defensively if one did not
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
        await this._executePulseCycle();

        if (this.running && !this.shutdownRequested) {
          await this._scheduleNext();
        }
      }
    }, intervalMs);
  }

  /**
   * Perform dry run analysis - show what would happen without actually scheduling
   */
  async dryRunAnalysis() {
    this.logger.info("dry-run", "=== DRY RUN MODE - ANALYSIS ONLY ===");

    // Without a real pulse no window is known, so the first pulse would
    // follow the configured start hour or the next hour.
    const optimalNextRun =
      this._nextFromInitialPulseHourPlusTen() ?? this._nextHourPlusTen();
    const intervalMs = optimalNextRun.getTime() - Date.now();

    this.logger.info("dry-run", "Scheduling Analysis", {
      optimalSchedule: optimalNextRun.toISOString(),
      intervalHours: this.config.intervalHours,
      intervalMs,
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

    // The first pulse reports the current window, which every later pulse is
    // scheduled from.
    if (this.config.immediatePulseAfterAuth) {
      await this._sendInitialPulse();
    }

    await this._scheduleNext();

    this.logger.logScheduler("started");
    return true;
  }

  /**
   * Send one pulse at startup, to open a window if none is active and to
   * learn when the current one resets.
   */
  async _sendInitialPulse() {
    this.logger.info("startup", "Sending initial pulse to learn the current window");

    try {
      const result = this._processPulseResult(await this._sendPulse());

      if (result.success) {
        this.logger.info("startup", "Initial pulse successful", {
          windowResetsAt: this.rateLimit?.fiveHourResetsAt?.toISOString(),
        });
      } else if (result.limitReached) {
        this.logger.info("startup", "Usage limit reached at startup", {
          resetsAt: this.rateLimit?.resetsAt?.toISOString(),
        });
      } else {
        // A failure at startup is exactly when an alert matters most: a
        // container restarted with a dead token should say so immediately.
        this._failCycle("Initial pulse failed", { error: result.error });
      }
    } catch (error) {
      this._failCycle("Initial pulse failed", { error: error.message });
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
      rateLimit: this.rateLimit,
    };
  }
}

export default PulseScheduler;
