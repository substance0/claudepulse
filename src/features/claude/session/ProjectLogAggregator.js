import logger from "../../../core/utils/logger.js";
import { DateUtility } from "../../../core/utils/DateUtility.js";
import SessionLimitParser from "../../../core/utils/SessionLimitParser.js";

/**
 * Project Log Aggregator (I/O Layer)
 *
 * Responsibilities:
 * - Reads JSONL files from all Claude projects
 * - Collects messages from all projects
 * - Parses cycle limit messages from assistant responses
 * - Tracks individual Claude sessions (sessionId -> session data)
 */
export class ProjectLogAggregator {
  constructor(options = {}) {
    // Validate required dependencies
    if (!options.logReader) {
      throw new Error("ProjectLogAggregator requires logReader dependency");
    }

    this.logReader = options.logReader;
    this.logger = logger.child({ component: "project-log-aggregator" });
    this.sessions = new Map(); // sessionId -> session data
    this.activeSession = null;
    this.dateUtility = new DateUtility(options);
    this.allProjectsMessages = []; // Flat list of message activities across all projects
    this.sessionLimitParser = new SessionLimitParser(
      DateUtility.formatLocalIso,
    );
    this.latestCycleLimitReset = null; // Store latest detected cycle limit reset time
  }

  /**
   * Process all log entries from ClaudeLogReader
   */
  async _processAllLogEntries() {
    const entries = await this.logReader.readAllLogEntries();

    for (const data of entries) {
      if (data && data.sessionId && data.timestamp) {
        this._processSessionData(data);
        // Capture message-level activity for cycle computation
        const type = data.type?.toLowerCase?.();
        if (type === "user" || type === "assistant") {
          this.allProjectsMessages.push({
            sessionId: data.sessionId,
            timestamp: data.timestamp,
            type: data.type,
          });
        }

        // Check for cycle limit messages in assistant responses
        // Only process API error messages (isApiErrorMessage: true)
        // to avoid false positives from discussion about limits
        if (type === "assistant" && data.isApiErrorMessage && data.message) {
          let text = "";
          // Extract text from message content array
          if (Array.isArray(data.message.content)) {
            for (const item of data.message.content) {
              if (item.type === "text" && item.text) {
                text += item.text;
              }
            }
          }
          // Handle older format where content might be a string
          if (typeof data.message.content === "string") {
            text = data.message.content;
          }
          if (text) {
            this._checkForCycleLimit(text, data.timestamp);
          }
        }
      }
    }
  }

  /**
   * Check if a message contains cycle limit information
   * @param {string} text - Message text to check
   * @param {string} messageTimestamp - When the message was sent
   */
  _checkForCycleLimit(text, messageTimestamp) {
    // Parse cycle limit using message timestamp as reference
    // This ensures "resets 2pm" is interpreted relative to when the message was sent
    const limitInfo = this.sessionLimitParser.parseSessionLimit(
      text,
      this.logger,
      messageTimestamp,
    );
    if (limitInfo && limitInfo.resetAt) {
      const msgTime = new Date(messageTimestamp);

      // Always keep the MOST RECENT limit message (latest message timestamp)
      // This reflects the current account configuration
      if (
        !this.latestCycleLimitReset ||
        msgTime > new Date(this.latestCycleLimitReset.messageTimestamp)
      ) {
        const isMoreRecent = this.latestCycleLimitReset != null;

        this.latestCycleLimitReset = {
          resetAt: limitInfo.resetAt,
          messageTimestamp: messageTimestamp,
          method: limitInfo.method,
        };

        this.logger.debug(
          "cycle-limit",
          isMoreRecent
            ? "Detected cycle limit from historical logs (more recent)"
            : "Detected cycle limit from historical logs",
          {
            resetAt: limitInfo.resetAt,
            messageTimestamp: messageTimestamp,
            text: text.substring(0, 100),
          },
        );
      }
    }
  }

