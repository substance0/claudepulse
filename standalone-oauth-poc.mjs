#!/usr/bin/env node

/**
 * ClaudePulse OAuth Setup Script
 * Handles interactive OAuth 2.0 with PKCE flow setup within the container
 */

import crypto from "crypto";
import https from "https";
import fs from "fs";
import path from "path";

// OAuth Configuration
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZATION_URL = "https://claude.ai/oauth/authorize";
const TOKEN_ENDPOINT = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

// Credentials file path
const CREDENTIALS_PATH = path.join(
  process.env.HOME || "/home/claudeapp",
  ".claude",
  ".credentials.json",
);

/**
 * Generate PKCE parameters for secure OAuth flow
 */
function generatePKCEParams() {
  // Generate code verifier (43-128 characters, base64url-encoded)
  const codeVerifier = crypto.randomBytes(32).toString("base64url");

  // Generate code challenge (SHA256 hash of verifier, base64url-encoded)
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // Generate state parameter for CSRF protection
  const state = crypto.randomBytes(32).toString("hex");

  return { codeVerifier, codeChallenge, state };
}

/**
 * Build authorization URL with PKCE parameters
 */
function buildAuthorizationURL(codeChallenge, state) {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: state,
  });

  return `${AUTHORIZATION_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access tokens
 */
function exchangeCodeForTokens(authCode, codeVerifier, state) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: authCode,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      state: state,
    });

    const tokenUrl = new URL(TOKEN_ENDPOINT);
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

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const response = JSON.parse(data);

          if (res.statusCode === 200) {
            resolve(response);
          } else {
            reject(
              new Error(
                `Token exchange failed: ${response.error || response.message || "Unknown error"}`,
              ),
            );
          }
        } catch (error) {
          reject(new Error(`Failed to parse token response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Token exchange request failed: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Store credentials securely in the container
 */
function storeCredentials(tokenData) {
  try {
    // Ensure credentials directory exists
    const credentialsDir = path.dirname(CREDENTIALS_PATH);
    if (!fs.existsSync(credentialsDir)) {
      fs.mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });
    }

    // Calculate expiration timestamp
    const expiresAt = Date.now() + tokenData.expires_in * 1000;

    // Prepare credentials object
    const credentials = {
      claudeAiOauth: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: expiresAt,
        tokenType: tokenData.token_type || "Bearer",
        scope: tokenData.scope || SCOPES,
        organization: tokenData.organization || {},
        account: tokenData.account || {},
        scopes: (tokenData.scope || SCOPES).split(" "),
      },
    };

    // Write credentials file with restrictive permissions
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });

    console.log(`✅ Credentials stored successfully in ${CREDENTIALS_PATH}`);
    return credentials;
  } catch (error) {
    throw new Error(`Failed to store credentials: ${error.message}`);
  }
}

/**
 * Read user input from stdin
 */
function readUserInput(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
}

/**
 * Main OAuth setup flow
 */
