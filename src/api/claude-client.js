import { formatLocalIso } from "../utils/time-format.js";
import { spawn } from "child_process";
import logger from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { RateLimitParserFactory } from "../utils/rate-limit-parsers.js";

/**
 * Pure Claude CLI Client - No API Calls
 * Relies entirely on Claude Code CLI for authentication and communication
 * The CLI handles all token management internally
 * @class ClaudeClient
 */
export class ClaudeClient {
  /**
   * Factory method to create and initialize a ClaudeClient instance
   * @param {Object} options - Configuration options
   * @param {string} [options.credentialsPath] - Path to credentials file
   * @returns {Promise<ClaudeClient>} Initialized client instance
   */
  static async create(options = {}) {
    const client = new ClaudeClient(options);
    await client._initialize();
    return client;
  }

  constructor(options = {}) {
    this.credentialsPath =
      options.credentialsPath ||
      path.join(os.homedir(), ".claude", ".credentials.json");

    this.logger = logger.child({ component: "claude-cli" });
    this.requestId = 0;
    this.claudeCliPath = null;
    this.rateLimitParser = new RateLimitParserFactory(formatLocalIso);
  }

  async _initialize() {
    this.claudeCliPath = await this._findClaudeCliPath();
    let cliVersion = null;
    try {
      const ver = execSync(`${this.claudeCliPath} --version`, { encoding: "utf8", timeout: 2000 });
      cliVersion = ver.trim();
    } catch {}

    this.logger.info("client", "ClaudeClient initialized with configuration", {
      credentialsPath: this.credentialsPath,
      claudeCliPath: this.claudeCliPath,
      cliVersion,
      loggerComponent: "claude-cli",
      environmentVariables: {
        claudeCliPathOverride: process.env.CLAUDE_CLI_PATH || "not set"
      }
    });
  }

