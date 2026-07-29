# Kubernetes deployment

The Kustomize base in `deploy/kubernetes` deploys ONYX as a deliberately singleton StatefulSet. SQLite state belongs to one `ReadWriteOnce` persistent volume, so increasing `spec.replicas` would create independent databases rather than horizontal availability. Keep one replica until persistence is moved behind a shared transactional service.

## Security defaults

The namespace enforces the Restricted Pod Security Standard. The process runs as UID/GID 1000 with the runtime-default seccomp profile, a read-only root filesystem, no Linux capabilities, no privilege escalation, and no Kubernetes API token. Only `/var/lib/onyx` is writable.

The committed image digest is all zeros on purpose. A deployment cannot pull an image until an operator replaces it with the immutable digest emitted by the Release workflow. Authentication also fails closed: the public signing key and private GHCR credentials are not stored in Git.

## Prepare the environment

Render and inspect the base before applying it:

```bash
kubectl kustomize deploy/kubernetes
```

Replace the zero digest in `deploy/kubernetes/kustomization.yaml` with the digest from the trusted release workflow. Replace `https://identity.example.invalid` and the audience in `configmap.yaml` with the production identity values. Keep `ONYX_TRUST_PROXY=false` unless every path to the Service crosses a trusted proxy that overwrites `X-Forwarded-For`.

Create the namespace and required secrets:

```bash
kubectl apply -f deploy/kubernetes/namespace.yaml
kubectl -n onyx-ifem create secret generic onyx-ifem-auth \
  --from-file=public-key.pem=/absolute/path/onyx-auth-public.pem
kubectl -n onyx-ifem create secret docker-registry onyx-ifem-registry \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USER \
  --docker-password=YOUR_READ_PACKAGES_TOKEN
```

Apply the reviewed bundle and wait for durable readiness:

```bash
kubectl apply -k deploy/kubernetes
kubectl -n onyx-ifem rollout status statefulset/onyx-ifem --timeout=180s
kubectl -n onyx-ifem get pod,pvc,service
```

The PVC is retained when the StatefulSet is deleted. Treat PVC deletion as a separate destructive operation and verify a restorable backup first.

For overlapping signing-key rotation, create the authentication Secret from a public-only JWKS instead, replace `ONYX_AUTH_PUBLIC_KEY_PATH` in the ConfigMap with `ONYX_AUTH_JWKS_PATH=/run/secrets/jwks.json`, and follow the staged procedure in [Authentication and authorization](authentication.md):

```bash
kubectl -n onyx-ifem create secret generic onyx-ifem-auth \
  --from-file=jwks.json=/absolute/path/onyx-access-jwks.json
```

The base requests 5 GiB from the cluster's default StorageClass. Set `storageClassName` explicitly when no default exists. The selected volume must provide reliable POSIX locking for SQLite; enable the platform's storage encryption and validate volume snapshots through restore rehearsals rather than treating snapshots alone as verified backups.

## Network access

The default NetworkPolicy accepts port 3000 only from client Pods labeled `onyx-ifem.io/client=true` in namespaces labeled `onyx-ifem.io/access=true`. Label the trusted ingress controller namespace and its Pods, or adapt the selectors to an equivalent identity controlled by the cluster operator.

Apply the same labels to the Prometheus namespace and scraper Pod. The Service advertises `/metrics` through conventional scrape annotations, but monitoring discovery remains cluster-specific; see [Observability](observability.md).

Outbound traffic is limited to TCP 443 for the optional HTTPS outbox and DNS in `kube-system`. Clusters using node-local DNS or nonstandard DNS labels must adapt the DNS rule before deployment. Confirm that kubelet HTTP probes are permitted by the installed CNI.

TLS still terminates at a trusted ingress, gateway, or service mesh. The ClusterIP Service does not expose ONYX outside the cluster.

## Probes and shutdown

The startup and liveness probes use `/healthz`; readiness uses `/readyz`, which checks SQLite and removes the Pod from Service endpoints on persistence failure. ONYX bounds its own drain with `ONYX_SHUTDOWN_TIMEOUT_MS=120000`. The 150-second termination grace period leaves 30 seconds for signal delivery, forced connection cleanup, and kubelet process termination.

Do not add a liveness dependency on the external event receiver. A receiver outage should trigger outbox retry and readiness observability, not restart a healthy process.

## Outbox delivery

The outbox worker is disabled until `ONYX_OUTBOX_WEBHOOK_URL` is added to the ConfigMap. If the receiver needs a token, create it separately:

```bash
kubectl -n onyx-ifem create secret generic onyx-ifem-outbox \
  --from-literal=bearer-token='REPLACE_FROM_SECRET_MANAGER'
```

After changing configuration or secrets, restart and observe the singleton in a controlled window:

```bash
kubectl -n onyx-ifem rollout restart statefulset/onyx-ifem
kubectl -n onyx-ifem rollout status statefulset/onyx-ifem --timeout=180s
```

## Recovery tooling

The production image includes the verified database-recovery CLI. A backup can be created on the mounted volume without copying the live WAL database directly:

```bash
kubectl -n onyx-ifem exec onyx-ifem-0 -- \
  npm run db:backup -- /var/lib/onyx/onyx.db /var/lib/onyx/backup.db
```

Move verified backups and their manifest files to encrypted, independently administered storage. The complete restore and rehearsal procedure remains in [Backup and disaster recovery](disaster-recovery.md).
