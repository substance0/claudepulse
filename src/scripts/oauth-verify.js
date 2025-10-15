#!/usr/bin/env node

import { OAuthManager } from "../features/auth/oauth/OAuthManager.js";
import CredentialStore from "../features/auth/CredentialStore.js";
import OAuthStateStore from "../features/auth/OAuthStateStore.js";
import AuthConfig from "../core/config/auth-config.js";
import { Logger } from "../core/utils/logger.js";
import path from "path";
import os from "os";

const authCode = process.argv[2];
if (!authCode) {
  console.error("Usage: claudepulse-verify <verification-code>");
  process.exit(1);
}

// Determine credentials path (same logic as ClaudeClient)
const credentialsPath = "/home/claudepulse/.claude/.credentials.json";

// Load auth config
const authConfig = new AuthConfig(
  path.join(path.dirname(credentialsPath), ".auth-config.json"),
);
await authConfig.load();

// Create logger for verification
const logger = new Logger({ service: "oauth-verify" });

// Create CredentialStore
const credentialStore = new CredentialStore({
  credentialsPath,
  logger,
  authConfig,
});

// Create OAuthStateStore
const oauthStatePath = path.join(
  path.dirname(credentialsPath),
  ".oauth-pending.json",
);
const stateStore = new OAuthStateStore({
  statePath: oauthStatePath,
  logger,
});

// Verify OAuth code
OAuthManager.verifyOAuthCode(
  authCode,
  credentialsPath,
  authConfig,
  stateStore,
).then((result) => process.exit(result.success ? 0 : 1));
