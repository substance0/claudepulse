#!/usr/bin/env node

/**
 * OAuth Status Check Script
 * Displays current OAuth authentication status using dependency injection
 */

import ClaudeClient from "../features/claude/client/ClaudeClient.js";
import AuthConfig from "../core/config/auth-config.js";
import { OAuthManager } from "../features/auth/oauth/OAuthManager.js";
import CredentialStore from "../features/auth/CredentialStore.js";
import OAuthStateStore from "../features/auth/OAuthStateStore.js";
import { Logger } from "../core/utils/logger.js";
import SdkExecutor from "../features/claude/executor/SdkExecutor.js";
import ClaudeSdkAdapter from "../features/claude/client/ClaudeSdkAdapter.js";
import ApiClient from "../features/claude/client/ApiClient.js";
import path from "path";
import os from "os";

async function checkOAuthStatus() {
  try {
    // Build dependency graph (same as main app)
    const logger = new Logger({ service: "oauth-status" });
    const authConfig = new AuthConfig();
    await authConfig.load();

    const credentialsPath = path.join(
      os.homedir(),
      ".claude",
      ".credentials.json",
    );

    const clientLogger = logger.child({ component: "claude-client" });

    const credentialStore = new CredentialStore({
      credentialsPath,
      logger: clientLogger,
      authConfig,
    });

    const oauthStatePath = path.join(
      path.dirname(credentialsPath),
      ".oauth-pending.json",
    );
    const stateStore = new OAuthStateStore({
      statePath: oauthStatePath,
      logger: clientLogger,
    });

    const oauthManager = new OAuthManager({
      credentialsPath,
      authConfig,
      logger: clientLogger,
      credentialStore,
      stateStore,
    });

    const sdkExecutor = new SdkExecutor({
      logger: clientLogger,
    });

    const sdkAdapter = new ClaudeSdkAdapter({
      sdkExecutor,
      logger: clientLogger,
    });

    const apiClient = new ApiClient({
      sdkAdapter,
      logger: clientLogger,
      maxRetries: 3,
      retryBackoffMultiplier: 2,
      maxBackoffMinutes: 30,
    });

    const client = new ClaudeClient({
      credentialsPath,
      logger: clientLogger,
      authConfig,
      oauthManager,
      credentialStore,
      apiClient,
    });

    // Get authentication status
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

    console.log(JSON.stringify(status, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("Error checking OAuth status:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkOAuthStatus();
