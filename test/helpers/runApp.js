import { spawn } from "node:child_process";

/** Time for the app to finish starting after it reports running. */
const SETTLE_MS = 500;

/**
 * Start the app with no startup pulse, so nothing reaches Claude, wait until
 * it reports running, stop it with SIGTERM and return everything it printed.
 * Discord webhooks are blanked so a test never posts to a real channel.
 * @param {Object} env - Extra environment variables
 * @returns {Promise<string>} Combined stdout and stderr
 */
export function runUntilStopped(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/index.js"], {
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: "placeholder",
        IMMEDIATE_PULSE_AFTER_AUTH: "false",
        DISCORD_WEBHOOK_URL: "",
        DISCORD_WINDOW_WEBHOOK_URL: "",
        NO_COLOR: "1",
        ...env,
      },
    });
    let output = "";
    let stopping = false;
    const collect = (chunk) => {
      output += chunk;
      // The signal handlers are installed just after this line is printed;
      // a signal sent before them would end the process without logging.
      if (!stopping && output.includes("automation running")) {
        stopping = true;
        setTimeout(() => child.kill("SIGTERM"), SETTLE_MS);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("exit", () => resolve(output));
  });
}
