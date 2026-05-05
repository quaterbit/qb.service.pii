import { makeServiceInfrastructureLayers } from "@semyenov/n2/runtime"
import * as EventLogApi from "@effect/experimental/EventLog"
import * as Layer from "effect/Layer"
import {
  PIIProviderOutboxPgLive,
  PIIProviderOutboxWorkerLive
} from "./outbox.js"
import { PIIProviderProjectionStorePgLive } from "./projection-store-pg.js"
import { PIIProviderProjectionLayer } from "./projector.js"
import { PIIProviderEventJournalTables } from "./event-journal.js"
import { PIIProviderEventLogSchema } from "./events.js"
import { PIIProviderAggregateSnapshotsLive } from "./snapshots.js"
import {
  PIIProviderEventPublishHandlers,
  PIIProviderEventPublisherLive
} from "./workflows.js"
import { PIICryptoLive } from "./crypto.js"
import { ProfilePiiReferenceNotifierLive } from "./profile-notifier.js"
import { ObjectStorageLive } from "@semyenov/n2-service-shared/object-storage"

const publisherDependencies = Layer.merge(ObjectStorageLive, ProfilePiiReferenceNotifierLive)
const publisherLive = Layer.provide(PIIProviderEventPublisherLive, publisherDependencies)

const infrastructure = makeServiceInfrastructureLayers({
  eventJournal: PIIProviderEventJournalTables,
  eventLogLayer: EventLogApi.layer(PIIProviderEventLogSchema),
  projectionLayer: PIIProviderProjectionLayer,
  projectionStoreLayer: PIIProviderProjectionStorePgLive,
  outboxLive: PIIProviderOutboxPgLive,
  outboxWorkerLive: PIIProviderOutboxWorkerLive,
  snapshotsLive: PIIProviderAggregateSnapshotsLive,
  publishHandlers: PIIProviderEventPublishHandlers,
  publisherLive
})

export const WorkflowLayer = infrastructure.WorkflowLayer
export const ClusterWorkflowLayer = infrastructure.ClusterWorkflowLayer
export const InfrastructureLayer = Layer.mergeAll(
  infrastructure.InfrastructureLayer,
  PIICryptoLive,
  ObjectStorageLive,
  ProfilePiiReferenceNotifierLive
)
export const ClusterInfrastructureLayer = Layer.mergeAll(
  infrastructure.ClusterInfrastructureLayer,
  PIICryptoLive,
  ObjectStorageLive,
  ProfilePiiReferenceNotifierLive
)
