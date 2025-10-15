import ClaudeClient from "../api/claude-client.js";
import logger from "../utils/logger.js";
import { formatLocalIso } from "../utils/time-format.js";
import SessionTracker from "../utils/session-tracker.js";
import { SchedulingStrategyManager } from "../utils/scheduling-strategies.js";

/**
 * Claude Session Automation Scheduler
 * Manages periodic pulse messages to maintain Claude sessions
 */
function parseConfig(options) {
  return {
    promptText: options.PROMPT_TEXT || "ping",
    // Hardcoded fixed interval of 5 hours
    intervalHours: 5,
    maxRetries: options.MAX_RETRIES || 3,
    retryBackoffMultiplier: options.RETRY_BACKOFF_MULTIPLIER || 2,
    maxBackoffMinutes: options.MAX_BACKOFF_MINUTES || 30,
    dryRun: options.DRY_RUN || false,
    resetHour: typeof options.RESET_HOUR === 'number' ? options.RESET_HOUR : undefined,
  };
}

/**
 * Claude Session Automation Scheduler
 * Manages periodic pulse messages to maintain Claude sessions
 * @class ClaudeScheduler
 */
export class ClaudeScheduler {
  /**
   * Factory method to create and initialize a ClaudeScheduler instance
   * @param {Object} options - Configuration options
   * @param {string} [options.PROMPT_TEXT] - Message text to send for pulse
   * @param {number} [options.MAX_RETRIES] - Maximum retry attempts for failed operations
   * @param {number} [options.RESET_HOUR] - Hour of day for reset anchor scheduling
   * @returns {Promise<ClaudeScheduler>} Initialized scheduler instance
   */
  static async create(options = {}) {
    const scheduler = new ClaudeScheduler(options);
    await scheduler._initialize();
    return scheduler;
  }

  constructor(options = {}) {
    this.config = parseConfig(options);

    // State management
    this.running = false;
    this.timer = null;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = null;
    this.lastAttemptTime = null;
    this.shutdownRequested = false;
    this.lastScheduledTime = null; // track last planned run start
    this.fixedIntervalMs = 5 * 60 * 60 * 1000; // 5 hours
    this.lastStartFailureReason = null; // 'auth' | 'rate_limit' | 'other'

    this.client = null; // Will be initialized async
    this.logger = logger.child({
      component: "scheduler",
      intervalHours: this.config.intervalHours,
      promptText: this.config.promptText,
    });

    this.schedulingManager = new SchedulingStrategyManager();
  }