async function main() {
  console.log("🔐 ClaudePulse OAuth Setup");
  console.log("========================");
  console.log("");
  console.log(
    "This script will help you set up OAuth authentication for ClaudePulse.",
  );
  console.log(
    "You will need to authorize ClaudePulse in your browser and provide the authorization code.",
  );
  console.log("");

  try {
    // Check if credentials already exist
    if (fs.existsSync(CREDENTIALS_PATH)) {
      const overwrite = await readUserInput(
        "⚠️  Credentials already exist. Overwrite? (y/N): ",
      );
      if (
        overwrite.toLowerCase() !== "y" &&
        overwrite.toLowerCase() !== "yes"
      ) {
        console.log("OAuth setup cancelled.");
        process.exit(0);
      }
    }

    // Generate PKCE parameters
    console.log("📋 Generating PKCE parameters...");
    const { codeVerifier, codeChallenge, state } = generatePKCEParams();

    console.log("✅ PKCE parameters generated successfully");
    console.log("");

    // Build and display authorization URL
    const authURL = buildAuthorizationURL(codeChallenge, state);

    console.log(
      "🌐 Please open this URL in your browser to authorize ClaudePulse:",
    );
    console.log("");
    console.log("━".repeat(80));
    console.log(authURL);
    console.log("━".repeat(80));
    console.log("");
    console.log(
      "After authorizing, you will be redirected to a callback URL like:",
    );
    console.log(
      "   https://console.anthropic.com/oauth/code/callback?code=XXXXXX&state=...",
    );
    console.log("");
    console.log('💡 Copy only the value after "code=" and before "&state"');
    console.log("");

    // Get authorization code from user
    const authCodeInput = await readUserInput(
      "📝 Enter the authorization code: ",
    );

    if (!authCodeInput) {
      console.error("❌ No authorization code provided");
      process.exit(1);
    }

    // Parse the authorization code (remove any hash fragments)
    const authCode = authCodeInput.split("#")[0].trim();

    console.log("");
    console.log("🔄 Exchanging authorization code for access tokens...");
    console.log(`🔍 Using authorization code: ${authCode.substring(0, 10)}...`);

    // Exchange code for tokens
    const tokenData = await exchangeCodeForTokens(
      authCode,
      codeVerifier,
      state,
    );

    console.log("✅ Token exchange successful!");
    console.log("");

    // Store credentials
    const credentials = storeCredentials(tokenData);

    console.log("🎯 OAuth Setup Complete!");
    console.log("");
    console.log("📊 Token Information:");
    console.log(
      `   Access Token: ${credentials.claudeAiOauth.accessToken.substring(0, 20)}...`,
    );
    console.log(
      `   Expires At: ${new Date(credentials.claudeAiOauth.expiresAt).toISOString()}`,
    );
    if (credentials.claudeAiOauth.organization?.name) {
      console.log(
        `   Organization: ${credentials.claudeAiOauth.organization.name}`,
      );
    }
    if (credentials.claudeAiOauth.account?.email) {
      console.log(`   Account: ${credentials.claudeAiOauth.account.email}`);
    }
    console.log("");
    console.log("🚀 ClaudePulse is now ready to run!");
    console.log("");

    // Ask if user wants to start ClaudePulse immediately
    const startNow = await readUserInput(
      "🤖 Would you like to start ClaudePulse automation now? (Y/n): ",
    );

    if (
      startNow.toLowerCase() === "" ||
      startNow.toLowerCase() === "y" ||
      startNow.toLowerCase() === "yes"
    ) {
      console.log("");
      console.log("🚀 Starting ClaudePulse automation...");
      console.log("   ClaudePulse is now running in the background");
      console.log("   Use 'docker logs -f <container-name>' to view logs");
      console.log("   Use 'docker attach <container-name>' to reconnect");
      console.log("   Use Ctrl+P, Ctrl+Q to detach without stopping");
      console.log("");

      // Clean up stdin before starting main app
      process.stdin.destroy();

      // Dynamic import and start the main application
      const { default: ClaudeScheduler } = await import(
        "./src/automation/scheduler.js"
      );
      const { Logger } = await import("./src/utils/logger.js");

      const logger = new Logger({ service: "claudepulse-main" });
      logger.info("start", "ClaudePulse started after OAuth setup", {
        version: "1.0.0",
        nodeVersion: process.version,
      });

      const scheduler = new ClaudeScheduler();
      const started = await scheduler.start();

      if (!started) {
        logger.error("start", "Failed to start automation scheduler");
        process.exit(1);
      }

      logger.info("start", "Automation running... Press Ctrl+C to stop");

      // Check if running in Docker/container interactive mode and suggest detaching
      const isContainer =
        process.env.container === "oci" ||
        process.env.container === "podman" ||
        process.env.container === "docker" ||
        fs.existsSync("/.dockerenv") ||
        fs.existsSync("/run/.containerenv");

      if (process.stdin.isTTY && isContainer) {
        logger.info(
          "docker",
          "To keep ClaudePulse running and detach from container",
          {
            instruction: "Press Ctrl+P then Ctrl+Q",
          },
        );
      }

      // Handle shutdown signals
      process.on("SIGTERM", () => {
        logger.info("shutdown", "Received SIGTERM signal");
        scheduler.stop();
        process.exit(0);
      });

      process.on("SIGINT", () => {
        logger.info("shutdown", "Received SIGINT signal");
        scheduler.stop();
        process.exit(0);
      });

      // Keep process alive
      return; // Don't exit, keep running
    } else {
      console.log("");
      console.log("ℹ️  OAuth setup complete!");
      console.log("   Start ClaudePulse later with: node src/index.js");
      console.log("");
    }

    // Clean up stdin and exit successfully
    process.stdin.destroy();
    process.exit(0);
  } catch (error) {
    console.error("❌ OAuth setup failed:", error.message);
    process.stdin.destroy();
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n⚠️  Setup interrupted by user");
  process.exit(1);
});

process.on("SIGTERM", () => {
  console.log("\n\n⚠️  Setup terminated");
  process.exit(1);
});

// Enable stdin input
process.stdin.setEncoding("utf8");

// Run the setup
main().catch((error) => {
  console.error("❌ Unexpected error:", error.message);
  process.exit(1);
});
