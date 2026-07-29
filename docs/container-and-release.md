# Container and release supply chain

The production image runs the verified source on Node.js 24 LTS as the unprivileged `node` user. It writes only to `/var/lib/onyx`, listens on port 3000, and fails closed unless bearer authentication is configured.

## Build and run

```bash
docker build --tag onyx-ifem:local .
docker volume create onyx-data
docker run --rm \
  --name onyx-ifem \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --mount type=volume,source=onyx-data,target=/var/lib/onyx \
  --mount type=bind,source=/absolute/path/onyx-auth-public.pem,target=/run/secrets/onyx-auth-public.pem,readonly \
  --env ONYX_AUTH_ISSUER=https://identity.example.com \
  --env ONYX_AUTH_AUDIENCE=onyx-ifem-api \
  --publish 127.0.0.1:3000:3000 \
  onyx-ifem:local
```

The health check calls `/healthz`. Use `/readyz` at the orchestrator or load balancer level so a replica is not sent traffic when its durable database or outbox is unavailable. Mount the database directory from storage with reliable POSIX locking and persist the SQLite WAL files with the database.

Authentication is intentionally required in the image. For isolated local evaluation only, pass `--env ONYX_AUTH_MODE=disabled`; never publish that instance to an untrusted network.

## Continuous verification

Every pull request and push to `main` runs the contract and OpenAPI validators, strict type checking, the complete test suite, `npm audit`, CycloneDX generation, and a production container build. The container job also verifies the non-root user and image health check. Dependency updates for npm, GitHub Actions, and the Node base image are proposed weekly by Dependabot.

## Create a release

1. Update `version` in `package.json` and `package-lock.json` and merge the fully verified change.
2. Create and push a matching annotated tag, for example `v0.1.0` for package version `0.1.0`.
3. The Release workflow re-runs all validation and publishes `linux/amd64` and `linux/arm64` images to `ghcr.io/<owner>/<repository>`.
4. The workflow creates the GitHub release with a CycloneDX application SBOM and its SHA-256 checksum.

BuildKit attaches maximum-mode provenance and an image SBOM to the registry image. Use the digest shown in the workflow summary for immutable deployments:

```text
ghcr.io/lamatech-dev/onyx-ifem@sha256:<digest>
```

Inspect registry attestations with Buildx:

```bash
docker login ghcr.io
docker buildx imagetools inspect ghcr.io/lamatech-dev/onyx-ifem:0.1.0 --format '{{ json .Provenance }}'
docker buildx imagetools inspect ghcr.io/lamatech-dev/onyx-ifem:0.1.0 --format '{{ json .SBOM }}'
```

GitHub artifact attestations are not a required release step because private repositories require GitHub Enterprise Cloud for that service. Registry-native BuildKit provenance and SBOM attestations remain attached to the published image.
