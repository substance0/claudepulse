# Release Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a testable image from any branch (`snapshot-*`), an early-adopter image from every `main` commit (`edge`), and release images only when a release is actually cut — with `latest` unreachable from the first two.

**Architecture:** One reusable workflow, `docker-build.yml`, owns every tag rule, the test gate, the build and the provenance attestation; three thin callers select a channel. `release.yml` detects whether semantic-release created a tag and calls the build only then, replacing `docker-release.yml`, whose `workflow_run` trigger republished `latest` after every run. Prerelease versions come from a small tested script over `git describe`.

**Tech Stack:** GitHub Actions (`actions/checkout@v7`, `actions/setup-node@v7`, `docker/setup-buildx-action@v4`, `docker/login-action@v4`, `docker/metadata-action@v6`, `docker/build-push-action@v7`, `actions/attest@v4`), Node 20 `node:test`, `actionlint` for workflow validation.

**Spec:** `docs/superpowers/specs/2026-09-22-release-channels-design.md`

## Global Constraints

- No workflow other than the release path may produce the `latest` tag or a bare `X.Y.Z` tag.
- `docker/metadata-action` always runs with `flavor: latest=false`. Its default, `latest=auto`, can add `latest` on its own.
- Docker tags allow only `[A-Za-z0-9_.-]`; metadata-action replaces anything else with `-`. Versions therefore carry no `+build` suffix; the `sha-` tag identifies the commit.
- Events created with `GITHUB_TOKEN` start no workflows except `workflow_dispatch` and `repository_dispatch` (GitHub docs). semantic-release publishes with `GITHUB_TOKEN`, so nothing may rely on `release` or `push` events it causes.
- `workflow_dispatch` works only when the workflow file exists on the default branch.
- The release image is built from the tagged release commit, never `github.sha`, which is the pre-release commit.
- `actions/attest@v4` needs `id-token: write`, `packages: write`, `contents: read`, `attestations: write`, `artifact-metadata: write`.
- Snapshot builds `linux/amd64` only (the NAS is amd64). Edge and release build `linux/amd64,linux/arm64`.
- No new npm dependencies. `node --test` only.

## Review Focus

1. **`latest` leaking into a snapshot or edge build** — through `latest=auto` or a mis-set `enable`. Pinned by Task 2's tag-rule tests.
2. **A Release run that cuts no release still publishing** — the original bug. Pinned by Task 4's `if` test.
3. **The release image built from the pre-release commit** — correct tag, wrong contents. Pinned by Task 4's `ref` test and Task 2's revision test.
4. **A prerelease version Docker would mangle** — pinned by Task 1's charset test.
5. **No reachable `v*` tag, or a shallow checkout** — `git describe` fails. Pinned by Task 1's fallback test and Task 2's `fetch-depth` test.

## Branching

`workflow_dispatch` needs the workflow on `main`, and merging the application branch to `main` would cut a release before anything is verified. So the pipeline lands on its own branch from `origin/main`, using only `ci:`/`test:`/`docs:` commits, which semantic-release does not release. `fix/outage-detection-and-alerting` then merges `main` in, and a snapshot of it is built and tested on the NAS before it is merged.

Task 5 changes application code and belongs on `fix/outage-detection-and-alerting`, not the pipeline branch, to avoid conflicts in `src/`.

---

### Task 1: Prerelease version from `git describe`

**Branch:** `ci/release-channels` (create from `origin/main`)

**Files:**
- Create: `scripts/dev-version.mjs`
- Create: `test/dev-version.test.js`
- Modify: `package.json` (add `"test": "node --test \"test/*.test.js\""`, identical to the application branch so the later merge is clean)

**Interfaces:**
- Produces: `devVersion(describe: string|null, options?: { channel?: "dev"|"snapshot", commitCount?: number }): string`, and a CLI `node scripts/dev-version.mjs [dev|snapshot]` printing the version. Task 2 calls the CLI.

- [ ] **Step 1: Create the branch**

```bash
git fetch origin
git switch -c ci/release-channels origin/main
```

