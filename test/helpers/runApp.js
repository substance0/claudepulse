import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The application entry point, found from this file so any cwd works. */
const ENTRY = fileURLToPath(new URL("../../src/index.js", import.meta.url));
/** Time for the app to finish starting after it reports running. */
const SETTLE_MS = 500;
/** How often the output file is checked for the "running" line. */
const POLL_MS = 50;
/** How long the app may take to report running before the run fails. */
const START_TIMEOUT_MS = 20000;

/**
 * Start the app with no startup pulse, so nothing reaches Claude, wait until
 * it reports running, stop it with SIGTERM and return everything it printed.
 * Discord webhooks and STATE_DIR are blanked so a test never posts to a real
 * channel or inherits a state directory from the shell, and the settings that
 * change what the app logs or when it pulses are pinned to their defaults.
 *
 * stdout and stderr share one file. Writes to a file are synchronous, so its
 * lines keep the order the app wrote them in; two pipes read side by side
 * would only give the order their chunks arrived in.
 * @param {Object} env - Extra environment variables
 * @param {{cwd?: string, timeoutMs?: number}} [options] - Working directory of
 *   the app, and how long it may take to report running
 * @returns {Promise<string>} Combined stdout and stderr, in write order;
 *   rejects, with what the app printed, when it never reports running
 */
export async function runUntilStopped(
  env,
  { cwd, timeoutMs = START_TIMEOUT_MS } = {},
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claudepulse-run-"));
  const outputFile = path.join(dir, "output.log");
  const fd = fs.openSync(outputFile, "w");

  try {
    const child = spawn(process.execPath, [ENTRY], {
      cwd,
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: "placeholder",
        IMMEDIATE_PULSE_AFTER_AUTH: "false",
        DISCORD_ERROR_WEBHOOK_URL: "",
        DISCORD_WINDOW_WEBHOOK_URL: "",
        STATE_DIR: "",
        ACCOUNT_LABEL: "",
        LOG_LEVEL: "INFO",
        TOKEN_EXPIRES_AT: "",
        DRY_RUN: "false",
        WORK_HOURS_ENABLED: "false",
        SCHEDULED_START_HOUR: "",
        NO_COLOR: "1",
        ...env,
      },
      stdio: ["ignore", fd, fd],
    });

    await new Promise((resolve, reject) => {
      // The signal handlers are installed just after the "running" line is
      // printed; a signal sent before them would end the process unlogged.
      const poll = setInterval(() => {
        if (fs.readFileSync(outputFile, "utf8").includes("automation running")) {
          clearInterval(poll);
          clearTimeout(startTimer);
          setTimeout(() => child.kill("SIGTERM"), SETTLE_MS);
        }
      }, POLL_MS);
      const startTimer = setTimeout(() => {
        clearInterval(poll);
        child.kill("SIGKILL");
        reject(
          new Error(
            `The app did not report running within ${timeoutMs} ms:\n${fs.readFileSync(outputFile, "utf8")}`,
          ),
        );
      }, timeoutMs);
      child.on("error", (error) => {
        clearInterval(poll);
        clearTimeout(startTimer);
        reject(error);
      });
      child.on("exit", () => {
        clearInterval(poll);
        clearTimeout(startTimer);
        resolve();
      });
    });

    return fs.readFileSync(outputFile, "utf8");
  } finally {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
