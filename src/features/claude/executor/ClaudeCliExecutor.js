/** Model used for pulses. A pulse needs no capability, only a session. */
const PULSE_MODEL = "haiku";

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
}
