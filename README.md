# qb.service.pii

PII provider service for encrypted personal-data storage used by profile-provider and other N2 services.

## Storage

The live service uses PostgreSQL for the event journal, operational read
projection, snapshots, and outbox. Encrypted payload bytes are stored in object
storage; PostgreSQL stores the object URI, encrypted DEK, and encryption
metadata.

Replay rebuilds the PostgreSQL read projection from the PostgreSQL event
journal by default.

```bash
DATABASE_URL=postgres://n2:n2@127.0.0.1:5432/n2 \
RESET_PROJECTIONS=true \
bun services/pii-provider/src/replay.ts
```

ClickHouse projection code is kept for optional analytics work, but it is not
required on the command path and does not store encrypted payload material in
the default runtime.

## Runtime configuration

Required:

- `DATABASE_URL` - PostgreSQL connection string for the event journal,
  projections, snapshots, outbox, and cluster storage.
- `PII_MASTER_KEY` - local envelope encryption master secret outside
  local/test environments.
- `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_PORT`,
  `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY` - object storage
  connection for encrypted payloads outside local/test environments.
- `PROFILE_PROVIDER_BASE_URL` - base URL used by the durable publisher when it
  clears profile PII references after erasure.

Optional:

- `PORT` - JSON-RPC and health port for `server.ts`; defaults to `4120`.
- `API_PORT` - public JSON-RPC and health port for `cluster.ts`; defaults to
  `4120`.
- `PII_PAYLOADS_BUCKET` - encrypted payload bucket; defaults to
  `n2-pii-payloads`.

## Docker image

Build this service from the N2 monorepo root so workspace packages and contract
exports resolve correctly:

```bash
docker build -f services/pii-provider/Dockerfile .
```
