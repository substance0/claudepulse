import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveAppVersion } from "../src/core/utils/appVersion.js";

test("prefers the version the image was built as", () => {
  assert.equal(
    resolveAppVersion({ CLAUDEPULSE_VERSION: "1.0.1-snapshot.20" }, "1.0.0"),
    "1.0.1-snapshot.20",
  );
});

test("falls back to package.json outside an image", () => {
  assert.equal(resolveAppVersion({}, "1.0.0"), "1.0.0");
});

test("ignores the Dockerfile's placeholder for local builds", () => {
  assert.equal(
    resolveAppVersion({ CLAUDEPULSE_VERSION: "unknown" }, "1.0.0"),
    "1.0.0",
  );
});