  /**
   * Intelligently find Claude CLI executable path
   * Priority order:
   * 1. CLAUDE_CLI_PATH environment variable
   * 2. Resolve 'claude' from PATH (handling aliases/symlinks)
   * 3. Common installation locations
   * 4. Original hardcoded path (fallback)
   */
  async _findClaudeCliPath() {

    // 1. Check environment variable override
    if (process.env.CLAUDE_CLI_PATH) {
      try {
        await fs.access(process.env.CLAUDE_CLI_PATH);
        this.claudeCliPath = process.env.CLAUDE_CLI_PATH;
        this.logger.debug("path", "Using CLAUDE_CLI_PATH", {
          path: this.claudeCliPath,
        });
        return this.claudeCliPath;
      } catch {
        this.logger.warn("path", "CLAUDE_CLI_PATH not accessible", {
          path: process.env.CLAUDE_CLI_PATH,
        });
      }
    }

    // 2. Resolve 'claude' from PATH (handling symlinks)
    try {
      const whichResult = execSync("which claude", {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      if (whichResult) {
        // Resolve symlinks to get actual executable path
        const resolvedPath = await fs.realpath(whichResult);
        await fs.access(resolvedPath);
        this.claudeCliPath = resolvedPath;
        this.logger.debug("path", "Resolved claude from PATH", {
          whichPath: whichResult,
          resolvedPath: resolvedPath,
        });
        return this.claudeCliPath;
      }
    } catch (error) {
      this.logger.debug("path", "Could not resolve claude from PATH", {
        error: error.message,
      });
    }

    // 3. Check common installation locations
    const commonPaths = [
      path.join(os.homedir(), ".local", "bin", "claude"),
      "/usr/local/bin/claude",
      "/usr/bin/claude",
      "/opt/homebrew/bin/claude",
      path.join(os.homedir(), ".npm-global", "bin", "claude"),
    ];

    for (const candidatePath of commonPaths) {
      try {
        await fs.access(candidatePath);
        this.claudeCliPath = candidatePath;
        this.logger.debug("path", "Found claude at common location", {
          path: candidatePath,
        });
        return this.claudeCliPath;
      } catch {
        // Continue checking other locations
      }
    }

    // 4. Fallback to original hardcoded path
    const fallbackPath = path.join(os.homedir(), ".claude", "local", "claude");
    this.claudeCliPath = fallbackPath;
    this.logger.debug("path", "Using fallback path", { path: fallbackPath });
    return this.claudeCliPath;
  }

  async _executeClaudeCommand(prompt, opts = {}) {
    const silent = !!opts.silent;
    const timer = this.logger.startTimer("claude_command");

    // Mocked responses for testing
    if (process.env.MOCK_CLAUDE_RATE_LIMIT_RESPONSE) {
      if (!silent) this.logger.warn("mock", "Using mocked rate limit response");
      return Promise.resolve({
        stdout: "",
        stderr: "5-hour limit reached ∙ resets 2pm",
        exitCode: 1,
      });
    }

    if (process.env.MOCK_CLAUDE_PING_SUCCESS_RESPONSE) {
      if (!silent) this.logger.warn("mock", "Using mocked pulse success response");
      return Promise.resolve({
        stdout: JSON.stringify({ result: "Pinging back" }),
        stderr: "",
        exitCode: 0,
      });
    }

    const args = [this.claudeCliPath, "--output-format", "json", "-p", prompt];

    const env = { ...process.env };

    return new Promise((resolve, reject) => {
      const childProcess = spawn(args[0], args.slice(1), {
        stdio: ["pipe", "pipe", "pipe"],
        env: env,
      });

      childProcess.stdin.end();

      let stdout = "";
      let stderr = "";

      childProcess.stdout.on("data", (data) => (stdout += data));
      childProcess.stderr.on("data", (data) => (stderr += data));

      childProcess.on("close", (exitCode) => {
        const duration = this.logger.endTimer(timer);
        if (!silent) {
          this.logger.logCli(
            `claude -p "${prompt.substring(0, 50)}..."`,
            exitCode === 0,
            exitCode,
            duration,
          );
        }
        resolve({ stdout, stderr, exitCode });
      });

      childProcess.on("error", (error) => {
        const duration = this.logger.endTimer(timer);
        if (!silent) {
          this.logger.error("command", "CLI process error", {
            error: error.message,
            durationMs: duration?.ms,
          });
        }
        reject(error);
      });
    });
  }

  /**
   * Parse rate limit information from error text using strategy pattern
   * @param {string} errorText - The error message text
   * @returns {Object|null} Rate limit info object or null if not applicable
   */
  _parseRateLimit(errorText) {
    return this.rateLimitParser.parseRateLimit(errorText, this.logger);
  }

  async _parseCliResponse(response, requestId, opts = {}) {
    const silent = !!opts.silent;
    if (response.exitCode === 0 && response.stdout) {
      const message = JSON.parse(response.stdout);
      if (!silent) {
        this.logger.debug("message", "Claude response received", {
          requestId,
          sessionId: message.session_id,
          totalCostUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
          resultLength: message.result?.length || 0,
          result: message.result,
        });
      }

      return {
        success: true,
        message,
        exitCode: response.exitCode,
      };
    }

    const errorOutput = response.stderr || response.stdout;

    if (!silent) {
      const isAuthError = (errorOutput || "").includes("Invalid API key · Please run /login");
      const logFn = isAuthError ? this.logger.warn.bind(this.logger) : this.logger.error.bind(this.logger);
      logFn("message", "Chat failed", {
        requestId,
        exitCode: response.exitCode,
        error: errorOutput,
      });
    }
    const rateLimitInfo = this._parseRateLimit(errorOutput);

    return {
      success: false,
      error: errorOutput,
      exitCode: response.exitCode,
      rateLimitReached: !!rateLimitInfo,
      rateLimitInfo,
    };
  }

  async sendMessage(prompt, opts = {}) {
    const requestId = ++this.requestId;
    if (!opts.silent) {
      this.logger.debug("message", "Sending message to Claude", {
        requestId,
        prompt,
        promptLength: prompt.length,
      });
    }

    try {
      const response = await this._executeClaudeCommand(prompt, opts);
      return this._parseCliResponse(response, requestId, opts);
    } catch (error) {
      if (!opts.silent) {
        this.logger.error("message", "Chat exception", {
          requestId,
          error: error.message,
        });
      }
      return {
        success: false,
        error: error.message,
        exitCode: -1,
      };
    }
  }

  async pulse(message = "pulse check") {
    this.logger.info("pulse", "Sending pulse message", { message });
    const result = await this.sendMessage(message);
    this.logger.info("pulse", "Pulse completed", {
      success: result.success,
      error: result.error,
    });
    return result;
  }

  async login() {
    this.logger.info("auth", "Please run 'claude' and then type '/login' in the interactive prompt to authenticate.");
    return Promise.resolve({ success: true });
  }

  async testConnection(opts = { silent: true }) {
    try {
      const result = await this.sendMessage("Connection test", opts);
      const success = result.success;
      if (!opts.silent) {
        this.logger.info(
          "test",
          `Connection test ${success ? "successful" : "failed"}`,
          {
            error: result.error,
          },
        );
      }

      return {
        success,
        message: `Claude CLI connection ${
          success ? "working correctly" : "test failed"
        }`,
        data: result.message,
        error: result.error,
        rateLimitReached: result.rateLimitReached,
        rateLimitInfo: result.rateLimitInfo,
      };
    } catch (error) {
      if (!opts.silent) {
        this.logger.error("test", "Connection test error", {
          error: error.message,
        });
      }
      return {
        success: false,
        message: "Connection test encountered an error",
        error: error.message,
      };
    }
  }

  async getAuthStatus() {
    const connectionTest = await this.testConnection({ silent: true });
    this.logger.debug("auth", "Connection test result", { connectionTest });

    if (connectionTest.success) {
      this.logger.info("auth", "Authentication successful");
      return {
        authenticated: true,
        message: "Authentication successful",
        approach: "pure-cli",
      };
    }

    // If the known authentication failure string is present, treat as not authenticated
    if ((connectionTest.error || "").includes("Invalid API key · Please run /login")) {
      return {
        authenticated: false,
        message: "Authentication failed",
        error: connectionTest.error,
      };
    }

    if (connectionTest.rateLimitReached) {
      return {
        authenticated: true,
        rateLimitReached: true,
        message: "Rate limit reached",
        error: connectionTest.error,
        rateLimitInfo: connectionTest.rateLimitInfo,
      };
    }

    this.logger.warn("auth", "Authentication failed", {
      error: connectionTest.error,
    });
    return {
      authenticated: false,
      message: "Authentication failed",
      error: connectionTest.error,
    };
  }

  getCredentialsPath() {
    return this.credentialsPath;
  }
}

export default ClaudeClient;
