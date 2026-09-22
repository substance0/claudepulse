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
        // Thinking accounted for 148 of 169 output tokens by default, and a
        // pulse has nothing to reason about.
        env: { ...process.env, MAX_THINKING_TOKENS: "0" },
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
      "--output-format",
      "json",
    ];
  }

  /**
   * Convert raw subprocess output into a pulse result.
   * @param {Object} raw - Raw subprocess output
   * @param {string} raw.stdout - Standard output, expected to hold JSON
   * @param {string} raw.stderr - Standard error
   * @param {number} raw.exitCode - Process exit code
   * @returns {{success: boolean, authFailure: boolean, message?: Object, error?: string}}
   */
  static parseResult({ stdout, stderr, exitCode }) {
    let parsed = null;

    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = null;
    }

    if (parsed && !parsed.is_error && exitCode === 0) {
      return {
        success: true,
        authFailure: false,
        message: {
          total_cost_usd: parsed.total_cost_usd,
          duration_ms: parsed.duration_ms,
          session_id: parsed.session_id,
        },
      };
    }

    const detail = parsed?.result || stderr || "Claude CLI failed";

    return {
      success: false,
      authFailure: isAuthFailure(detail),
      error: detail,
    };
  }
}
