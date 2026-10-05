import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { runUntilStopped } from "./helpers/runApp.js";

const HOUR_S = 60 * 60;

/** A stand-in Discord server: records the embeds posted to each path. */
async function startFakeDiscord(t) {
  const posted = { errors: [], window: [] };
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const key = request.url.includes("errors") ? "errors" : "window";
      posted[key].push(JSON.parse(body).embeds[0]);
      response.writeHead(204).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { posted, base: `http://127.0.0.1:${server.address().port}` };
}

/**
 * A directory holding a `claude` script that prints a canned stream, so the
 * app's pulse never reaches the real CLI.
 */
async function fakeClaude(t, lines) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claudepulse-fake-claude-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const output = path.join(dir, "output.jsonl");
  await fs.writeFile(output, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  await fs.writeFile(path.join(dir, "claude"), `#!/bin/sh\ncat "${output}"\n`, { mode: 0o755 });
  return dir;
}

const RESULT = {
  type: "result",
  is_error: false,
  total_cost_usd: 0.015,
  duration_ms: 1,
  session_id: "s",
  result: "ok",
};

function rateLimitEvent(info) {
  return { type: "rate_limit_event", rate_limit_info: info, uuid: "u", session_id: "s" };
}

test("a pulse that ran on extra usage reaches the errors webhook, the window webhook and the log", async (t) => {
  // Arrange: the weekly limit is reached, and the CLI reports the pulse ran on credits
  const lift = Math.floor(Date.now() / 1000) + 72 * HOUR_S;
  const bin = await fakeClaude(t, [
    rateLimitEvent({
      status: "rejected",
      resetsAt: lift,
      rateLimitType: "seven_day",
      overageStatus: "allowed",
      isUsingOverage: true,
      unifiedWindows: { seven_day: { utilization: 1, resetsAt: lift } },
    }),
    RESULT,
  ]);
  const discord = await startFakeDiscord(t);

  // Act: the real app runs its startup pulse against the fake CLI
  const output = await runUntilStopped({
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    IMMEDIATE_PULSE_AFTER_AUTH: "true",
    DISCORD_ERROR_WEBHOOK_URL: `${discord.base}/errors`,
    DISCORD_WINDOW_WEBHOOK_URL: `${discord.base}/window`,
  });

  // Assert
  assert.equal(discord.posted.errors.length, 1, output);
  assert.equal(discord.posted.errors[0].title, "Extra usage in use");
  assert.match(discord.posted.errors[0].description, /weekly limit is reached/);
  assert.equal(discord.posted.window.length, 1, output);
  assert.equal(discord.posted.window[0].title, "Extra usage in use");
  assert.match(output, /\[WARN\] \[PULSE\] Pulse ran on paid extra usage \(limit=weekly\)/);
  assert.match(output, /overage=on/);
});

test("an ordinary pulse posts to the window webhook only", async (t) => {
  const reset = Math.floor(Date.now() / 1000) + 3 * HOUR_S;
  const bin = await fakeClaude(t, [
    rateLimitEvent({
      status: "allowed",
      resetsAt: reset,
      rateLimitType: "five_hour",
      overageStatus: "rejected",
      overageDisabledReason: "out_of_credits",
      isUsingOverage: false,
      unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: reset } },
    }),
    RESULT,
  ]);
  const discord = await startFakeDiscord(t);

  const output = await runUntilStopped({
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    IMMEDIATE_PULSE_AFTER_AUTH: "true",
    DISCORD_ERROR_WEBHOOK_URL: `${discord.base}/errors`,
    DISCORD_WINDOW_WEBHOOK_URL: `${discord.base}/window`,
  });

  assert.deepEqual(discord.posted.errors, [], output);
  assert.equal(discord.posted.window.length, 1, output);
  assert.equal(discord.posted.window[0].title, "Window open");
  assert.doesNotMatch(output, /paid extra usage/);
});