  async _initialize() {
    this.client = await ClaudeClient.create();
    this.sessionTracker = new SessionTracker();

    // Update session tracking on initialization
    await this.sessionTracker.updateSessionTracking();

    this.logger.info("scheduler", "ClaudeScheduler initialized", {
      config: this.config,
      sessionStatus: this.sessionTracker.getStatus()
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

  // Round up to the next full hour and add 10 minutes safety buffer
  _nextHourPlusTen(fromDate = new Date()) {
    const d = new Date(fromDate);
    d.setUTCHours(d.getUTCHours() + 1, 10, 0, 0);
    return d;
  }

  // Align a given time to hour boundary + 10 minutes (round up if needed)
  _alignToHourPlusTen(date) {
    const d = new Date(date);
    const sameHour = new Date(d);
    sameHour.setUTCMinutes(10, 0, 0);
    if (d <= sameHour && d.getUTCHours() === sameHour.getUTCHours()) {
      return sameHour;
    }
    return this._nextHourPlusTen(d);
  }

  _nextFromResetHourPlusTen(fromDate = new Date()) {
    if (typeof this.config.resetHour !== 'number') return null;
    const d = new Date(fromDate);
    // Use container local time for RESET_HOUR anchor
    const candidate = new Date(d);
    candidate.setHours(this.config.resetHour, 10, 0, 0);
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
   */
  async _sendKeepalive() {
    const timer = this.logger.startTimer("pulse");
    this.logger.debug("pulse", "Attempting to send pulse message", {
      dryRun: this.config.dryRun
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
        dryRun: true
      });

      // Reset failure count on success
      this.consecutiveFailures = 0;
      this.lastSuccessTime = new Date();

      return {
        success: true,
        result: {
          message: {
            total_cost_usd: 0,
            duration_ms: 100,
            session_id: "dry-run-session-id"
          }
        }
      };
    }

    try {
      const result = await this.client.pulse(this.config.promptText);

      if (result.success) {
        const duration = this.logger.endTimer(timer);
        this.logger.info("pulse", "Pulse successful", {
          cost: result.message?.total_cost_usd,
          duration: result.message?.duration_ms,
          sessionId: result.message?.session_id,
          timerDurationMs: duration?.ms,
        });

        // Reset failure count on success
        this.consecutiveFailures = 0;
        this.lastSuccessTime = new Date();

        return { success: true, result };
      }

      // Handle failures, including rate limits
      this.consecutiveFailures++;
      const duration = this.logger.endTimer(timer);
      this.logger.error("pulse", "Pulse failed", {
        error: result.error,
        consecutiveFailures: this.consecutiveFailures,
        timerDurationMs: duration?.ms,
        rateLimitReached: result.rateLimitReached,
      });

      // Feed signal to session tracker for self-correction
      if (result.rateLimitReached) {
        try { this.sessionTracker.registerRateLimitSignal(result.rateLimitInfo); } catch {}
      }

      return { 
        success: false, 
        error: result.error, 
        rateLimitReached: result.rateLimitReached,
        rateLimitInfo: result.rateLimitInfo
      };

    } catch (error) {
      this.consecutiveFailures++;
      const duration = this.logger.endTimer(timer);
      this.logger.error("pulse", "Pulse exception", {
        error: error.message,
        consecutiveFailures: this.consecutiveFailures,
        timerDurationMs: duration?.ms,
      });

      return { success: false, error: error.message };
    }
  }

  async _handleRateLimit(rateLimitInfo) {
    if (!rateLimitInfo) {
      this.logger.warn("ratelimit", "Rate limit handler called without valid info");
      return;
    }

    const { resetTimeRaw, resetAt } = rateLimitInfo;
    this.logger.warn("ratelimit", "Rate limit reached, calculating next run time", { resetTimeRaw, resetAt });

    let nextRunTime = null;
    if (resetAt) {
      const dt = new Date(resetAt);
      if (!isNaN(dt.getTime())) nextRunTime = dt;
    }

    if (!nextRunTime && resetTimeRaw) {
      const timeMatch = resetTimeRaw.match(/(\d{1,2}):?(\d{2})?(am|pm)/i);
      if (!timeMatch) {
        this.logger.error("ratelimit", "Could not parse reset time from raw value", { resetTimeRaw });
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
      this.logger.warn("ratelimit", "No reset time parsed; using next hour + 10 minutes");
      nextRunTime = this._nextHourPlusTen();
    }

    // Always align to exact hour + 10 minutes
    nextRunTime = this._alignToHourPlusTen(nextRunTime);

    this.logger.info("ratelimit", "Scheduling next run after rate limit reset", {
      resetTimeRaw,
      resetAt: nextRunTime.toISOString()
    });

    await this._scheduleNext(nextRunTime);
  }

  /**
   * Execute one pulse cycle with retry logic
   */
  async _executeKeepaliveCycle() {
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

      const result = await this._sendKeepalive();

      if (result.success) {
        this.logger.info("cycle", "Keepalive cycle completed successfully");
        return; // Success, exit cycle
      }

      // Handle rate limit
      if (result.rateLimitReached) {
        await this._handleRateLimit(result.rateLimitInfo);
        return; // Stop cycle and wait for rescheduled time
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
  }

  /**
   * Schedule the next pulse execution using strategy pattern
   * @param {Date|null} nextRunTime - External signal for next run time (e.g., from rate limiting)
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
      nextFromResetHourPlusTen: (time) => this._nextFromResetHourPlusTen(time),
      nextHourPlusTen: () => this._nextHourPlusTen()
    };

    // Use strategy manager to compute next run time
    const { time: planned, strategy } = await this.schedulingManager.computeNextRunTime(context);

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
        await this._executeKeepaliveCycle();
        await this._scheduleNext(); // Schedule strictly by fixed cadence
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
      timeUntilRun: `${Math.floor(intervalMs / (60 * 60 * 1000))}h ${Math.floor((intervalMs % (60 * 60 * 1000)) / (60 * 1000))}m`
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

    this.logger.info("start", "Starting scheduler", {
      promptText: this.config.promptText,
      intervalHours: this.config.intervalHours,
    });

    this.running = true;
    this.shutdownRequested = false;
    this.lastStartFailureReason = null;

    const authStatus = await this.client.getAuthStatus();
    this.logger.debug("auth", "Authentication status received", { authenticated: authStatus.authenticated });

    if (!authStatus.authenticated) {
      this.logger.info(
        "auth",
        "Authentication required",
      );
      this.running = false;
      this.lastStartFailureReason = 'auth';
      return false;
    }

    if (authStatus.rateLimitReached) {
      this.logger.warn("start", "Rate limit reached on startup. Scheduling next run after reset.");
      try { this.sessionTracker.registerRateLimitSignal(authStatus.rateLimitInfo); } catch {}
      this.lastStartFailureReason = 'rate_limit';
      await this._handleRateLimit(authStatus.rateLimitInfo);
      return true;
    }

    // Schedule recurring pulses
    await this._scheduleNext();

    this.logger.logScheduler("started");
    return true;
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
      lastSuccessTime: this.lastSuccessTime ? formatLocalIso(this.lastSuccessTime) : null,
      consecutiveFailures: this.consecutiveFailures,
      totalUptime: this.lastSuccessTime
        ? Date.now() - this.lastSuccessTime.getTime()
        : null,
    };

    this.logger.logScheduler("shutdown", shutdownStats);

    this.logger.info("shutdown", "Scheduler shutdown complete", {
      lastSuccessTime: this.lastSuccessTime ? formatLocalIso(this.lastSuccessTime) : null,
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

  /**
   * Expose CLI credentials path for auth watchers
   */
  getCredentialsPath() {
    try { return this.client?.credentialsPath || null; } catch { return null; }
  }

  /**
   * Force an immediate pulse (useful for testing)
   */
  async forcePulse() {
    this.logger.info("force", "Forcing immediate pulse...");
    return await this._executeKeepaliveCycle();
  }
}

export default ClaudeScheduler;
