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

/**
 * Start the app with no startup pulse, so nothing reaches Claude, wait until
 * it reports running, stop it with SIGTERM and return everything it printed.
 * Discord webhooks and STATE_DIR are blanked so a test never posts to a real
 * channel or inherits a state directory from the shell.
 *
 * stdout and stderr share one file. Writes to a file are synchronous, so its
 * lines keep the order the app wrote them in; two pipes read side by side
 * would only give the order their chunks arrived in.
 * @param {Object} env - Extra environment variables
 * @param {{cwd?: string}} [options] - Working directory of the app
 * @returns {Promise<string>} Combined stdout and stderr, in write order
 */
export async function runUntilStopped(env, { cwd } = {}) {
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
        DISCORD_WEBHOOK_URL: "",
        DISCORD_WINDOW_WEBHOOK_URL: "",
        STATE_DIR: "",
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
          setTimeout(() => child.kill("SIGTERM"), SETTLE_MS);
        }
      }, POLL_MS);
      child.on("error", (error) => {
        clearInterval(poll);
        reject(error);
      });
      child.on("exit", () => {
        clearInterval(poll);
        resolve();
      });
    });

    return fs.readFileSync(outputFile, "utf8");
  } finally {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