- [ ] **Step 2: Write the failing test**

```js
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
```

- [ ] **Step 3: Add the test script and verify RED**

Add to `package.json` `scripts`: `"test": "node --test \"test/*.test.js\""`.

Run: `npm test`
Expected: FAIL — `Cannot find module .../scripts/dev-version.mjs`.

- [ ] **Step 4: Implement**

```js
#!/usr/bin/env node
/**
 * Derive a prerelease version for a non-release build.
 *
 * The version is the next patch after the last release tag, with a
 * prerelease label and the number of commits since that tag, for example
 * 1.0.1-dev.20. It sorts below the next real release, so it never shadows
 * one. It carries no "+build" suffix: Docker tags cannot contain "+"; the
 * image's sha- tag identifies the commit instead.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CHANNELS = new Set(["dev", "snapshot"]);

/** Output of `git describe --tags --long`, e.g. v1.0.0-20-g761d7ac */
const DESCRIBE = /^v?(\d+)\.(\d+)\.(\d+)-(\d+)-g[0-9a-f]+$/;

/**
 * @param {string|null} describe - `git describe --tags --long` output, or null
 * @param {{channel?: string, commitCount?: number}} [options]
 * @returns {string}
 */
export function devVersion(describe, { channel = "dev", commitCount = 0 } = {}) {
  if (!CHANNELS.has(channel)) {
    throw new Error(`Unknown channel: ${channel}`);
  }

  const match = DESCRIBE.exec((describe ?? "").trim());
  if (!match) {
    return `0.0.1-${channel}.${commitCount}`;
  }

  const [, major, minor, patch, since] = match;
  return `${major}.${minor}.${Number(patch) + 1}-${channel}.${since}`;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const channel = process.argv[2] ?? "dev";
  let describe = null;
  try {
    describe = git(["describe", "--tags", "--long", "--match", "v[0-9]*"]);
  } catch {
    describe = null;
  }
  const commitCount = Number(git(["rev-list", "--count", "HEAD"]));
  process.stdout.write(`${devVersion(describe, { channel, commitCount })}\n`);
}
```

- [ ] **Step 5: Verify GREEN and the CLI**

Run: `npm test` — Expected: 7 passing.
Run: `node scripts/dev-version.mjs` — Expected: `1.0.1-dev.1` (one commit past `v1.0.0` on `main`).

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/dev-version.mjs test/dev-version.test.js
git commit -m "ci: derive prerelease versions from git describe"
```

---

### Task 2: Reusable build workflow

**Files:**
- Create: `.github/workflows/docker-build.yml`
- Create: `test/workflows.test.js`

**Interfaces:**
- Consumes: `node scripts/dev-version.mjs [dev|snapshot]` from Task 1.
- Produces: reusable workflow `./.github/workflows/docker-build.yml` with inputs `channel` (`snapshot`|`edge`|`release`, required), `ref` (string, default `""`), `version` (`X.Y.Z`, release only), `platforms` (default `linux/amd64,linux/arm64`). Callers must grant the five permissions in Global Constraints.

- [ ] **Step 1: Install actionlint**

`brew install actionlint` — validates workflow syntax, expressions and embedded shell. Workflows cannot run locally, so this is the only pre-push syntax check.

- [ ] **Step 2: Write the failing test**

```js
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
```

- [ ] **Step 3: Verify RED**

Run: `npm test` — Expected: FAIL, `ENOENT ... docker-build.yml`.

- [ ] **Step 4: Implement**

```yaml
name: Docker Build

