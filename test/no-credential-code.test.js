import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

/** Every .js file under a directory, recursively. */
async function walk(dir) {
  const out = [];

  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }

  return out;
}

/** Source files containing the given text. */
async function filesContaining(text) {
  const offenders = [];

  for (const file of await walk("src")) {
    if ((await fs.readFile(file, "utf8")).includes(text)) {
      offenders.push(file);
    }
  }

  return offenders;
}

test("no source file rewrites subscriptionType", async () => {
  assert.deepEqual(await filesContaining("subscriptionType"), []);
});

test("no source file reads or writes the credentials file", async () => {
  assert.deepEqual(await filesContaining(".credentials.json"), []);
});

test("the Agent SDK is no longer a dependency", async () => {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.equal(pkg.dependencies?.["@anthropic-ai/claude-agent-sdk"], undefined);
});
