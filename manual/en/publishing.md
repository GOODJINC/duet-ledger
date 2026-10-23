# Publishing images (maintainers)

[Manual home](index.md) · [Installation](installation.md)

Images are configured for `ghcr.io/goodjinc/duet-ledger`. **Committing these files does not make an image available. Complete the first publication and set the package to Public.**

## First publication

1. Push local changes to GitHub `main`. In **Actions**, check that `Docker image` tests pass. Ordinary pushes run checks without publishing.
2. Open **Docker image → Run workflow → main → Run workflow**. After tests, the current app version (`0.1.0-alpha.12`) is built for AMD64 and ARM64 and published to GHCR. Wait for completion.
3. Open your GitHub profile → **Packages → duet-ledger → Package settings → Change visibility → Public**. Repository visibility and package visibility are separate. Public images allow anonymous downloads.
4. Verify from another environment that is **not signed into GHCR**. There is no need to erase credentials on your running server.

```bash
docker pull ghcr.io/goodjinc/duet-ledger:0.1.0-alpha.12
```

No personal token is needed. The workflow uses `GITHUB_TOKEN` with `packages: write`. Enable workflows under repository Settings → Actions if currently disabled.

## Subsequent versions

Update the app version, UI version display, OpenAPI version, default Compose image tag and changelog. Validate and commit. Publish a GitHub Release using a matching `vVERSION` tag to publish automatically. For app `0.1.0-beta.1`, use `v0.1.0-beta.1` and check **Set as a pre-release**. For stable `1.0.0`, leave prerelease unchecked.

| App version | Image tags |
| --- | --- |
| `0.1.0-alpha.12` | `0.1.0-alpha.12`, `alpha` |
| `0.1.0-beta.1` | `0.1.0-beta.1`, `beta` |
| `0.1.0-rc.1` | `0.1.0-rc.1`, `rc` |
| `1.0.0` | `1.0.0`, `latest` |

Prereleases never update `latest`. Re-publishing an existing version is rejected. If a job fails just after uploading, inspect package state; use a new app version when changing an image. Prefer exact version tags for operation.

Build targets are `linux/amd64` and `linux/arm64`, not 32-bit ARM or Windows containers. Local checks cover AMD64 execution and ARM64 cross-compilation. Actual registry publication and final ARM64 image builds must be confirmed by a successful Actions run.

## Compose files

- `compose.yaml`: published image installation, binds to127.0.0.1 by default.
- `compose.arcane.yaml`: Arcane/LAN preset, binds to0.0.0.0 for network access.
- `compose.build.yaml`: source-build override: `docker compose -f compose.yaml -f compose.build.yaml up -d --build`.

After editing the main Compose file, regenerate the Arcane preset using `node scripts/sync-compose.mjs`; verify with `--check`.

## Publishing errors

- 403/permission denied: check package **Manage Actions access** and workflow `packages: write`. A package previously published another way may need its repository linked explicitly.
- Pull still fails after Public: verify the version was actually published. Do not use `latest` or `beta` before those tags exist.
- Version mismatch: match the release tag to the app version and select prerelease correctly.
- Manual publish skipped: run from the default branch `main`.

[GitHub GHCR documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) · [Docker multi-platform builds](https://docs.docker.com/build/ci/github-actions/multi-platform/)
