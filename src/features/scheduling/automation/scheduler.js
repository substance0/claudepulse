import { DateUtility } from "../../../core/utils/DateUtility.js";
import { SchedulingStrategyManager } from "../strategy/scheduling-strategies.js";
import { blockingLimit } from "../../../core/services/windowNotification.js";

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

/** How long scheduling waits for the state file to be written. */
const STATE_SAVE_TIMEOUT_MS = 5000;

/** The furthest ahead a saved pulse time may be and still be resumed. */
const MAX_RESTORE_AHEAD_MS = 15 * 24 * 60 * 60 * 1000;

/** Unrecognised rate-limit fields whose values describe the account's billing. */
const BILLING_FIELDS = new Set([
  "canUserPurchaseCredits",
  "hasChargeableSavedPaymentMethod",
]);

/** Alert text for a token the API no longer accepts. */
const TOKEN_REJECTED_MESSAGE =
  "Token rejected - run `claude setup-token`, update claudepulse.env and recreate the container";

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
   * @param {{notify: Function}} [options.notifier] - Announces each pulse's window
   * @param {{notify: Function}} [options.alerter] - Alerts when a pulse ran on paid extra usage
   * @param {{nextAllowed: Function, isActive: Function}} [options.workHours] - Limits pulses to working hours
   * @param {{load: Function, save: Function}} [options.stateStore] - Persists the schedule across restarts
   * @param {string} [options.stateFingerprint] - Identifies the scheduling settings; a saved schedule made under other settings is not resumed
   * @param {number} [options.stateSaveTimeoutMs] - How long to wait for a state write before moving on
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
    this.notifier = options.notifier;
    this.alerter = options.alerter;
    this.workHours = options.workHours ?? null;
    this.stateStore = options.stateStore ?? null;
    this.stateFingerprint = options.stateFingerprint ?? "";
    this.stateSaveTimeoutMs =
      options.stateSaveTimeoutMs ?? STATE_SAVE_TIMEOUT_MS;
    // A saved pulse time to resume at startup, used once
    this.restoredNextPulseAt = null;
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
    this.shutdownRequested = false;
    this.lastScheduledTime = null; // track last planned run start
    this.fixedIntervalMs = 5 * 60 * 60 * 1000; // 5 hours
    // Latest rate-limit state reported by a pulse; drives scheduling
    this.rateLimit = null;
    // Names of unknown rate-limit field sets already logged
    this.reportedFieldSets = new Set();

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
          weeklyUsage: result.rateLimit?.weekly?.utilization ?? undefined,
          usingOverage:
            result.rateLimit?.overage?.using === true ? true : undefined,
          timerDurationMs: duration?.ms,
        });

        // Visible at LOG_LEVEL=WARN and without any webhook: this pulse was
        // billed to the account's extra usage credits.
        if (result.rateLimit?.overage?.using === true) {
          this.logger.warn("pulse", "Pulse ran on paid extra usage", {
            limit: blockingLimit(result.rateLimit) ?? undefined,
          });
        }

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
          limit: blockingLimit(result.rateLimit),
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
    this._reportUnrecognisedFields(pulseResult.rateLimit);

    if (pulseResult.success) {
      this.consecutiveFailures = 0;
      this.lastSuccessTime = new Date();
    }

    this._notify(pulseResult);

    // An exhausted allowance means Claude is in use, not that ClaudePulse is
    // broken, so callers do not count it as a failure.
    return { ...pulseResult, limitReached: isLimitReached(pulseResult) };
  }

  /**
   * Resume a saved schedule whose next pulse is still ahead.
   * @returns {Promise<boolean>} Whether a schedule was restored
   */
  async _restoreState() {
    // A time left over from an earlier start is never carried forward.
    this.restoredNextPulseAt = null;
    const saved = await this._loadResumableState();
    if (!saved) {
      return false;
    }
    this.rateLimit = saved.rateLimit;
    this.restoredNextPulseAt = saved.nextPulseAt;
    this.logger.info("startup", "Resuming saved schedule", {
      planned: saved.nextPulseAt.toISOString(),
    });
    return true;
  }

  /**
   * The saved schedule a start would resume, or null. It only reads, so a
   * dry run can report what a real start would do; every reason for not
   * resuming a saved schedule is logged.
   * @returns {Promise<{nextPulseAt: Date, rateLimit: Object|null}|null>}
   */
  async _loadResumableState() {
    if (!this.stateStore) {
      return null;
    }
    try {
      const saved = await this.stateStore.load();
      if (!saved || saved.nextPulseAt <= new Date()) {
        return null;
      }
      // The furthest a real schedule reaches is a weekly limit lifting plus a
      // few days off; beyond that the file was edited or the clock was wrong.
      if (saved.nextPulseAt.getTime() - Date.now() > MAX_RESTORE_AHEAD_MS) {
        this.logger.warn(
          "startup",
          "Ignoring the saved schedule: its pulse time is too far ahead",
          { planned: saved.nextPulseAt.toISOString() },
        );
        return null;
      }
      // A schedule computed under other settings could only delay a pulse the
      // new settings want sooner.
      if (saved.fingerprint !== this.stateFingerprint) {
        this.logger.info(
          "startup",
          "Ignoring the saved schedule: settings changed since it was saved",
        );
        return null;
      }
      // Without a known window the saved time is the next hour, a guess: a
      // restart, for example with a fixed token, should pulse to learn it.
      if (saved.strategy === "discovery") {
        this.logger.info(
          "startup",
          "Ignoring the saved schedule: it was a guess made before any window was known",
        );
        return null;
      }
      return saved;
    } catch (error) {
      this.logger.warn("startup", "Ignoring unreadable state", {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Save the next planned pulse; a failure is logged and never stops pulsing.
   * @param {Date} nextPulseAt
   * @param {string} strategy - What the time is based on
   */
  async _saveState(nextPulseAt, strategy) {
    if (!this.stateStore) {
      return;
    }
    // The wait is bounded: a write that hangs, on a stalled network volume
    // for example, must not keep the next pulse from being scheduled.
    let timer;
    const noAnswer = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no answer after ${this.stateSaveTimeoutMs} ms`)),
        this.stateSaveTimeoutMs,
      );
    });
    try {
      await Promise.race([
        this.stateStore.save({
          nextPulseAt,
          rateLimit: this.rateLimit,
          strategy,
          fingerprint: this.stateFingerprint,
        }),
        noAnswer,
      ]);
    } catch (error) {
      this.logger.warn("schedule", "Could not save state", {
        error: error.message,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Log rate-limit fields ClaudePulse does not understand, once per distinct
   * set of names. They show what a pulse reports in situations not yet
   * handled, such as extra usage.
   * @param {?{unrecognised: ?Object}} rateLimit
   */
  _reportUnrecognisedFields(rateLimit) {
    const fields = rateLimit?.unrecognised;
    if (!fields) {
      return;
    }
    const key = JSON.stringify(Object.keys(fields).sort());
    if (this.reportedFieldSets.has(key)) {
      return;
    }
    this.reportedFieldSets.add(key);

    // The log line is meant to be pasted into an issue, so values that
    // describe the account's billing are replaced.
    const shown = Object.fromEntries(
      Object.entries(fields).map(([name, value]) => [
        name,
        BILLING_FIELDS.has(name) ? "[omitted]" : value,
      ]),
    );
    this.logger.warn("ratelimit", "Unrecognised rate-limit fields", {
      fields: JSON.stringify(shown),
    });
  }

  /**
   * Hand a pulse result to the window notifier and the extra usage alerter,
   * without waiting on either. A notification that fails is logged and never
   * affects the pulse, or the other notification.
   * @param {Object} pulseResult - Result from _sendPulse()
   */
  _notify(pulseResult) {
    this._deliver(this.notifier, pulseResult, "Window notification failed");
    this._deliver(this.alerter, pulseResult, "Extra usage alert failed");
  }

  /**
   * Hand a pulse result to one notifier without waiting on it.
   * @param {?{notify: Function}} target
   * @param {Object} pulseResult
   * @param {string} failureMessage - Logged when the notifier fails
   */
  _deliver(target, pulseResult, failureMessage) {
    if (!target) {
      return;
    }

    Promise.resolve()
      .then(() => target.notify(pulseResult))
      .catch((error) => {
        this.logger.warn("notify", failureMessage, { error: error.message });
      });
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

      // A retry after working hours would open a window nobody uses; the
      // next pulse waits for the working day instead.
      if (attempt > 0 && this.workHours && !this.workHours.isActive(new Date())) {
        this._failCycle("Work hours ended - retries resume on the working day", {
          attempts: attempt,
        });
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
        this._failCycle(TOKEN_REJECTED_MESSAGE, { error: result.error });
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

    // A schedule restored at startup is used once; every later pulse follows
    // the strategies.
    let planned;
    let strategy;
    if (this.restoredNextPulseAt) {
      planned = this.restoredNextPulseAt;
      strategy = "restored";
      this.restoredNextPulseAt = null;
    } else {
      ({ time: planned, strategy } =
        await this.schedulingManager.computeNextRunTime(context));
    }

    // What the time is based on, before work hours move it: a restart
    // resumes it only when it was based on a known window.
    const basis = strategy;

    // Strategies return future times; roll forward defensively if one did not
    let finalTime = planned;
    while (finalTime <= now) {
      finalTime = new Date(finalTime.getTime() + this.fixedIntervalMs);
    }

    // Outside working hours, the pulse waits for the next working day.
    if (this.workHours) {
      const allowed = this.workHours.nextAllowed(finalTime);
      if (allowed.getTime() !== finalTime.getTime()) {
        this.logger.info(
          "schedule",
          `Work hours: next pulse moved from ${DateUtility.formatLocalIso(finalTime)} to ${DateUtility.formatLocalIso(allowed)}`,
        );
        finalTime = allowed;
        strategy = "work_hours";
      }
    }
    this.lastScheduledTime = finalTime;
    await this._saveState(finalTime, basis);

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

    // A real start resumes a resumable saved schedule. Without one, no window
    // is known, so the first pulse would follow the configured start hour or
    // the next hour.
    const saved = await this._loadResumableState();
    const firstPulse =
      saved?.nextPulseAt ??
      this._nextFromInitialPulseHourPlusTen() ??
      this._nextHourPlusTen();
    const optimalNextRun = this.workHours
      ? this.workHours.nextAllowed(firstPulse)
      : firstPulse;
    const intervalMs = optimalNextRun.getTime() - Date.now();

    this.logger.info("dry-run", "Scheduling Analysis", {
      optimalSchedule: optimalNextRun.toISOString(),
      resumedFromState: Boolean(saved),
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

    // A saved schedule replaces the startup pulse: the window it was planned
    // from is still the one running.
    const restored = await this._restoreState();

    // The first pulse reports the current window, which every later pulse is
    // scheduled from. Outside working hours it would open a window nobody
    // uses, so the working day's first pulse is left to the schedule.
    if (!restored && this.config.immediatePulseAfterAuth) {
      const now = new Date();
      if (this.workHours && !this.workHours.isActive(now)) {
        const firstPulse = this.workHours.nextAllowed(now);
        this.logger.info(
          "startup",
          `Outside work hours - no startup pulse; the working day's first pulse is at ${DateUtility.formatLocalIso(firstPulse)}`,
        );
      } else {
        await this._sendInitialPulse();
      }
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
        this._failCycle(
          isUnrecoverableAuthError(result.error)
            ? TOKEN_REJECTED_MESSAGE
            : "Initial pulse failed",
          { error: result.error },
        );
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
}

export default PulseScheduler;
