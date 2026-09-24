import { test } from "node:test";
import assert from "node:assert/strict";

import { devVersion } from "../scripts/dev-version.mjs";

test("bumps the patch of the last release and counts commits since it", () => {
  assert.equal(devVersion("v1.0.0-20-g761d7ac"), "1.0.1-dev.20");
});

test("labels snapshot builds as snapshots", () => {
  assert.equal(
    devVersion("v1.0.0-20-g761d7ac", { channel: "snapshot" }),
    "1.0.1-snapshot.20",
  );
});

test("still produces a prerelease on the release commit itself", () => {
  // 1.0.1-dev.0 sorts below 1.0.1, so it never shadows a real release
  assert.equal(devVersion("v1.0.0-0-g89921a2"), "1.0.1-dev.0");
});

test("falls back when no release tag is reachable", () => {
  assert.equal(devVersion(null, { commitCount: 42 }), "0.0.1-dev.42");
});

test("falls back on output it does not recognise", () => {
  assert.equal(devVersion("89921a2", { commitCount: 7 }), "0.0.1-dev.7");
});

test("uses only characters a Docker tag accepts", () => {
  for (const describe of ["v1.0.0-20-g761d7ac", null]) {
    for (const channel of ["dev", "snapshot"]) {
      assert.match(devVersion(describe, { channel }), /^[A-Za-z0-9_.-]+$/);
    }
  }
});

test("rejects an unknown channel", () => {
  assert.throws(() => devVersion("v1.0.0-1-gabc1234", { channel: "latest" }));
});
