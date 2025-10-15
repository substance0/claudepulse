import fs from "fs/promises";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import path from "path";
import os from "os";

/**
 * Claude Log Reader Service
 * Handles reading and parsing of Claude's .jsonl log files
 * Decouples file system operations from SessionTracker business logic
 */
export class ClaudeLogReader {
  /**
   * Create ClaudeLogReader instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {string} [options.claudeDataPath] - Override default Claude data path
   */
  constructor({ logger, claudeDataPath }) {
    if (!logger) {
      throw new Error("ClaudeLogReader requires logger dependency");
    }

    this.logger = logger;
    this.claudeDataPath = claudeDataPath;
  }

  /**
   * Discover Claude data directories
   * @returns {Promise<string|null>} Path to Claude data directory or null if not found
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
          return candidatePath;
        }
      } catch (error) {
        // Continue checking other paths
      }
    }

    // No Claude data directory present
    this.claudeDataPath = null;
    return null;
  }

  /**
   * Parse a single JSONL line
   * @param {string} line - Raw JSONL line
   * @returns {Object|null} Parsed JSON object or null if invalid
   */
  parseJsonLine(line) {
    try {
      return JSON.parse(line.trim());
    } catch (error) {
      this.logger.debug("parse", "Failed to parse JSONL line", {
        error: error.message,
        line: line.substring(0, 100) + "...",
      });
      return null;
    }
  }

  /**
   * Read and parse all entries from all project JSONL files
   * @returns {Promise<Array>} Array of parsed log entries
   */
  async readAllLogEntries() {
    const entries = [];

    const claudeDataPath = await this.discoverClaudeDataPaths();
    if (!claudeDataPath) {
      return entries; // Empty array when no data path
    }

    try {
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
            const projectEntries =
              await this.readProjectLogEntries(projectPath);
            entries.push(...projectEntries);
          }
        } catch (error) {
          this.logger.debug("scan", "Skipping invalid project directory", {
            projectDir,
            error: error.message,
          });
        }
      }
    } catch (error) {
      this.logger.debug(
        "scan",
        "No Claude project directories found or unreadable",
        {
          error: error.message,
        },
      );
    }

    return entries;
  }

  /**
   * Read and parse log entries from a specific project directory
   * @param {string} projectPath - Path to project directory
   * @returns {Promise<Array>} Array of parsed log entries from this project
   */
  async readProjectLogEntries(projectPath) {
    const entries = [];

    try {
      const files = await fs.readdir(projectPath);
      const jsonlFiles = files.filter((file) => file.endsWith(".jsonl"));

      this.logger.debug("files", "Found JSONL files", {
        projectPath,
        count: jsonlFiles.length,
      });

      for (const file of jsonlFiles) {
        const fileEntries = await this.readJsonlFile(
          path.join(projectPath, file),
        );
        entries.push(...fileEntries);
      }
    } catch (error) {
      this.logger.error("process", "Failed to read project log files", {
        projectPath,
        error: error.message,
      });
    }

    return entries;
  }

  /**
   * Read and parse a single JSONL file
   * @param {string} filePath - Path to JSONL file
   * @returns {Promise<Array>} Array of parsed entries from this file
   */
  async readJsonlFile(filePath) {
    const entries = [];

    try {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (line.trim()) {
          const data = this.parseJsonLine(line);
          if (data) {
            entries.push(data);
          }
        }
      }
    } catch (error) {
      this.logger.error("file", "Failed to read JSONL file", {
        filePath,
        error: error.message,
      });
    }

    return entries;
  }

  /**
   * Get current Claude data path
   * @returns {string|null}
   */
  getClaudeDataPath() {
    return this.claudeDataPath;
  }
}

export default ClaudeLogReader;
