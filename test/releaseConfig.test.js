import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const config = JSON.parse(fs.readFileSync(".releaserc.json", "utf8"));

const gitAssets = () => {
  const plugin = config.plugins.find((p) => Array.isArray(p) && p[0] === "@semantic-release/git");
  return plugin[1].assets;
};

test("the release commit carries every file the release rewrites", () => {
  // @semantic-release/npm runs `npm version`, which sets the version in both files.
  assert.deepEqual([...gitAssets()].sort(), ["CHANGELOG.md", "package-lock.json", "package.json"]);
});

test("the npm plugin runs before the git plugin and never publishes", () => {
  const names = config.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(names.indexOf("@semantic-release/npm") < names.indexOf("@semantic-release/git"));
  const npm = config.plugins.find((p) => Array.isArray(p) && p[0] === "@semantic-release/npm");
  assert.equal(npm[1].npmPublish, false);
});