  /**
   * Process individual session data entry
   */
  _processSessionData(data) {
    const { sessionId, timestamp, type } = data;

    // Parse timestamp with timezone handling
    const parsedTimestamp = this.dateUtility.parseTimestamp(timestamp);
    if (
      !parsedTimestamp ||
      !this.dateUtility.validateTimestamp(parsedTimestamp)
    ) {
      this.logger.debug("process", "Skipping invalid timestamp", {
        sessionId,
        timestamp,
        parsed: parsedTimestamp,
      });
      return;
    }

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        startTime: parsedTimestamp,
        lastActivity: parsedTimestamp,
        messageCount: 0,
        isActive: false,
      });
    }

    const session = this.sessions.get(sessionId);

    // Update session data with proper timezone comparison
    const currentActivity = this.dateUtility.ensureUTC(parsedTimestamp);
    const lastActivity = this.dateUtility.ensureUTC(session.lastActivity);

    if (currentActivity > lastActivity) {
      session.lastActivity = parsedTimestamp;
    }

    if (type === "user" || type === "assistant") {
      session.messageCount++;
    }

    // Consider session active if last activity was within 5 hours
    const now = this.dateUtility.now();
    const fiveHoursAgo = this.dateUtility.addTime(now, -5 * 60 * 60 * 1000);
    const lastActivityTime = this.dateUtility.ensureUTC(session.lastActivity);

    session.isActive = lastActivityTime > fiveHoursAgo;

    this.sessions.set(sessionId, session);
  }

  /**
   * Find the most recent active session (for display purposes)
   */
  getActiveSession() {
    let mostRecentSession = null;
    let mostRecentTime = new Date(0);

    for (const session of this.sessions.values()) {
      const sessionTime = this.dateUtility.ensureUTC(session.lastActivity);
      if (session.isActive && sessionTime > mostRecentTime) {
        mostRecentSession = session;
        mostRecentTime = sessionTime;
      }
    }

    this.activeSession = mostRecentSession;
    return mostRecentSession;
  }

  /**
   * Update project log aggregation by reading all log files
   */
  async updateAggregation() {
    // Ensure data path exists; skip tracking entirely if not
    const dataPath = await this.logReader.discoverClaudeDataPaths();
    if (!dataPath) {
      // Only log once when first discovering there's no data directory
      if (!this._loggedNoDataDir) {
        this.logger.info(
          "config",
          "Claude project log parsing disabled (no Claude data directory found)",
        );
        this._loggedNoDataDir = true;
      }

      this.sessions.clear();
      this.allProjectsMessages = [];
      this.latestCycleLimitReset = null;
      this.logger.debug(
        "update",
        "Skipping aggregation (no Claude data directory)",
      );
      return { totalSessions: 0, activeSessions: 0, activeSession: null };
    }

    // Log once when data directory is found
    if (!this._loggedDataDir) {
      this.logger.debug("path", "Found Claude data directory", {
        path: dataPath,
      });
      this._loggedDataDir = true;
    }

    this.logger.debug(
      "update",
      "Updating project log aggregation across all projects",
    );

    // Clear existing data to get fresh aggregation
    this.sessions.clear();
    this.allProjectsMessages = [];

    // Process all log entries from ClaudeLogReader
    await this._processAllLogEntries();

    const activeSession = this.getActiveSession();
    const sessionCount = this.sessions.size;
    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.isActive,
    );

    this.logger.info("update", "Project log aggregation updated", {
      totalSessions: sessionCount,
      activeSessions: activeSessions.length,
      activeSessionId: activeSession?.id,
      messagesCollected: this.allProjectsMessages.length,
      cycleLimitFound: this.latestCycleLimitReset != null,
    });

    // Log the final most recent cycle limit found
    if (this.latestCycleLimitReset) {
      this.logger.info(
        "cycle-limit",
        "Most recent cycle limit from historical logs",
        {
          resetAt: this.latestCycleLimitReset.resetAt,
          messageTimestamp: this.latestCycleLimitReset.messageTimestamp,
        },
      );
    }

    return {
      totalSessions: sessionCount,
      activeSessions: activeSessions.length,
      activeSession,
    };
  }

  /**
   * Get aggregation status
   */
  getStatus() {
    const activeSession = this.getActiveSession();

    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(
        (s) => s.isActive,
      ).length,
      activeSession: activeSession
        ? {
            id: activeSession.id,
            startTime: activeSession.startTime,
            lastActivity: activeSession.lastActivity,
            messageCount: activeSession.messageCount,
            isActive: activeSession.isActive,
          }
        : null,
      messagesCollected: this.allProjectsMessages.length,
      cycleLimitFound: this.latestCycleLimitReset != null,
    };
  }
}

export default ProjectLogAggregator;
