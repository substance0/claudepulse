import fs from "fs/promises";
import path from "path";
import os from "os";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import logger from "./logger.js";
import TimezoneHandler from "./timezone-handler.js";
import CycleDetector from "./cycle-detection.js";

/**
 * Claude Session Tracker
 * Tracks Claude sessions by parsing local JSONL data files
 * Calculates 5-hour rolling windows for session limits
 */
export class SessionTracker {
  constructor(options = {}) {
    this.claudeDataPath = options.claudeDataPath || path.join(os.homedir(), ".claude", "projects");
    this.logger = logger.child({ component: "session-tracker" });
    this.sessions = new Map(); // sessionId -> session data
    this.currentSession = null;
    this.timezoneHandler = new TimezoneHandler(options);
    this.messages = []; // Flat list of message activities across sessions
    this.cycleDetector = new CycleDetector({ timezoneHandler: this.timezoneHandler });
    this.lastKnownCycleStart = null;
    this.lastKnownExpiry = null;
  }

  /**
   * Discover Claude data directories
   */
  async discoverClaudeDataPaths() {
    const possiblePaths = [
      path.join(os.homedir(), ".claude", "projects"),
      path.join(os.homedir(), ".config", "claude", "projects"),
    ];

    for (const candidatePath of possiblePaths) {
      try {
        const stat = await fs.stat(candidatePath);
        if (stat.isDirectory()) {
          this.claudeDataPath = candidatePath;
          this.logger.debug("path", "Found Claude data directory", { path: candidatePath });
          return candidatePath;
        }
      } catch (error) {
        // Continue checking other paths
      }
    }

    this.logger.warn("path", "No Claude data directory found, using default", {
      path: this.claudeDataPath
    });
    return this.claudeDataPath;
  }

