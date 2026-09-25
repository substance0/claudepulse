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

test("snapshots run only on demand", () => {
  const text = read("docker-snapshot.yml");
  assert.match(text, /workflow_dispatch/);
  assert.doesNotMatch(text, /^\s*push:/m);
  assert.match(text, /channel: snapshot/);
});

test("edge runs on every push to main", () => {
  const text = read("docker-edge.yml");
  assert.match(text, /push:\s*\n\s*branches: \[main\]/);
  assert.match(text, /channel: edge/);
});

/**
 * The permissions a job declares, as sorted "scope: level" strings.
 * Reads the job's own block: from "  <job>:" to the next job at the same
 * indentation.
 */
function jobPermissions(text, job) {
  const start = text.indexOf(`\n  ${job}:\n`);
  assert.ok(start > -1, `job ${job} not found`);
  // Keep the newline that ends "  <job>:" so every key line starts with one
  const rest = text.slice(start + job.length + 4);
  const end = rest.search(/\n {2}[a-z][\w-]*:\n/);
  const block = end === -1 ? rest : rest.slice(0, end);
  const perms = block.match(/\n {4}permissions:\n((?: {6}[\w-]+: \w+\n)+)/);
  assert.ok(perms, `job ${job} declares no permissions`);
  return perms[1].trim().split("\n").map((l) => l.trim()).sort();
}

test("every caller grants exactly the permissions the build job uses", () => {
  const build = jobPermissions(read("docker-build.yml"), "build");
  assert.deepEqual(build, [...CALLER_PERMISSIONS].sort());
  const callers = [
    ["docker-snapshot.yml", "image"],
    ["docker-edge.yml", "image"],
    ["release.yml", "image"],
    ["docker-release-rebuild.yml", "image"],
  ];
  for (const [name, job] of callers) {
    assert.deepEqual(jobPermissions(read(name), job), build, `${name} ${job}`);
  }
});

test("the build rejects a version it could not compute", () => {
  // An empty or garbled version would publish an empty tag and label
  const text = read("docker-build.yml");
  assert.match(text, /Refusing to publish version/);
});

test("a release image is built only from the tag matching its version", () => {
  const text = read("docker-build.yml");
  assert.match(text, /REF: \$\{\{ inputs\.ref \}\}/);
  assert.match(text, /"\$REF" != "v\$VERSION"/);
});

test("snapshots are built only from branches whose tag fits Docker's limit", () => {
  const text = read("docker-build.yml");
  assert.match(text, /REF_TYPE: \$\{\{ github\.ref_type \}\}/);
  assert.match(text, /Snapshots are built from branches/);
  assert.match(text, /-gt 119/);
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

// node --test expands globs only from Node 21 on.
const nodeMajors = (text) =>
  [...text.matchAll(/node-version: "(\d+)\.x"/g)].map((m) => Number(m[1]));

test("every workflow that runs npm test uses a Node that expands test globs", () => {
  for (const name of ["docker-build.yml", "release.yml"]) {
    const majors = nodeMajors(read(name));
    assert.ok(majors.length > 0, name);
    for (const major of majors) assert.ok(major >= 22, `${name}: node ${major}`);
  }
});

test("a red test suite stops the release before it is cut", () => {
  const text = read("release.yml");
  const test = text.indexOf("run: npm test");
  const release = text.indexOf("run: npx semantic-release");
  assert.ok(test > -1 && test < release);
});

test("a published release can be rebuilt from its tag", () => {
  const text = read("docker-release-rebuild.yml");
  assert.match(text, /workflow_dispatch/);
  assert.match(text, /tag:/);
  assert.match(text, /channel: release/);
  assert.match(text, /ref: \$\{\{ inputs\.tag \}\}/);
  assert.match(text, /git rev-parse --verify/);
  for (const permission of CALLER_PERMISSIONS) {
    assert.match(text, new RegExp(permission), permission);
  }
});

test("snapshots never overwrite the sha tag of another channel", () => {
  assert.match(
    read("docker-build.yml"),
    /type=raw,value=sha-\$\{\{ steps\.version\.outputs\.short \}\},enable=\$\{\{ inputs\.channel != 'snapshot' \}\}/,
  );
});

test("a newer build never cancels one that is publishing", () => {
  for (const name of ["docker-edge.yml", "docker-snapshot.yml"]) {
    const text = read(name);
    assert.match(text, /concurrency:/, name);
    assert.match(text, /cancel-in-progress: false/, name);
    assert.doesNotMatch(text, /cancel-in-progress: true/, name);
  }
});

test("sets up QEMU before building for other architectures", () => {
  // BuildKit's built-in emulator crashes the Claude CLI's arm64 binary
  // (SIGILL) when the install step is not cached.
  const text = read("docker-build.yml");
  const qemu = text.indexOf("uses: docker/setup-qemu-action@");
  const buildx = text.indexOf("uses: docker/setup-buildx-action@");
  assert.ok(qemu > -1, "setup-qemu-action missing");
  assert.ok(qemu < buildx, "QEMU must be set up before Buildx");
});

test("a snapshot can be built for every platform on demand", () => {
  const text = read("docker-snapshot.yml");
  assert.match(text, /platforms:\n\s+description:/);
  assert.match(text, /default: linux\/amd64\n/);
  assert.match(text, /platforms: \$\{\{ inputs\.platforms \}\}/);
});

test("pull requests run the test suite and lint the workflows", () => {
  const text = read("pr-checks.yml");
  assert.match(text, /^on:\n\s+pull_request:/m);
  assert.match(text, /run: npm test/);
  assert.match(text, /actionlint/);
});

test("pull request checks get a read-only token", () => {
  const text = read("pr-checks.yml");
  assert.match(text, /^permissions:\n\s+contents: read$/m);
  assert.doesNotMatch(text, /pull_request_target/);
  assert.doesNotMatch(text, /secrets\./);
});

test("Dependabot never proposes an odd-numbered Node major", () => {
  const text = fs.readFileSync(".github/dependabot.yml", "utf8");
  for (const major of [25, 27, 29]) {
    assert.match(text, new RegExp(`"~> ${major}\\.0"`), `node ${major}`);
  }
  assert.match(text, /dependency-name: node/);
});