# Builds, tests, publishes and attests one image. Every tag rule lives here,
# so which channel may publish which tag is decided in one place.
on:
  workflow_call:
    inputs:
      channel:
        description: "snapshot, edge or release"
        required: true
        type: string
      ref:
        description: "Git ref to build; defaults to the triggering ref"
        required: false
        type: string
        default: ""
      version:
        description: "Release version X.Y.Z (release channel only)"
        required: false
        type: string
        default: ""
      platforms:
        description: "Target platforms"
        required: false
        type: string
        default: linux/amd64,linux/arm64

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@v7
        with:
          ref: ${{ inputs.ref }}
          persist-credentials: false

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: "20.x"

      # Tests use only Node built-ins, so no install step is needed.
      - name: Test
        run: npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
      artifact-metadata: write
    steps:
      - name: Validate inputs
        env:
          CHANNEL: ${{ inputs.channel }}
          VERSION: ${{ inputs.version }}
        run: |
          case "$CHANNEL" in
            snapshot|edge|release) ;;
            *) echo "Unknown channel: $CHANNEL" >&2; exit 1 ;;
          esac
          if [ "$CHANNEL" = release ] && ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
            echo "The release channel needs version X.Y.Z, got '$VERSION'" >&2
            exit 1
          fi

      - name: Checkout
        uses: actions/checkout@v7
        with:
          ref: ${{ inputs.ref }}
          fetch-depth: 0
          persist-credentials: false

      # The commit is read from the checkout, not github.sha: when release.yml
      # calls this workflow, github.sha is the commit before the release.
      - name: Compute version
        id: version
        env:
          CHANNEL: ${{ inputs.channel }}
          VERSION: ${{ inputs.version }}
        run: |
          case "$CHANNEL" in
            release)  v="$VERSION" ;;
            snapshot) v="$(node scripts/dev-version.mjs snapshot)" ;;
            *)        v="$(node scripts/dev-version.mjs dev)" ;;
          esac
          base="${v%%-*}"
          {
            echo "version=$v"
            echo "minor=${base%.*}"
            echo "major=${base%%.*}"
            echo "revision=$(git rev-parse HEAD)"
            echo "short=$(git rev-parse --short=7 HEAD)"
          } >> "$GITHUB_OUTPUT"

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v4
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # latest=false: metadata-action's default can add latest by itself.
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          flavor: |
            latest=false
          tags: |
            type=raw,value=sha-${{ steps.version.outputs.short }}
            type=ref,event=branch,prefix=snapshot-,enable=${{ inputs.channel == 'snapshot' }}
            type=raw,value=edge,enable=${{ inputs.channel == 'edge' }}
            type=raw,value=${{ steps.version.outputs.version }},enable=${{ inputs.channel != 'snapshot' }}
            type=raw,value=${{ steps.version.outputs.minor }},enable=${{ inputs.channel == 'release' }}
            type=raw,value=${{ steps.version.outputs.major }},enable=${{ inputs.channel == 'release' }}
            type=raw,value=latest,enable=${{ inputs.channel == 'release' }}
          labels: |
            org.opencontainers.image.revision=${{ steps.version.outputs.revision }}
            org.opencontainers.image.version=${{ steps.version.outputs.version }}

      - name: Build and push
        id: build
        uses: docker/build-push-action@v7
        with:
          context: .
          platforms: ${{ inputs.platforms }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            VERSION=${{ steps.version.outputs.version }}
            BUILD_DATE=${{ fromJSON(steps.meta.outputs.json).labels['org.opencontainers.image.created'] }}
            VCS_REF=${{ steps.version.outputs.revision }}
          cache-from: type=gha,scope=${{ inputs.channel }}
          cache-to: type=gha,mode=max,scope=${{ inputs.channel }}

      - name: Attest build provenance
        uses: actions/attest@v4
        with:
          subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true
```

- [ ] **Step 5: Verify GREEN**

Run: `npm test` — Expected: all passing.
Run: `actionlint .github/workflows/docker-build.yml` — Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/docker-build.yml test/workflows.test.js
git commit -m "ci: add reusable image build with tag rules and provenance"
```

---

### Task 3: Snapshot and edge callers

**Files:**
- Create: `.github/workflows/docker-snapshot.yml`, `.github/workflows/docker-edge.yml`
- Modify: `test/workflows.test.js`

**Interfaces:**
- Consumes: `docker-build.yml` from Task 2.
- Produces: `gh workflow run docker-snapshot.yml --ref <branch>`; edge on every push to `main`.

- [ ] **Step 1: Write the failing test** (append to `test/workflows.test.js`)

```js
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
```

- [ ] **Step 2: Verify RED** — `npm test` fails with `ENOENT ... docker-snapshot.yml`.

- [ ] **Step 3: Implement**

`.github/workflows/docker-snapshot.yml`:

```yaml
name: Docker Snapshot

# Build a testable image from any branch:
#   gh workflow run docker-snapshot.yml --ref <branch>
# Tags: snapshot-<branch>, sha-<short>. amd64 only - the target is the NAS.
on:
  workflow_dispatch:

permissions: {}

jobs:
  image:
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
      artifact-metadata: write
    uses: ./.github/workflows/docker-build.yml
    with:
      channel: snapshot
      platforms: linux/amd64
```

`.github/workflows/docker-edge.yml`:

```yaml
name: Docker Edge

# Every commit on main, for early adopters.
# Tags: edge, X.Y.Z-dev.N, sha-<short>.
on:
  push:
    branches: [main]

permissions: {}

concurrency:
  group: docker-edge
  cancel-in-progress: true

jobs:
  image:
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
      artifact-metadata: write
    uses: ./.github/workflows/docker-build.yml
    with:
      channel: edge
```

- [ ] **Step 4: Verify GREEN** — `npm test` passes; `actionlint` reports nothing.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docker-snapshot.yml .github/workflows/docker-edge.yml test/workflows.test.js
git commit -m "ci: publish snapshot images on demand and edge images from main"
```

---

### Task 4: Release publishes only when a release is cut

**Files:**
- Modify: `.github/workflows/release.yml`
- Delete: `.github/workflows/docker-release.yml`
- Modify: `test/workflows.test.js`

**Interfaces:**
- Consumes: `docker-build.yml`.
- Produces: job output `release.outputs.tag` (`vX.Y.Z` or empty) and `release.outputs.version` (`X.Y.Z` or empty).

- [ ] **Step 1: Write the failing test** (append)

```js
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
```

- [ ] **Step 2: Verify RED** — `npm test`: the first four fail.

- [ ] **Step 3: Implement**

Delete `docker-release.yml`. In `release.yml`, give the `release` job outputs, add a detection step after `Release`, remove the `Sync release to develop branch` step entirely (with its comment block), change the trigger comment `- main # Only trigger on main branch (develop pushes won't trigger this)` to `- main`, and add the `image` job:

```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.released.outputs.tag }}
      version: ${{ steps.released.outputs.version }}
    steps:
      # ... existing Checkout, Setup Node.js, Install dependencies, Release ...

      # semantic-release leaves HEAD on the release commit it tagged, or on
      # the unchanged commit when there was nothing to release.
      - name: Detect new release
        id: released
        run: |
          tag="$(git tag --points-at HEAD --list 'v[0-9]*' | head -n1)"
          echo "tag=$tag" >> "$GITHUB_OUTPUT"
          echo "version=${tag#v}" >> "$GITHUB_OUTPUT"

  image:
    needs: release
    if: needs.release.outputs.tag != ''
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
      artifact-metadata: write
    uses: ./.github/workflows/docker-build.yml
    with:
      channel: release
      ref: ${{ needs.release.outputs.tag }}
      version: ${{ needs.release.outputs.version }}
```

- [ ] **Step 4: Verify GREEN** — `npm test` passes; `actionlint` reports nothing.

- [ ] **Step 5: Commit**

```bash
git add -A .github/workflows test/workflows.test.js
git commit -m "ci: publish release images only when a release is cut"
```

---

### Task 5: The image reports the version it was built as

**Branch:** `fix/outage-detection-and-alerting`

**Files:**
- Create: `src/core/utils/appVersion.js`, `test/appVersion.test.js`
- Modify: `Dockerfile`, `src/index.js`

**Interfaces:**
- Produces: `resolveAppVersion(env: object, packageVersion: string): string`.

The spec requires the startup banner to identify the build. Today it prints `package.json`'s version, which is `1.0.0` in every snapshot and edge image; the `VERSION` build-arg reaches only an OCI label.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Verify RED** — `npm test` fails on the missing module.

- [ ] **Step 3: Implement**

`src/core/utils/appVersion.js`:

```js
/**
 * The version to report: the one the image was built as, when there is one.
 * Snapshot and edge images carry package.json's last released version, so
 * without this every build would report the same number.
 * @param {Object} env - Process environment
 * @param {string} packageVersion - Version from package.json
 * @returns {string}
 */
export function resolveAppVersion(env, packageVersion) {
  const built = env.CLAUDEPULSE_VERSION;
  return built && built !== "unknown" ? built : packageVersion;
}
```

`Dockerfile`, directly after the `ARG VCS_REF=unknown` line:

```dockerfile
# Reported at startup, so a running container identifies its build
ENV CLAUDEPULSE_VERSION=${VERSION}
```

`src/index.js`: replace `const { version: APP_VERSION } = require("../package.json");` with

```js
import { resolveAppVersion } from "./core/utils/appVersion.js";
```
(with the other imports) and

```js
const APP_VERSION = resolveAppVersion(
  process.env,
  require("../package.json").version,
);
```

- [ ] **Step 4: Verify GREEN** — `npm test` passes; `DRY_RUN=true CLAUDEPULSE_VERSION=9.9.9-dev.1 npm start` shows `9.9.9-dev.1` in the banner.

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/appVersion.js test/appVersion.test.js Dockerfile src/index.js
git commit -m "feat: report the version the image was built as"
```

---

### Task 6: Document the channels

**Branch:** `ci/release-channels`

**Files:** Modify `README.md`

- [ ] **Step 1:** Add a "Release channels" section after the installation section:

```markdown
## Release Channels

| Tag                        | Published                      | Use                          |
| -------------------------- | ------------------------------ | ---------------------------- |
| `latest`, `X.Y.Z`, `X.Y`, `X` | when a release is cut       | production                   |
| `edge`, `X.Y.Z-dev.N`      | every commit on `main`         | early access to merged work  |
| `snapshot-<branch>`        | on demand, from any branch     | testing a branch             |
| `sha-<commit>`             | every build                    | pinning an exact build       |

Build a snapshot of a branch:

    gh workflow run docker-snapshot.yml --ref <branch>

Every image carries build provenance. Verify one with:

    gh attestation verify oci://ghcr.io/substance0/claudepulse:<tag> -R substance0/claudepulse
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: describe release channels and provenance verification"
```

---

### Task 7: Land and verify

Each step here acts on GitHub or the NAS and is confirmed with the user first.

- [ ] **Step 1:** Push `ci/release-channels`, open a PR to `main`. The user merges it.
- [ ] **Step 2:** Confirm the merge cut no release (`gh release list` unchanged) and `Docker Edge` published `edge`, `1.0.1-dev.N` and `sha-<short>`:
  `docker buildx imagetools inspect ghcr.io/substance0/claudepulse:edge`
- [ ] **Step 3:** Confirm `latest` is unchanged: record its digest before Step 1, compare after.
- [ ] **Step 4:** On `fix/outage-detection-and-alerting`: `git merge origin/main`, push. Dispatch: `gh workflow run docker-snapshot.yml --ref fix/outage-detection-and-alerting`.
- [ ] **Step 5:** Confirm tags `snapshot-fix-outage-detection-and-alerting` and `sha-<short>` exist, `latest` is still unchanged, and `gh attestation verify` passes for the snapshot.
- [ ] **Step 6:** Create Portainer stack `claudepulse-dev` from the snapshot image: own container name, `env_file: /data/secrets/claudepulse.env`, `LOG_LEVEL=DEBUG`, no volume, no restart policy. Back up per the homelab conventions. Portainer's stack API is synchronous and can time out while Compose is still working: on a timeout, check the container's `com.docker.compose.project.config_files` label to see what deployed before retrying, or a retry can tear down a healthy container.
- [ ] **Step 7:** Confirm in its logs: the banner shows the snapshot version, the startup pulse succeeds with `window_resets=`, and the next pulse is scheduled by `window_reset`.
