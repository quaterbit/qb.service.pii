import { makeMigrationsLayer } from "@semyenov/n2/runtime"

export const MigrationsLayer = makeMigrationsLayer(
  {
    "./migrations/0001_pii_provider_records.ts": () => import("./migrations/0001_pii_provider_records.js"),
    "./migrations/0002_pii_provider_subject_requests_audit.ts": () => import("./migrations/0002_pii_provider_subject_requests_audit.js"),
    "./migrations/0004_pii_provider_event_outbox.ts": () => import("./migrations/0004_pii_provider_event_outbox.js"),
    "./migrations/0005_pii_provider_aggregate_snapshots.ts": () => import("./migrations/0005_pii_provider_aggregate_snapshots.js")
  },
  { table: "pii_provider_migrations" }
)
