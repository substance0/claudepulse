import fs from "fs/promises";
import path from "path";

/**
 * OAuth State Store Service
 * Manages temporary OAuth state including PKCE parameters and CSRF tokens
 * Decouples state persistence from OAuth business logic
 *
 * SECURITY MODEL:
 * - PKCE parameters (codeVerifier, codeChallenge, state) are security-sensitive
 * - These are temporary credentials valid only during the OAuth flow (1-hour TTL)
 * - Protected by filesystem permissions (0o600 = owner read/write only)
 * - Automatically cleaned up after successful token exchange or expiration
 * - Risk mitigation: Even if an attacker gains read access, they would need:
 *   1. The authorization code (sent to user's browser, single-use)
 *   2. Access within the 1-hour window before expiration
 *   3. Ability to intercept the token exchange before legitimate user
 *
 * This security model is appropriate for:
 * - Docker containers (isolated filesystem)
 * - Local development environments
 * - Single-user deployments
 *
 * NOT appropriate for:
 * - Shared hosting environments with multiple users
 * - Systems where filesystem permissions are not enforced
 * - Multi-tenant environments without proper isolation
 */
export class OAuthStateStore {
  /**
   * Create OAuthStateStore instance
   * @param {Object} options - Configuration options
   * @param {string} options.statePath - Path to store OAuth state file
   * @param {Object} options.logger - Logger instance
   */
  constructor({ statePath, logger }) {
    if (!statePath) {
      throw new Error("OAuthStateStore requires statePath");
    }
    if (!logger) {
      throw new Error("OAuthStateStore requires logger dependency");
    }

    this.statePath = statePath;
    this.logger = logger;
  }

  /**
   * Store pending OAuth parameters
   * @param {Object} params - OAuth parameters to store
   * @param {string} params.state - CSRF state token
   * @param {string} params.codeVerifier - PKCE code verifier
   * @param {string} params.codeChallenge - PKCE code challenge
   * @param {number} params.timestamp - Timestamp when state was created
   * @param {string} [params.authUrl] - Authorization URL for user reference
   * @returns {Promise<void>}
   */
  async storePendingOAuth(params) {
    await fs.writeFile(this.statePath, JSON.stringify(params, null, 2), {
      mode: 0o600, // Owner read/write only
    });
    this.logger.debug(
      "oauth-state",
      "Stored pending OAuth params with 1-hour TTL and 0o600 permissions",
    );
  }

  /**
   * Load pending OAuth parameters
   * @returns {Promise<Object|null>} OAuth parameters or null if not found
   */
  async loadPendingOAuth() {
    try {
      const pendingData = await fs.readFile(this.statePath, "utf8");
      return JSON.parse(pendingData);
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logger.debug("oauth-state", "Error loading pending OAuth state", {
          error: error.message,
        });
      }
      return null;
    }
  }

  /**
   * Clean up pending OAuth parameters
   * @returns {Promise<void>}
   */
  async cleanupPendingOAuth() {
    try {
      await fs.unlink(this.statePath);
      this.logger.debug("oauth-state", "Cleaned up pending OAuth state");
    } catch (error) {
      // Ignore errors - file might not exist
      if (error.code !== "ENOENT") {
        this.logger.debug(
          "oauth-state",
          "Error cleaning up pending OAuth state",
          {
            error: error.message,
          },
        );
      }
    }
  }

  /**
   * Check if pending OAuth state exists
   * @returns {Promise<boolean>}
   */
  async hasPendingOAuth() {
    try {
      await fs.access(this.statePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate pending OAuth state (check expiration)
   * @param {number} maxAgeMs - Maximum age in milliseconds (default: 1 hour)
   * @returns {Promise<Object|null>} Valid OAuth params or null if expired/missing
   */
  async validatePendingOAuth(maxAgeMs = 3600000) {
    const pendingOAuth = await this.loadPendingOAuth();
    if (!pendingOAuth) {
      return null;
    }

    // Check if parameters are still valid (not older than maxAgeMs)
    if (Date.now() - pendingOAuth.timestamp > maxAgeMs) {
      this.logger.debug("oauth-state", "Pending OAuth state expired", {
        timestamp: pendingOAuth.timestamp,
        age: Date.now() - pendingOAuth.timestamp,
        maxAge: maxAgeMs,
      });
      await this.cleanupPendingOAuth();
      return null;
    }

    return pendingOAuth;
  }

  /**
   * Get state file path
   * @returns {string}
   */
  getStatePath() {
    return this.statePath;
  }
}

export default OAuthStateStore;