  /**
   * Get current working directory project path
   */
  _getProjectPath() {
    const cwd = process.cwd();
    // Convert /Users/hugo/git/claudepulse -> -Users-hugo-git-claudepulse
    const projectDir = cwd.replace(/\//g, "-");
    return path.join(this.claudeDataPath, projectDir);
  }

  /**
   * Parse a single JSONL line
   */
  _parseJsonLine(line) {
    try {
      return JSON.parse(line.trim());
    } catch (error) {
      this.logger.debug("parse", "Failed to parse JSONL line", {
        error: error.message,
        line: line.substring(0, 100) + "..."
      });
      return null;
    }
  }

  /**
   * Process JSONL files in all project directories
   */
  async _processAllProjectFiles() {
    try {
      const claudeDataPath = await this.discoverClaudeDataPaths();
      const projectDirs = await fs.readdir(claudeDataPath);

      this.logger.debug("scan", "Scanning Claude data", {
        dir: claudeDataPath,
        projectCount: projectDirs.length,
      });

      for (const projectDir of projectDirs) {
        const projectPath = path.join(claudeDataPath, projectDir);
        try {
          const stat = await fs.stat(projectPath);
          if (stat.isDirectory()) {
            await this._processProjectFiles(projectPath);
          }
        } catch (error) {
          this.logger.debug("scan", "Skipping invalid project directory", {
            projectDir,
            error: error.message
          });
        }
      }
    } catch (error) {
      this.logger.error("scan", "Failed to scan project directories", {
        error: error.message
      });
    }
  }

  /**
   * Process JSONL files in project directory
   */
  async _processProjectFiles(projectPath) {
    try {
      const files = await fs.readdir(projectPath);
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

      this.logger.debug("files", "Found JSONL files", {
        projectPath,
        count: jsonlFiles.length,
      });

      for (const file of jsonlFiles) {
        await this._processJsonlFile(path.join(projectPath, file));
      }
    } catch (error) {
      this.logger.error("process", "Failed to process project files", {
        projectPath,
        error: error.message
      });
    }
  }

  /**
   * Process a single JSONL file
   */
  async _processJsonlFile(filePath) {
    try {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim()) {
          const data = this._parseJsonLine(line);
          if (data && data.sessionId && data.timestamp) {
            this._processSessionData(data);
            // Capture message-level activity for cycle detection
            const type = data.type?.toLowerCase?.();
            if (type === "user" || type === "assistant") {
              this.messages.push({
                sessionId: data.sessionId,
                timestamp: data.timestamp,
                type: data.type,
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error("file", "Failed to process JSONL file", {
        filePath,
        error: error.message
      });
    }
  }

  /**
   * Process individual session data entry
   */
  _processSessionData(data) {
    const { sessionId, timestamp, type } = data;

    // Parse timestamp with timezone handling
    const parsedTimestamp = this.timezoneHandler.parseTimestamp(timestamp);
    if (!parsedTimestamp || !this.timezoneHandler.validateTimestamp(parsedTimestamp)) {
      this.logger.debug("process", "Skipping invalid timestamp", {
        sessionId,
        timestamp,
        parsed: parsedTimestamp
      });
      return;
    }

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        startTime: parsedTimestamp,
        lastActivity: parsedTimestamp,
        messageCount: 0,
        isActive: false
      });
    }

    const session = this.sessions.get(sessionId);

    // Update session data with proper timezone comparison
    const currentActivity = this.timezoneHandler.ensureUTC(parsedTimestamp);
    const lastActivity = this.timezoneHandler.ensureUTC(session.lastActivity);

    if (currentActivity > lastActivity) {
      session.lastActivity = parsedTimestamp;
    }

    if (type === "user" || type === "assistant") {
      session.messageCount++;
    }

    // Consider session active if last activity was within 5 hours
    const now = this.timezoneHandler.now();
    const fiveHoursAgo = this.timezoneHandler.addTime(now, -5 * 60 * 60 * 1000);
    const lastActivityTime = this.timezoneHandler.ensureUTC(session.lastActivity);

    session.isActive = lastActivityTime > fiveHoursAgo;

    this.sessions.set(sessionId, session);
  }

  /**
   * Round timestamp to the nearest full hour in UTC
   */
  _roundToHour(timestamp) {
    const d = this.timezoneHandler.ensureUTC(new Date(timestamp));
    d.setUTCMinutes(0, 0, 0); // Floor to the hour (UTC)
    return d;
  }

  /**
   * Find the first activity that started the current 5-hour cycle
   * Claude Pro/Max's 5-hour limit starts with the FIRST message after a reset, not the last
   */
  getCurrentCycleStart() {
    const now = this.timezoneHandler.now();

    // Build blocks from historical messages (long look-back implicitly by reading all files)
    const blocks = this.cycleDetector.buildBlocks(this.messages);
    const currentBlock = this.cycleDetector.findCurrentBlock(blocks, now);

    if (currentBlock) {
      const cycleStartRounded = this._roundToHour(currentBlock.firstMessageAt);
      this.logger.debug("cycle-start", "Computed current 5-hour cycle start", {
        cycleStartTime: cycleStartRounded.toISOString(),
        firstMessageUTC: currentBlock.firstMessageAt.toISOString(),
      });

      // Choose a representative session for return compatibility (most recent active)
      const mostRecent = this.getCurrentSession();
      return {
        session: mostRecent || { id: "global" },
        timestamp: cycleStartRounded,
        firstMessageAt: currentBlock.firstMessageAt,
      };
    }

    // If no active block but we have an explicit upcoming reset time, report that no current cycle
    const signals = this.cycleDetector.getSignals();
    if (signals.explicitNextCycleStartAt && now < signals.explicitNextCycleStartAt) {
      this.logger.debug("cycle-start", "No active cycle; explicit next cycle start known", {
        nextCycleStart: signals.explicitNextCycleStartAt.toISOString(),
        blocksCount: blocks.length,
      });
    } else {
      this.logger.debug("cycle-start", "No active 5-hour cycle found", {
        blocksCount: blocks.length,
      });
    }

    return null;
  }

  /**
   * Find the most recent activity across ALL sessions (for reference)
   */
  getLastGlobalActivity() {
    let lastGlobalActivity = null;
    let mostRecentTime = new Date(0);

    for (const session of this.sessions.values()) {
      const sessionTime = this.timezoneHandler.ensureUTC(session.lastActivity);
      if (sessionTime > mostRecentTime) {
        lastGlobalActivity = {
          session: session,
          timestamp: session.lastActivity
        };
        mostRecentTime = sessionTime;
      }
    }

    return lastGlobalActivity;
  }

  /**
   * Find the most recent active session (for display purposes)
   */
  getCurrentSession() {
    let mostRecentSession = null;
    let mostRecentTime = new Date(0);

    for (const session of this.sessions.values()) {
      const sessionTime = this.timezoneHandler.ensureUTC(session.lastActivity);
      if (session.isActive && sessionTime > mostRecentTime) {
        mostRecentSession = session;
        mostRecentTime = sessionTime;
      }
    }

    this.currentSession = mostRecentSession;
    return mostRecentSession;
  }

  /**
   * Calculate when the current Claude Pro/Max 5-hour cycle expires
   * The cycle starts with the FIRST message after a reset and lasts exactly 5 hours
   * Windows are aligned on hour boundaries; we floor the first message time to the hour (UTC)
   */
  getGlobalCycleExpiry() {
    const now = this.timezoneHandler.now();
    const blocks = this.cycleDetector.buildBlocks(this.messages);
    const current = this.cycleDetector.findCurrentBlock(blocks, now);

    if (!current) {
      return null;
    }

    // Cycle end is exactly 5 hours after floored block start
    const startRounded = this._roundToHour(current.firstMessageAt);
    const expiry = new Date(startRounded.getTime() + 5 * 60 * 60 * 1000);

    return expiry;
  }

  /**
   * Legacy method for compatibility - redirects to global cycle expiry
   */
  getSessionWindowExpiry() {
    return this.getGlobalCycleExpiry();
  }

  /**
   * Calculate time remaining in current session window
   */
  getTimeToReset() {
    const expiry = this.getSessionWindowExpiry();
    if (!expiry) {
      return null;
    }

    const now = this.timezoneHandler.now();
    const timeRemaining = this.timezoneHandler.getTimeDifference(expiry, now);

    return {
      totalMs: timeRemaining,
      hours: Math.floor(timeRemaining / (60 * 60 * 1000)),
      minutes: Math.floor((timeRemaining % (60 * 60 * 1000)) / (60 * 1000)),
      isExpired: timeRemaining <= 0
    };
  }

  /**
   * Update session tracking by scanning all project files
   */
  async updateSessionTracking() {
    this.logger.debug("update", "Updating session tracking across all projects");

    // Clear existing sessions to get fresh data
    this.sessions.clear();
    this.messages = [];

    // Process all project directories to find active sessions
    await this._processAllProjectFiles();

    const currentSession = this.getCurrentSession();
    const sessionCount = this.sessions.size;
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.isActive);

    // Compute current cycle start + expiry and log only on change
    const currentStartObj = this.getCurrentCycleStart();
    const currentStart = currentStartObj?.timestamp || null;
    const currentExpiry = this.getSessionWindowExpiry();

    const prevStartMs = this.lastKnownCycleStart?.getTime?.();
    const prevExpiryMs = this.lastKnownExpiry?.getTime?.();
    const newStartMs = currentStart?.getTime?.();
    const newExpiryMs = currentExpiry?.getTime?.();

    const changed = prevStartMs !== newStartMs || prevExpiryMs !== newExpiryMs;
    if (changed) {
      this.logger.info("expiry", "Calculated global Claude subscription cycle expiry", {
        cycleStartUTC: currentStart ? currentStart.toISOString() : null,
        hourBoundaryExpiry: currentExpiry ? currentExpiry.toISOString() : null,
        firstMessageUTC: currentStartObj?.firstMessageAt ? currentStartObj.firstMessageAt.toISOString() : null,
      });
      this.lastKnownCycleStart = currentStart || null;
      this.lastKnownExpiry = currentExpiry || null;
    }

    this.logger.info("update", "Session tracking updated", {
      totalSessions: sessionCount,
      activeSessions: activeSessions.length,
      currentSessionId: currentSession?.id,
      currentSessionStart: currentSession?.startTime?.toISOString(),
      currentSessionLastActivity: currentSession?.lastActivity?.toISOString(),
      windowExpiry: currentExpiry?.toISOString(),
      timezone: this.timezoneHandler.getStatus()
    });

    return {
      totalSessions: sessionCount,
      currentSession,
      timeToReset: this.getTimeToReset()
    };
  }

  /**
   * Get session tracking status
   */
  getStatus() {
    const currentSession = this.getCurrentSession();
    const timeToReset = this.getTimeToReset();
    const windowExpiry = this.getSessionWindowExpiry();

    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(s => s.isActive).length,
      currentSession: currentSession ? {
        id: currentSession.id,
        startTime: currentSession.startTime,
        lastActivity: currentSession.lastActivity,
        messageCount: currentSession.messageCount,
        isActive: currentSession.isActive
      } : null,
      windowExpiry: windowExpiry?.toISOString(),
      timeToReset: timeToReset ? {
        hours: timeToReset.hours,
        minutes: timeToReset.minutes,
        isExpired: timeToReset.isExpired
      } : null
    };
  }

  // Self-correction integration points
  registerRateLimitSignal(info = {}) {
    if (info.resetAt) {
      const date = new Date(info.resetAt);
      if (!isNaN(date.getTime())) {
        this.cycleDetector.registerExplicitResetTime(date);
        return;
      }
    }
    this.cycleDetector.registerGenericLimitSignal();
  }
}

export default SessionTracker;