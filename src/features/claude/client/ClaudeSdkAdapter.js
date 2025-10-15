import SessionLimitParser from "../../../core/utils/SessionLimitParser.js";
import { DateUtility } from "../../../core/utils/DateUtility.js";

/**
 * Claude SDK Adapter Service
 * Handles Claude-specific SDK interactions including mock responses,
 * error formatting, and session limit parsing
 */
export class ClaudeSdkAdapter {
  /**
   * Create ClaudeSdkAdapter instance
   * @param {Object} options - Configuration options
   * @param {Object} options.sdkExecutor - SDK executor instance
   * @param {Object} options.logger - Logger instance
   */
  constructor({ sdkExecutor, logger }) {
    if (!sdkExecutor) {
      throw new Error("ClaudeSdkAdapter requires sdkExecutor dependency");
    }
    if (!logger) {
      throw new Error("ClaudeSdkAdapter requires logger dependency");
    }

    this.sdkExecutor = sdkExecutor;
    this.logger = logger;
    this.sessionLimitParser = new SessionLimitParser(
      DateUtility.formatLocalIso,
    );
  }

  /**
   * Execute query with mock response handling
   * @param {string} prompt - The prompt to send
   * @param {Object} opts - Query options
   * @returns {Promise<Object>} Response with stdout/stderr/exitCode
   */
  async executeQuery(prompt, opts = {}) {
    const silent = !!opts.silent;

    // Check for mocked responses (for testing)
    const mockResponse = this._getMockResponse(silent);
    if (mockResponse) {
      return mockResponse;
    }

    // Execute real SDK query
    const response = await this.sdkExecutor.execute(prompt, opts);

    // Format SDK error responses if needed
    if (response.exitCode !== 0 && response.resultMessage) {
      return this._formatSdkErrorResponse(response.resultMessage);
    }

    return response;
  }

  /**
   * Check for and return mock responses (for testing)
   * @param {boolean} silent - Suppress logging
   * @returns {Object|null} Mock response or null
   */
  _getMockResponse(silent) {
    const mockSessionLimit = process.env.MOCK_CLAUDE_SESSION_LIMIT_MESSAGE;
    if (mockSessionLimit) {
      if (!silent) {
        this.logger.warn(
          "mock",
          `Using mocked session limit response: "${mockSessionLimit}"`,
        );
      }
      return {
        stdout: "",
        stderr: mockSessionLimit,
        exitCode: 1,
      };
    }

    const mockPingSuccess = process.env.MOCK_CLAUDE_PING_SUCCESS_MESSAGE;
    if (mockPingSuccess) {
      if (!silent) {
        this.logger.warn(
          "mock",
          `Using mocked ping success response: ${mockPingSuccess}`,
        );
      }
      return {
        stdout: mockPingSuccess,
        stderr: "",
        exitCode: 0,
      };
    }

    return null;
  }

  /**
   * Format SDK error response with full metadata
   * @param {Object} resultMessage - SDK result message
   * @returns {Object} Formatted error response
   */
  _formatSdkErrorResponse(resultMessage) {
    const errorResponse = {
      type: "result",
      subtype: "success",
      is_error: true,
      duration_ms: resultMessage.duration_ms,
      duration_api_ms: resultMessage.duration_api_ms,
      num_turns: resultMessage.num_turns,
      result: resultMessage.result,
      session_id: resultMessage.session_id,
      total_cost_usd: resultMessage.total_cost_usd,
      usage: resultMessage.usage,
      permission_denials: resultMessage.permission_denials || [],
      uuid: resultMessage.uuid,
    };

    return {
      stdout: JSON.stringify(errorResponse),
      stderr: "",
      exitCode: 1,
    };
  }

  /**
   * Parse session limit information from error text
   * @param {string} errorText - The error message text
   * @returns {Object|null} Parsed session limit info or null
   */
  parseSessionLimit(errorText) {
    return this.sessionLimitParser.parseSessionLimit(errorText);
  }

  /**
   * Parse SDK response and extract structured data
   * @param {Object} response - Raw response from SDK
   * @param {string} requestId - Request identifier for logging
   * @param {Object} opts - Options including silent flag
   * @returns {Object} Parsed response with success flag and data
   */
  async parseSdkResponse(response, requestId, opts = {}) {
    const silent = !!opts.silent;

    if (response.exitCode === 0 && response.stdout) {
      try {
        const data = JSON.parse(response.stdout);
        if (!silent) {
          this.logger.debug("response", "Parsed successful SDK response", {
            requestId,
            hasResult: !!data.result,
            sessionId: data.session_id,
          });
        }
        return {
          success: true,
          data,
          sessionLimitReached: false,
        };
      } catch (error) {
        if (!silent) {
          this.logger.error(
            "response",
            "Failed to parse SDK JSON response",
            {
              requestId,
              error: error.message,
              stdout: response.stdout?.substring(0, 200),
            },
            {
              component: "ApiClient",
              errorCode: "JSON_PARSE_FAILURE",
            },
          );
        }
        return {
          success: false,
          error: "Failed to parse response JSON",
          rawStdout: response.stdout,
        };
      }
    }

    // Handle errors
    const errorText = response.stderr || response.stdout || "";

    // Check for session limit
    const sessionLimitInfo = this.parseSessionLimit(errorText);
    if (sessionLimitInfo) {
      if (!silent) {
        this.logger.warn("limit", "Session limit reached", {
          requestId,
          resetTime: sessionLimitInfo.resetTime,
        });
      }
      return {
        success: false,
        sessionLimitReached: true,
        sessionLimitInfo,
      };
    }

    // Generic error
    if (!silent) {
      this.logger.error(
        "response",
        "SDK query failed",
        {
          requestId,
          exitCode: response.exitCode,
          error: errorText.substring(0, 200),
        },
        {
          component: "ApiClient",
          errorCode: "SDK_QUERY_FAILURE",
          statusCode: response.exitCode,
        },
      );
    }

    return {
      success: false,
      error: errorText || "Unknown error",
      exitCode: response.exitCode,
    };
  }
}

export default ClaudeSdkAdapter;
