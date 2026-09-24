import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => fs.readFileSync(`.github/workflows/${name}`, "utf8");
const lines = (text) => text.split("\n").map((l) => l.trim());

test("the build never lets metadata-action add latest on its own", () => {
  assert.match(read("docker-build.yml"), /latest=false/);
});

test("only the release channel can produce latest", () => {
  const latest = lines(read("docker-build.yml")).filter((l) =>
    /value=latest/.test(l),
  );
  assert.deepEqual(latest, [
    "type=raw,value=latest,enable=${{ inputs.channel == 'release' }}",
  ]);
});

test("snapshots are tagged by branch, never by version", () => {
  const text = read("docker-build.yml");
  assert.match(
    text,
    /type=ref,event=branch,prefix=snapshot-,enable=\$\{\{ inputs\.channel == 'snapshot' \}\}/,
  );
  assert.match(
    text,
    /type=raw,value=\$\{\{ steps\.version\.outputs\.version \}\},enable=\$\{\{ inputs\.channel != 'snapshot' \}\}/,
  );
});

test("the build job waits for the test job", () => {
  assert.match(read("docker-build.yml"), /needs: test/);
});

test("checks out full history so git describe finds the last tag", () => {
  assert.match(read("docker-build.yml"), /fetch-depth: 0/);
});

test("labels the image with the commit actually built, not the trigger", () => {
  const text = read("docker-build.yml");
  assert.match(text, /git rev-parse HEAD/);
  assert.match(
    text,
    /org\.opencontainers\.image\.revision=\$\{\{ steps\.version\.outputs\.revision \}\}/,
  );
});

test("attests build provenance to the registry", () => {
  const text = read("docker-build.yml");
  assert.match(text, /uses: actions\/attest@v4/);
  assert.match(text, /push-to-registry: true/);
  assert.match(text, /artifact-metadata: write/);
});
