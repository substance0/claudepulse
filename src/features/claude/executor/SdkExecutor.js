import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";

/**
 * SDK Executor Service
 * Thin wrapper around Anthropic Claude Agent SDK's query function
 * Handles streaming of SDK messages and aggregates responses
 *
 * Returns data in stdout/stderr/exitCode format for compatibility
 * with existing ClaudeClient interface.
 */
export class SdkExecutor {
  /**
   * Create SdkExecutor instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   */
  constructor({ logger }) {
    if (!logger) {
      throw new Error("SdkExecutor requires logger dependency");
    }
    this.logger = logger;
  }

  /**
   * Execute SDK query with given prompt and options
   * @param {string} prompt - The prompt to send
   * @param {Object} opts - SDK query options
   * @param {string} [opts.model] - Model to use (default: "sonnet")
   * @param {string} [opts.permissionMode] - Permission mode (default: "bypassPermissions")
   * @param {number} [opts.maxTurns] - Maximum conversation turns (default: 1)
   * @param {boolean} [opts.silent] - Suppress logging
   * @returns {Promise<Object>} Response with stdout/stderr/exitCode
   */
  async execute(prompt, opts = {}) {
    const silent = !!opts.silent;
    const timer = this.logger.startTimer("sdk_executor");

    let resultMessage = null;

    try {
      const query = sdkQuery({
        prompt,
        options: {
          env: process.env,
          model: opts.model || "sonnet",
          permissionMode: opts.permissionMode || "bypassPermissions",
          maxTurns: opts.maxTurns || 1,
        },
      });

      let assistantMessage = null;
      let usage = null;

      for await (const message of query) {
        if (message.type === "assistant") {
          assistantMessage = message;
          if (message.usage) {
            usage = message.usage;
          }
        } else if (message.type === "result") {
          resultMessage = message;
          if (!silent) {
            this.logger.debug("sdk-exec", "SDK result message received", {
              subtype: message.subtype,
              isError: message.is_error,
            });
          }
        } else if (message.type === "system" && message.subtype === "init") {
          if (!silent) {
            this.logger.debug("sdk-exec", "SDK initialized", {
              apiKeySource: message.apiKeySource,
              model: message.model,
              permissionMode: message.permissionMode,
            });
          }
        }
      }

      const duration = this.logger.endTimer(timer);

      // Check for error result messages
      if (resultMessage) {
        if (resultMessage.is_error && resultMessage.subtype === "success") {
          return {
            stdout: "",
            stderr: JSON.stringify({
              type: "sdk_error",
              result: resultMessage.result,
              isError: true,
              subtype: resultMessage.subtype,
            }),
            exitCode: 1,
            resultMessage,
          };
        } else if (resultMessage.subtype === "error_during_execution") {
          return {
            stdout: "",
            stderr: "Execution error during SDK query",
            exitCode: 1,
            resultMessage,
          };
        }
      }

      // Successful assistant response
      if (assistantMessage) {
        const formattedResponse = {
          result: assistantMessage.text || "",
          session_id: assistantMessage.session_id || null,
          total_cost_usd:
            (usage?.input_cost_usd || 0) + (usage?.output_cost_usd || 0),
          duration_ms: duration?.ms || 0,
        };

        if (!silent) {
          this.logger.debug("sdk-exec", "SDK query completed", {
            resultLength: formattedResponse.result.length,
            durationMs: duration?.ms,
          });
        }

        return {
          stdout: JSON.stringify(formattedResponse),
          stderr: "",
          exitCode: 0,
        };
      }

      // No response received
      if (!silent) {
        this.logger.warn("sdk-exec", "No assistant response received", {
          durationMs: duration?.ms,
        });
      }
      return {
        stdout: "",
        stderr: "No response received from Claude",
        exitCode: 1,
      };
    } catch (error) {
      const duration = this.logger.endTimer(timer);

      if (!silent) {
        this.logger.error("sdk-exec", "SDK query failed", {
          error: error.message,
          durationMs: duration?.ms,
        });
      }

      // Use captured result message if available
      if (resultMessage && resultMessage.is_error) {
        return {
          stdout: "",
          stderr: JSON.stringify({
            type: "sdk_error",
            result: resultMessage.result,
            isError: true,
          }),
          exitCode: 1,
          resultMessage,
        };
      }

      // Generic error
      return {
        stdout: "",
        stderr: error.message || "SDK query failed",
        exitCode: 1,
      };
    }
  }
}

export default SdkExecutor;
