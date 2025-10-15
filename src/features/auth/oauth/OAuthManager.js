import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import https from "https";
import { Logger } from "../../../core/utils/logger.js";

/**
 * OAuth Manager for Claude Authentication
 * Handles PKCE-based OAuth 2.0 flow for Claude.ai
 */
export class OAuthManager {
  constructor({
    credentialsPath,
    authConfig,
    logger,
    credentialStore,
    stateStore,
  }) {
    // Validate required dependencies
    if (!credentialStore) {
      throw new Error("OAuthManager requires credentialStore dependency");
    }
    if (!authConfig) {
      throw new Error("OAuthManager requires authConfig dependency");
    }
    if (!stateStore) {
      throw new Error("OAuthManager requires stateStore dependency");
    }

    this.credentialsPath = credentialsPath;
    this.authConfig = authConfig;
    this.logger = logger || new Logger({ service: "oauth-manager" });
    this.credentialStore = credentialStore;
    this.stateStore = stateStore;
  }

  /**
   * Generate PKCE parameters for OAuth flow
   */
  generatePKCEParams() {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const state = crypto.randomBytes(32).toString("hex");

    return { codeVerifier, codeChallenge, state };
  }

  /**
   * Build authorization URL for OAuth flow
   */
  buildAuthorizationURL(codeChallenge, state) {
    const oauthConfig = this.authConfig.getOAuthConfig();
    const params = new URLSearchParams({
      code: "true",
      client_id: oauthConfig.clientId,
      response_type: "code",
      redirect_uri: oauthConfig.redirectUri,
      scope: oauthConfig.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: state,
    });

    return `${oauthConfig.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Store pending OAuth parameters (delegated to OAuthStateStore)
   */
  async storePendingOAuth(params) {
    await this.stateStore.storePendingOAuth(params);
  }

  /**
   * Load pending OAuth parameters (delegated to OAuthStateStore)
   */
  async loadPendingOAuth() {
    return await this.stateStore.loadPendingOAuth();
  }

  /**
   * Clean up pending OAuth parameters (delegated to OAuthStateStore)
   */
  async cleanupPendingOAuth() {
    await this.stateStore.cleanupPendingOAuth();
  }

  /**
   * Make HTTP request to token endpoint
   */
  makeTokenRequest(postData) {
    return new Promise((resolve, reject) => {
      const oauthConfig = this.authConfig.getOAuthConfig();
      const tokenUrl = new URL(oauthConfig.tokenEndpoint);
      const options = {
        hostname: tokenUrl.hostname,
        port: 443,
        path: tokenUrl.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
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
              resolve(response);
            } else {
              // Extract error message, handling both string and object values
              let errorMsg = "Unknown error";
              if (response.error) {
                if (typeof response.error === "string") {
                  errorMsg = response.error;
                } else if (
                  typeof response.error === "object" &&
                  response.error.message
                ) {
                  errorMsg = response.error.message;
                } else {
                  errorMsg = JSON.stringify(response.error);
                }
              } else if (response.message) {
                errorMsg = response.message;
              } else if (response.error_description) {
                errorMsg = response.error_description;
              }

              const errorDetails =
                response.error_description &&
                response.error_description !== errorMsg
                  ? ` (${response.error_description})`
                  : "";

              reject(
                new Error(
                  `Token request failed with status ${res.statusCode}: ${errorMsg}${errorDetails}`,
                ),
              );
            }
          } catch (error) {
            reject(
              new Error(
                `Failed to parse token response (status ${res.statusCode}): ${error.message}. Raw response: ${data.substring(0, 200)}`,
              ),
            );
          }
        });
      });

      req.on("error", (error) => {
        reject(new Error(`Token request failed: ${error.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Exchange authorization code for access tokens
   */
  async exchangeCodeForTokens(authCode, codeVerifier, state) {
    try {
      const oauthConfig = this.authConfig.getOAuthConfig();

      // Build token exchange request (Anthropic expects JSON, not form-urlencoded)
      const postData = JSON.stringify({
        grant_type: "authorization_code",
        client_id: oauthConfig.clientId,
        code: authCode,
        redirect_uri: oauthConfig.redirectUri,
        code_verifier: codeVerifier,
        state: state,
      });

      this.logger.debug("oauth", "Exchanging authorization code for tokens");

      const tokenData = await this.makeTokenRequest(postData);

      // Extract token data
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;
      const expiresIn = tokenData.expires_in || 2592000; // Default 30 days
      const tokenType = tokenData.token_type || "Bearer";
      const scope = tokenData.scope || oauthConfig.scopes;
      const scopes = scope.split(" ");

      // Calculate expiration timestamp
      const expiresAt = Date.now() + expiresIn * 1000;

      // Force subscription type to "pro" for API compatibility
      const subscriptionType = oauthConfig.forceSubscriptionTypePro
        ? "pro"
        : tokenData.subscription_type || null;

      // Build credentials object
      const credentials = {
        accessToken,
        refreshToken,
        expiresAt,
        tokenType,
        scope,
        scopes,
        subscriptionType,
      };

      // Include organization and account info if available
      if (tokenData.organization) {
        credentials.organization = tokenData.organization;
      }
      if (tokenData.account) {
        credentials.account = tokenData.account;
      }

      // Save credentials to file using CredentialStore
      await this.credentialStore.saveCredentials(credentials);

      this.logger.info("oauth", "OAuth token exchange successful");
      return {
        success: true,
        credentials,
      };
    } catch (error) {
      this.logger.error(
        "oauth",
        "OAuth token exchange failed",
        {
          error: error.message,
        },
        {
          component: "Auth",
          errorCode: "TOKEN_EXCHANGE_FAILURE",
        },
      );
      return {
        success: false,
        error: `OAuth token exchange failed: ${error.message}`,
      };
    }
  }

  /**
   * Initiate OAuth authentication flow
   */
  async initiateOAuthFlow() {
    try {
      // Generate PKCE parameters for new OAuth flow
      const {
        codeVerifier,
        codeChallenge,
        state: newState,
      } = this.generatePKCEParams();

      // Build authorization URL
      const authUrl = this.buildAuthorizationURL(codeChallenge, newState);

      // Store PKCE parameters for the verification command
      await this.storePendingOAuth({
        state: newState,
        codeVerifier: codeVerifier,
        codeChallenge: codeChallenge,
        timestamp: Date.now(),
        authUrl: authUrl,
      });

      // Docker-friendly instructions
      this.logger.info("oauth", "=".repeat(70));
      this.logger.info("oauth", "OAuth Authentication Required");
      this.logger.info("oauth", "=".repeat(70));
      this.logger.info("oauth", "");
      this.logger.info("oauth", "To authenticate with Claude.ai OAuth:");
      this.logger.info("oauth", "");
      this.logger.info("oauth", "1. Open this URL in your browser:");
      this.logger.info("oauth", "   " + authUrl);
      this.logger.info("oauth", "");
      this.logger.info("oauth", "2. Complete the OAuth authorization");
      this.logger.info(
        "oauth",
        "3. Copy the authorization code from the redirect URL",
      );
      this.logger.info("oauth", "");
      this.logger.info("oauth", "4. In another terminal, run:");
      this.logger.info("oauth", "");
      this.logger.info("oauth", "   For Docker:");
      this.logger.info(
        "oauth",
        "   docker exec <container_name> npm run oauth-verify <authorization_code>",
      );
      this.logger.info("oauth", "");
      this.logger.info("oauth", "   For direct execution:");
      this.logger.info("oauth", "   npm run oauth-verify <authorization_code>");
      this.logger.info("oauth", "");
      this.logger.info(
        "oauth",
        "ClaudePulse will continue running and watch for credential creation...",
      );
      this.logger.info("oauth", "=".repeat(70));

      return {
        success: true,
        message:
          "OAuth authentication flow initiated. Please follow the instructions above.",
        exitCode: 1,
        requiresOAuth: true,
        authUrl,
        state: newState,
        codeVerifier,
        watchingCredentials: true,
        isOAuthFlow: true, // Flag to indicate this is an OAuth flow, not an error
      };
    } catch (error) {
      this.logger.error(
        "oauth",
        "Failed to initiate OAuth flow",
        {
          error: error.message,
        },
        {
          component: "Auth",
          errorCode: "OAUTH_INITIATION_FAILURE",
        },
      );
      return {
        success: false,
        error: `OAuth flow initiation failed: ${error.message}`,
        exitCode: -1,
      };
    }
  }

  /**
   * Verify OAuth code (standalone CLI function)
   */
  static async verifyOAuthCode(
    authCode,
    credentialsPath,
    authConfig,
    stateStore,
  ) {
    const tempLogger = new Logger({ service: "oauth-verify" });

    try {
      if (!authCode) {
        tempLogger.error("verify", "Missing authorization code");
        console.error("❌ Usage: npm run oauth-verify <authorization_code>");
        return { success: false, error: "MISSING_AUTH_CODE" };
      }

      // Extract just the authorization code (remove hash fragment if present)
      // URL format: <code>#<state> or just <code>
      const cleanAuthCode = authCode.split("#")[0];

      if (!cleanAuthCode) {
        tempLogger.error("verify", "Invalid authorization code format");
        console.error("❌ Invalid authorization code format");
        return { success: false, error: "INVALID_CODE_FORMAT" };
      }

      console.log("🔄 Verifying authorization code...");

      // Create CredentialStore (needed for OAuthManager)
      const CredentialStore = (await import("../CredentialStore.js")).default;
      const credentialStore = new CredentialStore({
        credentialsPath,
        logger: tempLogger,
        authConfig,
      });

      // Create OAuth manager instance with all dependencies
      const oauthManager = new OAuthManager({
        credentialsPath,
        authConfig,
        logger: tempLogger,
        credentialStore,
        stateStore,
      });

      // Load and validate pending OAuth parameters
      const pendingOAuth =
        await oauthManager.stateStore.validatePendingOAuth(3600000);
      if (!pendingOAuth) {
        tempLogger.error("verify", "No pending OAuth flow found or expired");
        console.error(
          "❌ No pending OAuth flow found or flow expired. Please restart ClaudePulse to begin new flow.",
        );
        return { success: false, error: "NO_PENDING_FLOW_OR_EXPIRED" };
      }

      const result = await oauthManager.exchangeCodeForTokens(
        cleanAuthCode,
        pendingOAuth.codeVerifier,
        pendingOAuth.state,
      );

      if (result.success) {
        // Clean up temporary file
        await oauthManager.cleanupPendingOAuth();
        tempLogger.info("verify", "OAuth verification successful");
        console.log("✅ OAuth authentication completed successfully!");
        console.log(
          "ClaudePulse should now detect the new credentials and continue.",
        );
        return { success: true };
      } else {
        // Specific error handling based on error message
        const errorMsg = result.error?.toLowerCase() || "";
        let errorCode = "VERIFICATION_FAILED";

        if (errorMsg.includes("expired")) {
          errorCode = "CODE_EXPIRED";
        } else if (errorMsg.includes("invalid")) {
          errorCode = "INVALID_CODE";
        } else if (errorMsg.includes("used")) {
          errorCode = "CODE_ALREADY_USED";
        }

        tempLogger.error(
          "verify",
          "OAuth verification failed",
          {
            error: result.error,
          },
          {
            component: "Auth",
            errorCode,
          },
        );
        console.error("❌ OAuth verification failed:", result.error);
        return {
          success: false,
          error: errorCode,
          details: result.error,
        };
      }
    } catch (error) {
      tempLogger.error(
        "verify",
        "OAuth verification exception",
        {
          error: error.message,
          stack: error.stack,
        },
        {
          component: "Auth",
          errorCode: "VERIFICATION_EXCEPTION",
        },
      );
      console.error("❌ OAuth verification error:", error.message);
      return {
        success: false,
        error: "EXCEPTION",
        details: error.message,
      };
    }
  }
}

export default OAuthManager;
