# qb.service.pii

PII provider service for encrypted personal-data storage used by profile-provider and other N2 services.

## Storage

The live service uses PostgreSQL for the event journal, operational read
projection, snapshots, and outbox. Encrypted payloads and encrypted DEKs stay in
PostgreSQL.

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
