import fs from "fs/promises";
import path from "path";
import os from "os";

/**
 * Claude Client with OAuth Authentication
 * Implements OAuth 2.0 with PKCE
 * @class ClaudeClient
 */
export class ClaudeClient {
  /**
   * Create ClaudeClient instance with injected dependencies
   * @param {Object} options - Configuration options
   * @param {string} [options.credentialsPath] - Path to credentials file
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.authConfig - AuthConfig instance (already loaded)
   * @param {Object} options.oauthManager - OAuthManager instance
   * @param {Object} options.credentialStore - CredentialStore instance
   * @param {Object} options.apiClient - ApiClient instance for sending messages
   */
  constructor(options = {}) {
    // Validate required dependencies
    if (!options.logger) {
      throw new Error("ClaudeClient requires logger dependency");
    }
    if (!options.authConfig) {
      throw new Error("ClaudeClient requires authConfig dependency");
    }
    if (!options.oauthManager) {
      throw new Error("ClaudeClient requires oauthManager dependency");
    }
    if (!options.credentialStore) {
      throw new Error("ClaudeClient requires credentialStore dependency");
    }
    if (!options.apiClient) {
      throw new Error("ClaudeClient requires apiClient dependency");
    }

    this.credentialsPath =
      options.credentialsPath || "/home/claudepulse/.claude/.credentials.json";

    // Injected dependencies
    this.logger = options.logger;
    this.authConfig = options.authConfig;
    this.oauthManager = options.oauthManager;
    this.credentialStore = options.credentialStore;
    this.apiClient = options.apiClient;

    // Internal state
    this.oauthCredentials = null;

    this.logger.info("client", "ClaudeClient initialized with configuration", {
      credentialsPath: this.credentialsPath,
      authMethod: "oauth",
      loggerComponent: "claude-client",
    });
  }

  /**
   * Check if credentials file exists
   */
  async _hasCredentialsFile() {
    const exists = await this.credentialStore.hasCredentialsFile();
    if (exists) {
      this.logger.debug("auth", "Credentials file exists", {
        path: this.credentialsPath,
      });
    } else {
      this.logger.debug("auth", "Credentials file not found", {
        path: this.credentialsPath,
      });
    }
    return exists;
  }

