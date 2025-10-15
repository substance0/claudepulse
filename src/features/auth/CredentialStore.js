import fs from "fs/promises";
import path from "path";

/**
 * Credential Store Service
 * Handles secure reading and writing of OAuth credentials
 * Decouples file system operations from authentication logic
 */
export class CredentialStore {
  /**
   * Create CredentialStore instance
   * @param {Object} options - Configuration options
   * @param {string} options.credentialsPath - Path to credentials file
   * @param {Object} options.logger - Logger instance
   * @param {Object} [options.authConfig] - AuthConfig instance for subscriptionType fix
   */
  constructor({ credentialsPath, logger, authConfig }) {
    if (!credentialsPath) {
      throw new Error("CredentialStore requires credentialsPath");
    }
    if (!logger) {
      throw new Error("CredentialStore requires logger dependency");
    }

    this.credentialsPath = credentialsPath;
    this.logger = logger;
    this.authConfig = authConfig;
  }

  /**
   * Get credentials from file
   * @returns {Promise<Object|null>} OAuth credentials or null if not found
   */
  async getCredentials() {
    try {
      const credentialsData = await fs.readFile(this.credentialsPath, "utf8");
      const credentials = JSON.parse(credentialsData);

      if (!credentials.claudeAiOauth) {
        this.logger.debug("credentials", "No OAuth credentials found in file");
        return null;
      }

      const oauth = credentials.claudeAiOauth;

      // Validate required fields
      if (!oauth.accessToken || !oauth.refreshToken) {
        this.logger.warn("credentials", "Invalid OAuth credentials format");
        return null;
      }

      // Apply subscriptionType fix if missing (critical for Claude API compatibility)
      if (
        !oauth.subscriptionType &&
        this.authConfig &&
        this.authConfig.getOAuthConfig().forceSubscriptionTypePro
      ) {
        this.logger.info(
          "credentials",
          "Adding missing subscriptionType to OAuth credentials",
        );
        oauth.subscriptionType = "pro";

        // Save the corrected credentials back to file
        credentials.claudeAiOauth = oauth;
        await fs.writeFile(
          this.credentialsPath,
          JSON.stringify(credentials, null, 2),
          { mode: 0o600 },
        );
      } else if (oauth.subscriptionType && oauth.subscriptionType !== "pro") {
        this.logger.warn(
          "credentials",
          "OAuth credentials have non-pro subscriptionType",
          { subscriptionType: oauth.subscriptionType },
        );
      }

      this.logger.debug("credentials", "OAuth credentials loaded successfully");
      return oauth;
    } catch (error) {
      if (error.code === "ENOENT") {
        this.logger.debug("credentials", "Credentials file not found");
      } else {
        this.logger.debug("credentials", "Error loading credentials", {
          error: error.message,
        });
      }
      return null;
    }
  }

  /**
   * Save credentials to file
   * @param {Object} oauthData - OAuth credentials to save
   * @returns {Promise<void>}
   */
  async saveCredentials(oauthData) {
    try {
      // Load existing credentials or create new structure
      let credentials = {};
      try {
        const existingData = await fs.readFile(this.credentialsPath, "utf8");
        credentials = JSON.parse(existingData);
      } catch {
        // File doesn't exist or is invalid - will create new one
      }

      // Update OAuth credentials
      credentials.claudeAiOauth = oauthData;

      // Ensure directory exists with secure permissions
      const credentialsDir = path.dirname(this.credentialsPath);
      await fs.mkdir(credentialsDir, { recursive: true, mode: 0o700 });

      // Write with secure permissions (owner read/write only)
      await fs.writeFile(
        this.credentialsPath,
        JSON.stringify(credentials, null, 2),
        { mode: 0o600 },
      );

      this.logger.debug("credentials", "OAuth credentials saved successfully");
    } catch (error) {
      throw new Error(`Failed to save credentials: ${error.message}`);
    }
  }

  /**
   * Check if credentials file exists
   * @returns {Promise<boolean>}
   */
  async hasCredentialsFile() {
    try {
      await fs.access(this.credentialsPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get credentials path
   * @returns {string}
   */
  getCredentialsPath() {
    return this.credentialsPath;
  }
}

export default CredentialStore;
