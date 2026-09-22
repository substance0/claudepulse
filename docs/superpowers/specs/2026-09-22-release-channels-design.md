# Release Channels for ClaudePulse

**Date:** 2026-09-22
**Status:** Design approved, pending implementation plan
**Related:** `2026-09-22-pulse-execution-design.md`

> **Sequencing note.** Pulse execution moves to a `claude -p` subprocess and
> deletes the OAuth credential layer and the Agent SDK dependency. That lands
> first: it removes files this pipeline would otherwise build and publish. The
> channel model, tag scheme and workflow structure below are unaffected — only
> the contents of the image change.

## Problem

ClaudePulse publishes one container image, `ghcr.io/substance0/claudepulse`, and
has exactly one way to publish it: a release. That forces two bad outcomes.

Testing a change requires either building on the NAS (an Intel Celeron J4025,
roughly twenty minutes for `npm ci` plus a global npm install) or cutting a real
release. Neither is acceptable for verifying a one-line fix.

Anyone wanting a merged feature before the next version has no way to get it.
Their only options are `latest`, which lags, or building from source.

A third problem surfaced while investigating: `docker-release.yml` triggers on
`workflow_run: ["Release"] completed`. That event fires on *any* conclusion, so
every push to `main` rebuilds and republishes `latest` whether or not a release
was cut. Any design that publishes on each `main` commit makes this broken
trigger load-bearing, so it must be fixed as part of this work.

## Goals

- Publish a testable image from any branch without touching production tags
- Publish an image from every `main` commit for early adopters
- Make every build pinnable to an exact commit
- Keep the test suite as a gate on everything published
- Make it impossible for a non-release build to write `latest`

## Non-goals

- Multi-version support. One deployment target, no old versions in the wild.
- Retention/GC of old snapshot tags. Deferred until tags actually accumulate.
- Changing how stable releases are versioned. semantic-release keeps that job.

## The decision rule

> Channels are derived from events, not from long-lived branches — except where
> a channel must accumulate state over time.

A long-lived branch earns its place only when a channel collects work in
parallel with ongoing stable maintenance. Everything else is an event on the
trunk.

This follows the primary sources. Driessen, annotating his own git-flow model in
2020: *"If your team is doing continuous delivery of software, I would suggest
to adopt a much simpler workflow (like GitHub flow) instead of trying to
shoehorn git-flow into your team."* He retains git-flow only for projects with
explicit versioning or multiple supported versions in production.

semantic-release scopes prerelease branches to the case where you want to
publish per-feature builds *"until all the features are developed"* — that is,
accumulating a future major while stable keeps shipping.

ClaudePulse meets none of those conditions: it is continuously delivered to a
single target, no one runs multiple versions, and no parallel major is in
development. Therefore edge belongs on the trunk, and `develop` has no role.

## Channel model

| Channel  | Source                   | Tags                                  | Audience       |
| -------- | ------------------------ | ------------------------------------- | -------------- |
| Stable   | release on `main`        | `latest`, `X.Y.Z`, `X.Y`, `X`         | everyone       |
| Edge     | every push to `main`     | `edge`, `X.Y.Z-dev.N`, `sha-<short>`  | early adopters |
| Snapshot | manual dispatch, any ref | `snapshot-<branch>`, `sha-<short>`    | the developer  |

`sha-<short>` is emitted by every channel. It is the immutable handle: a moving
tag answers "what is newest", `sha-` answers "exactly which build is this", and
rollback needs the latter.

`edge` is a first-class primitive in `docker/metadata-action` (`type=edge`),
documented as reflecting the last commit of the active branch. It is the same
mechanism Alpine, Grafana and Home Assistant use.

## Branch mapping

`main` is the only long-lived branch. Feature branches are ephemeral and
produce snapshots on demand.

`develop` is retired. It is byte-identical to `main` (zero commits in either
direction, both at `761d7ac` locally and on the remote) and serves no channel
under the decision rule above.

## Versioning

Stable versions remain semantic-release's responsibility, unchanged.

Edge builds derive a version in CI from `git describe --tags`, which now
resolves as `v1.0.0-1-g761d7ac`, yielding `1.0.1-dev.1+g761d7ac`. This needs no
new branch and no semantic-release configuration change. It sorts below the next
stable release, so it is pinnable without ever shadowing a real version.