  /**
   * Check if we have valid OAuth credentials
   */
  async _hasValidOAuthCredentials() {
    try {
      const credentials = await this.credentialStore.getCredentials();
      if (!credentials) {
        return false;
      }

      // Check if token is expired - if expired, credentials are invalid
      if (credentials.expiresAt && Date.now() >= credentials.expiresAt) {
        this.logger.debug(
          "auth",
          "OAuth token expired, re-authentication required",
        );
        return false;
      }

      this.oauthCredentials = credentials;
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Load OAuth credentials from file
   */
  async _loadOAuthCredentials() {
    return await this.credentialStore.getCredentials();
  }

  /**
   * Store OAuth credentials to file
   */
  async _storeOAuthCredentials(oauthData) {
    await this.credentialStore.saveCredentials(oauthData);
    this.logger.debug("auth", "OAuth credentials stored successfully");
  }

  /**
   * Make API request using OAuth authentication
   */
  async _makeOAuthApiRequest(prompt) {
    if (!this.oauthCredentials) {
      throw new Error("No OAuth credentials available");
    }

    const postData = JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: "api.anthropic.com",
        port: 443,
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          Authorization: `Bearer ${this.oauthCredentials.accessToken}`,
          "anthropic-version": "2023-06-01",
          "User-Agent": "ClaudePulse/1.0.0",
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const response = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve({
                success: true,
                message: {
                  result: response.content[0]?.text || "",
                  session_id: crypto.randomUUID(),
                  total_cost_usd: 0.001, // Approximate
                  duration_ms: 1000,
                },
                exitCode: 0,
              });
            } else {
              // Check for session limit or auth errors
              const isRateLimit = res.statusCode === 429;
              const isAuthError =
                res.statusCode === 401 || res.statusCode === 403;

              reject({
                success: false,
                error:
                  response.error?.message ||
                  `API request failed: ${res.statusCode}`,
                exitCode: res.statusCode,
                sessionLimitReached: isRateLimit,
                authError: isAuthError,
              });
            }
          } catch (error) {
            reject({
              success: false,
              error: `Failed to parse API response: ${error.message}`,
              exitCode: -1,
            });
          }
        });
      });

      req.on("error", (error) => {
        reject({
          success: false,
          error: `API request failed: ${error.message}`,
          exitCode: -1,
        });
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Format SDK result message as structured response
   * @param {Object} resultMessage - SDK result message
   * @returns {Object} Structured response for error parsing
   */
  async sendMessage(prompt, opts = {}) {
    // Check if we have OAuth credentials
    if (!this.oauthCredentials) {
      if (!opts.silent) {
        this.logger.info(
          "auth",
          "No OAuth credentials found. Initiating OAuth authentication flow...",
        );
      }
      return await this._initiateOAuthFlow();
    }

    // Delegate to ApiClient which handles validation, retry logic, etc.
    return await this.apiClient.sendMessage(prompt, opts);
  }

  async pulse(message = "pulse check") {
    // Check if we have OAuth credentials
    if (!this.oauthCredentials) {
      this.logger.warn("pulse", "No OAuth credentials, cannot send pulse");
      return {
        success: false,
        error: "No OAuth credentials",
      };
    }

    // Delegate to ApiClient
    return await this.apiClient.pulse(message);
  }

  // Legacy compatibility - kept for existing tests/code
  async _legacyPulse(message = "pulse check") {
    this.logger.info("pulse", "Sending pulse message (legacy)", {
      message,
    });
    const result = await this.sendMessage(message);
    this.logger.info("pulse", "Pulse completed", {
      success: result.success,
      error: result.error,
    });
    return result;
  }

  async login() {
    this.logger.info(
      "auth",
      "OAuth authentication setup required. Run the OAuth setup script.",
    );
    return Promise.resolve({
      success: false,
      message: "OAuth setup required",
    });
  }

  async getAuthStatus() {
    this.logger.debug("auth", "Checking authentication status", {
      authMethod: this.currentAuthMethod,
      credentialsPath: this.credentialsPath,
    });

    // Check OAuth credentials directly
    const hasValidOAuth = await this._hasValidOAuthCredentials();

    if (hasValidOAuth && this.oauthCredentials) {
      // Check if token is expired
      const now = Date.now();
      const isExpired =
        this.oauthCredentials.expiresAt &&
        now >= this.oauthCredentials.expiresAt;

      if (isExpired) {
        this.logger.warn(
          "auth",
          "OAuth token expired, re-authentication required",
        );
        return {
          authenticated: false,
          message: "OAuth token expired, re-authentication required",
          requiresOAuth: true,
          approach: "oauth",
        };
      } else {
        this.logger.info("auth", "Valid OAuth credentials found");
        return {
          authenticated: true,
          message: "OAuth authentication valid",
          approach: "oauth",
        };
      }
    } else {
      // No valid OAuth credentials - initiate OAuth flow
      this.logger.debug(
        "auth",
        "No valid OAuth credentials, initiating OAuth flow",
      );
      const oauthFlow = await this._initiateOAuthFlow();

      if (oauthFlow.success) {
        return {
          authenticated: false,
          message: "OAuth authentication required",
          isOAuthFlow: true,
          authUrl: oauthFlow.authUrl,
          requiresOAuth: true,
          approach: "oauth",
        };
      } else {
        return {
          authenticated: false,
          message: "Failed to initiate OAuth flow",
          error: oauthFlow.error,
          approach: "oauth",
        };
      }
    }
  }

  getCredentialsPath() {
    return this.credentialsPath;
  }

  /**
   * Initiate OAuth authentication flow (delegated to OAuthManager)
   */
  async _initiateOAuthFlow() {
    return await this.oauthManager.initiateOAuthFlow();
  }

  /**
   * Check OAuth authentication status (Static method for npm scripts)
   *
   * NOTE: This static method is an exception to the DI pattern.
   * It's used by standalone npm scripts (e.g., oauth-verify.js) that run
   * outside the main application's dependency injection context.
   *
   * @deprecated This method uses the old singleton pattern and should not be
   * used in application code. It exists only for backward compatibility with
   * npm scripts. For application code, inject ClaudeClient via constructor.
   */
  static async checkOAuthStatus() {
    try {
      // TODO: Refactor npm scripts to use proper DI and remove this method
      throw new Error(
        "ClaudeClient.get() has been removed. Use dependency injection instead.",
      );
      const authStatus = await client.getAuthStatus();

      const status = {
        authenticated: authStatus.authenticated,
        authMethod: "oauth",
        hasOAuthCredentials: !!client.oauthCredentials,
        pendingOAuth: !!(await client._loadPendingOAuth()),
        credentialsPath: client.credentialsPath,
      };

      if (authStatus.sessionLimitReached) {
        status.sessionLimitReached = true;
        status.sessionLimitInfo = authStatus.sessionLimitInfo;
      }

      if (authStatus.error) {
        status.error = authStatus.error;
      }

      return status;
    } catch (error) {
      return {
        authenticated: false,
        error: error.message,
      };
    }
  }
}

export default ClaudeClient;
