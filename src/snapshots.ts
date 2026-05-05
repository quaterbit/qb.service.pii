import * as Context from "effect/Context"
import { makeStandardSnapshotWiring, type SnapshotEntry, type SnapshotService } from "@semyenov/n2/helpers"
import { PIIState } from "./contracts/state.js"

export const SNAPSHOT_EVERY = 25

export type { SnapshotEntry }

export class PIIProviderAggregateSnapshots extends Context.Tag("PIIProviderAggregateSnapshots")<
  PIIProviderAggregateSnapshots,
  SnapshotService<PIIState>
>() {}

const snapshots = makeStandardSnapshotWiring({
  tag: PIIProviderAggregateSnapshots,
  table: "pii_provider_aggregate_snapshots",
  stateSchema: PIIState,
  idColumn: "storage_key",
  every: SNAPSHOT_EVERY
})

export const PIIProviderAggregateSnapshotsLive = snapshots.live
export const PIIProviderAggregateSnapshotOps = snapshots.ops