This derivation was blocked until 2026-09-22 by five orphaned local tags
(`v1.0.0` through `v1.1.3`) that pointed at unreachable commits and were never
pushed. Local `v1.0.0` disagreed with the remote's. They have been deleted and
the correct `v1.0.0` refetched. The remote's release history was always
coherent; the drift was local only.

## Workflows

**`docker-snapshot.yml`** (new)
Trigger `workflow_dispatch` only. Runs `npm test`, then builds `linux/amd64`
alone — the NAS is amd64, so a second architecture only costs time. Tags:
`type=ref,event=branch,prefix=snapshot-` and `type=sha,prefix=sha-,format=short`.

**`docker-edge.yml`** (new)
Trigger `push` to `main`. Runs `npm test`, builds multi-arch, tags `type=edge`
plus the derived dev version and `sha-`.

**`docker-release.yml`** (fix)
Guard the `workflow_run` trigger so it requires `conclusion == 'success'` *and*
evidence that a release was actually published. Today it republishes `latest` on
every `main` push.

No workflow except `docker-release.yml` may emit `latest` or a bare `X.Y.Z`.
This is enforced by tag configuration, not convention: the other workflows have
no rule that can produce those tags.

## Supply chain

Every channel attests build provenance via `actions/attest`, requiring
`id-token: write` and `attestations: write`. Consumers verify with:

```
gh attestation verify oci://ghcr.io/substance0/claudepulse:<tag> -R substance0/claudepulse
```

Attestations are added now rather than later because retrofitting them means
rebuilding and re-publishing every tag.

## Consumption

A separate Portainer stack, `claudepulse-dev`, consumes `snapshot-*` on the NAS.
It uses its own container name and an `env_file` at `/data/secrets/claudepulse.env`,
and deliberately mounts **no volume**: with no credentials file present, a
successful pulse is proof that `CLAUDE_CODE_OAUTH_TOKEN` authenticated the run.
Stack 278 is untouched.

Portainer resolves `env_file` paths inside its own container, where `/data` maps
to `/volume1/docker/portainer`. Secrets therefore live at
`/volume1/docker/portainer/secrets/` and keep values out of the stack `Env`
array, where `GET /stacks` would expose them.

## Failure modes

`npm test` gates every channel, so a failing suite blocks publication rather
than shipping a broken image.

A snapshot build cannot damage production: its tag rules cannot generate
`latest` or a version tag, and the dev stack is a separate stack with a separate
container.

If a moving tag is ever published from the wrong commit, `sha-` tags provide an
exact rollback target, and the attestation identifies which workflow and commit
produced any given digest.

Portainer's stack update API is synchronous and can time out while Compose is
still working. A timeout is not a failure: verify the container's
`com.docker.compose.project.config_files` label to see which version actually
deployed before retrying, or a retry may tear down a healthy container.

## Testing

The 20 existing tests run via `npm test` (`node --test`), with no test
dependency — Node's built-in runner, already present in the `node:20-alpine`
base image.

Pipeline verification, in order:

1. Dispatch a snapshot from a feature branch; confirm only `snapshot-*` and
   `sha-*` tags appear and `latest` is untouched.
2. Deploy that snapshot to `claudepulse-dev`; confirm the logs show the token
   path and a successful pulse.
3. Push to `main`; confirm `edge` and the dev version publish, and that `latest`
   is *not* republished — which is the regression test for the `workflow_run`
   guard.

## Sequencing

`workflow_dispatch` only works when the workflow file is on the default branch:
*"This event will only trigger a workflow run if the workflow file exists on the
default branch."* So `docker-snapshot.yml` must land on `main` before any
snapshot can be built, and the feature branch must be pushed for CI to check out
the code it builds.

Retiring `develop` is blocked until the 21 uncommitted files in the
`~/git/claudepulse` worktree are committed, stashed, or discarded. That work
modifies `getAuthStatus` in `ClaudeClient.js`, the same function changed on
`feat/honour-claude-code-oauth-token`, so the two will likely conflict. Resolving
it is a prerequisite, not a side task.

## Open items

None outstanding. Two items are decided elsewhere in this document and listed
here only to say where:

- The `docker-release.yml` guard is **in scope** (see Problem and Workflows).
  Publishing on every `main` commit makes the existing bug materially worse, so
  it cannot be deferred.
- Tag retention is a **non-goal** for this design (see Non-goals).

The prerequisites in Sequencing are not open questions — they are ordering
constraints that the implementation plan must respect.
