import { spawn } from "node:child_process";

/** Model used for pulses. A pulse needs no capability, only a session. */
const PULSE_MODEL = "haiku";

/**
 * Detect an authentication failure that retrying cannot resolve.
 * These need a human to re-authenticate, so further attempts only waste a
 * cycle. A credential is never validated up front, so this is the point at
 * which an expired or rejected one becomes visible.
 * @param {string} text - Error text from the CLI
 * @returns {boolean}
 */
function isAuthFailure(text) {
  if (!text) {
    return false;
  }

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
 * Parse `--output-format stream-json` output into its JSON lines.
 * Lines that are not JSON are skipped rather than failing the whole parse.
 * @param {string} stdout - Raw subprocess output
 * @returns {Object[]} Parsed lines, in order
 */
function parseJsonLines(stdout) {
  const lines = [];

  for (const line of (stdout || "").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      lines.push(JSON.parse(line));
    } catch {
      // A stray non-JSON line (a shell warning, say) carries nothing we use.
    }
  }

  return lines;
}

/**
 * Convert an epoch-seconds value to a Date.
 * @param {number|undefined} seconds
 * @returns {Date|null}
 */
function fromEpochSeconds(seconds) {
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

/**
 * Extract the rate-limit state from the last rate_limit_event in a stream.
 *
 * Only `status`, `resetsAt` and `utilization` are documented. `rateLimitType`
 * and `unifiedWindows` appear in real output but are not, so they are read
 * when present and never required.
 * @param {Object[]} lines - Parsed stream lines
 * @returns {{status: string, resetsAt: Date|null, fiveHourResetsAt: Date|null}|null}
 */
function extractRateLimit(lines) {
  const event = lines
    .filter((line) => line.type === "rate_limit_event")
    .at(-1);

  const info = event?.rate_limit_info;
  if (!info) {
    return null;
  }

  // resetsAt names the 5-hour window only when the event says so, or says
  // nothing about which window it describes.
  const resetsAtIsFiveHour =
    info.rateLimitType === undefined || info.rateLimitType === "five_hour";

  return {
    status: info.status,
    resetsAt: fromEpochSeconds(info.resetsAt),
    fiveHourResetsAt:
      fromEpochSeconds(info.unifiedWindows?.five_hour?.resetsAt) ??
      (resetsAtIsFiveHour ? fromEpochSeconds(info.resetsAt) : null),
  };
}

/**
 * Runs Claude Code as a subprocess to open a session window.
 *
 * The argument list is deliberately fixed. Two omissions are load-bearing:
 * `--bare` stops the CLI reading CLAUDE_CODE_OAUTH_TOKEN, and overriding the
 * system prompt voids the prompt cache, which measured 3.8x more expensive
 * because a custom prompt no longer matches the cached prefix.
 */
export class ClaudeCliExecutor {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {string} options.cwd - Empty directory the subprocess runs in
   * @param {string} [options.configDir] - Config directory for the CLI
   * @param {string} [options.binary] - Path to the Claude CLI
   */
  constructor(options = {}) {
    if (!options.logger) {
      throw new Error("ClaudeCliExecutor requires logger dependency");
    }
    if (!options.cwd) {
      throw new Error("ClaudeCliExecutor requires cwd dependency");
    }

    this.logger = options.logger;
    this.cwd = options.cwd;
    this.configDir = options.configDir;
    this.binary = options.binary || "claude";
  }

  /**
   * Run one pulse.
   * @param {string} promptText - Message sent to Claude
   * @returns {Promise<{success: boolean, authFailure: boolean, message?: Object, error?: string}>}
   */
  async pulse(promptText) {
    const args = ClaudeCliExecutor.buildArgs(promptText);

    return new Promise((resolve) => {
      const child = spawn(this.binary, args, {
        cwd: this.cwd,
        env: {
          ...process.env,
          // Thinking accounted for 148 of 169 output tokens by default, and a
          // pulse has nothing to reason about.
          MAX_THINKING_TOKENS: "0",
          // Inheriting the host's config directory loads whatever skills,
          // plugins and agents live there, which measured 2.4x more expensive.
          ...(this.configDir ? { CLAUDE_CONFIG_DIR: this.configDir } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("error", (err) => {
        resolve(
          ClaudeCliExecutor.parseResult({
            stdout: "",
            stderr: err.message,
            exitCode: 127,
          }),
        );
      });

      child.on("close", (exitCode) => {
        resolve(ClaudeCliExecutor.parseResult({ stdout, stderr, exitCode }));
      });
    });
  }

  /**
   * Build the fixed argument list for a pulse.
   * @param {string} promptText - Message sent to Claude
   * @returns {string[]} Arguments for the Claude CLI
   */
  static buildArgs(promptText) {
    return [
      "-p",
      promptText,
      "--model",
      PULSE_MODEL,
      "--strict-mcp-config",
      "--settings",
      "{}",
      "--no-session-persistence",
      // stream-json carries the rate_limit_event, which reports when the
      // 5-hour window resets. The CLI rejects it in print mode without
      // --verbose.
      "--output-format",
      "stream-json",
      "--verbose",
    ];
  }

  /**
   * Convert raw subprocess output into a pulse result.
   * @param {Object} raw - Raw subprocess output
   * @param {string} raw.stdout - Standard output, expected to hold JSON
   * @param {string} raw.stderr - Standard error
   * @param {number} raw.exitCode - Process exit code
   * @returns {{success: boolean, authFailure: boolean, rateLimit: Object|null, message?: Object, error?: string}}
   */
  static parseResult({ stdout, stderr, exitCode }) {
    const lines = parseJsonLines(stdout);
    const result = lines.filter((line) => line.type === "result").at(-1);
    const rateLimit = extractRateLimit(lines);

    if (result && !result.is_error && exitCode === 0) {
      return {
        success: true,
        authFailure: false,
        rateLimit,
        message: {
          total_cost_usd: result.total_cost_usd,
          duration_ms: result.duration_ms,
          session_id: result.session_id,
        },
      };
    }

    const detail = result?.result || stderr || "Claude CLI failed";

    return {
      success: false,
      authFailure: isAuthFailure(detail),
      rateLimit,
      error: detail,
    };
  }
}
