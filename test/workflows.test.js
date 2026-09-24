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

const CALLER_PERMISSIONS = [
  "contents: read",
  "packages: write",
  "id-token: write",
  "attestations: write",
  "artifact-metadata: write",
];

test("snapshots run only on demand, for amd64", () => {
  const text = read("docker-snapshot.yml");
  assert.match(text, /workflow_dispatch/);
  assert.doesNotMatch(text, /^\s*push:/m);
  assert.match(text, /channel: snapshot/);
  assert.match(text, /platforms: linux\/amd64$/m);
});

test("edge runs on every push to main", () => {
  const text = read("docker-edge.yml");
  assert.match(text, /push:\s*\n\s*branches: \[main\]/);
  assert.match(text, /channel: edge/);
});

test("callers grant exactly what the build needs", () => {
  for (const name of ["docker-snapshot.yml", "docker-edge.yml"]) {
    const text = read(name);
    for (const permission of CALLER_PERMISSIONS) {
      assert.match(text, new RegExp(permission), `${name}: ${permission}`);
    }
  }
});

test("callers never mention latest", () => {
  for (const name of ["docker-snapshot.yml", "docker-edge.yml"]) {
    assert.doesNotMatch(read(name), /latest/, name);
  }
});

test("nothing is triggered by another workflow finishing", () => {
  for (const name of fs.readdirSync(".github/workflows")) {
    assert.doesNotMatch(read(name), /workflow_run/, name);
  }
});

test("the old release image workflow is gone", () => {
  assert.equal(fs.existsSync(".github/workflows/docker-release.yml"), false);
});

test("the release image is built only when semantic-release created a tag", () => {
  const text = read("release.yml");
  assert.match(text, /git tag --points-at HEAD/);
  assert.match(text, /if: needs\.release\.outputs\.tag != ''/);
});

test("the release image is built from the tagged release commit", () => {
  const text = read("release.yml");
  assert.match(text, /ref: \$\{\{ needs\.release\.outputs\.tag \}\}/);
  assert.match(text, /channel: release/);
});

test("release no longer syncs to the retired develop branch", () => {
  assert.doesNotMatch(read("release.yml"), /develop/);
});
