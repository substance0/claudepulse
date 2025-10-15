import fs from "fs/promises";
import path from "path";
import os from "os";

/**
 * Authentication Configuration Manager
 * Handles OAuth settings for Claude Agent SDK
 */
export class AuthConfig {
  constructor(configPath = null) {
    // Always use container-standard path for Docker compatibility with --user flag
    this.configPath =
      configPath || "/home/claudepulse/.claude/auth-config.json";
    this.config = null;
  }

  /**
   * Load configuration from file or use defaults
   */
  async load() {
    try {
      const configData = await fs.readFile(this.configPath, "utf8");
      this.config = { ...this.getDefaults(), ...JSON.parse(configData) };
    } catch (error) {
      if (error.code === "ENOENT") {
        // File doesn't exist, use defaults
        this.config = this.getDefaults();
        await this.save(); // Create the file with defaults
      } else {
        throw new Error(`Failed to load auth config: ${error.message}`);
      }
    }
    return this.config;
  }

  /**
   * Save configuration to file
   */
  async save() {
    try {
      // Ensure directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true, mode: 0o700 });

      // Write with secure permissions
      await fs.writeFile(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        { mode: 0o600 },
      );
    } catch (error) {
      throw new Error(`Failed to save auth config: ${error.message}`);
    }
  }

  /**
   * Get default configuration
   */
  getDefaults() {
    return {
      // OAuth configuration (only auth method supported)
      // SECURITY NOTE: OAuth client credentials are hardcoded for ClaudePulse
      // This is intentional and follows OAuth 2.0 public client security model:
      // - Client ID is public and not secret (designed to be embedded in apps)
      // - Client secret is NOT used (PKCE provides security instead)
      // - PKCE (code_verifier + code_challenge) prevents authorization code interception
      // - Each OAuth flow generates unique PKCE parameters per user session
      // - Authorization codes are single-use and expire quickly
      // - Refresh tokens are stored per-user with 0o600 file permissions
      oauth: {
        clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        authorizationUrl: "https://claude.ai/oauth/authorize",
        tokenEndpoint: "https://console.anthropic.com/v1/oauth/token",
        redirectUri: "https://console.anthropic.com/oauth/code/callback",
        scopes: "org:create_api_key user:profile user:inference",

        // Critical: Always set subscriptionType to "pro" for API compatibility
        forceSubscriptionTypePro: true,
      },
    };
  }

  /**
   * Get current configuration
   */
  get() {
    if (!this.config) {
      throw new Error("Configuration not loaded. Call load() first.");
    }
    return this.config;
  }

  /**
   * Update configuration
   */
  async update(updates) {
    if (!this.config) {
      await this.load();
    }

    this.config = { ...this.config, ...updates };
    await this.save();
    return this.config;
  }

  /**
   * Get authentication method (always OAuth for SDK)
   */
  getAuthMethod() {
    // Always return OAuth since we're SDK-only
    return "oauth";
  }

  /**
   * Get OAuth configuration
   */
  getOAuthConfig() {
    return this.get().oauth;
  }

  /**
   * Reset to default configuration
   */
  async reset() {
    this.config = this.getDefaults();
    await this.save();
    return this.config;
  }
}

export default AuthConfig;
