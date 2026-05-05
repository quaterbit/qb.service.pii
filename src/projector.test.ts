import { it, expect } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as ExpEventJournal from "@effect/experimental/EventJournal"
import { Identity } from "@effect/experimental/EventLog"
import * as EventLogApi from "@effect/experimental/EventLog"
import {
  AuditEntry,
  AuditSummary,
  ConsentState,
  EncryptedPayload,
  EncryptionInfo,
  EntityReference,
  Jurisdiction
} from "./contracts/common.js"
import type { PIIProviderEvent } from "./contracts/events.js"
import { PIIProviderEventLogSchema } from "./events.js"
import { PIIProviderOutbox } from "./outbox.js"
import { PIIProviderProjectionLayer } from "./projector.js"
import { makeDispatch, PIIProviderProjectionStore, type ProjectionHandlers } from "./projection-store.js"
import type { PIIProviderEventMessage } from "./workflows.js"

const now = DateTime.unsafeMake("2026-01-01T00:00:00.000Z")

it.scoped("projector writes through the projection store and outbox", () => Effect.gen(function* () {
  const storageKey = "aggregate:00000000-0000-4000-8000-000000000111:1"
  const recordId = "00000000-0000-4000-8000-000000000222"
  const actorId = "00000000-0000-4000-8000-000000000333"
  const projected: Array<{ tag: PIIProviderEvent["_tag"] }> = []
  const outboxed: Array<{ messageId: string }> = []
  const journalLayer = ExpEventJournal.layerMemory
  const identityLayer = Layer.succeed(Identity, Identity.makeRandom())

  const perEventHandlers: Omit<ProjectionHandlers, "dispatch"> = {
    onPIIRecordCreated: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) }),
    onPIIRecordStoredFromProfile: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) }),
    onPIIRecordUpdated: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) }),
    onPIIConsentUpdated: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) }),
    onPIIConsentWithdrawn: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) }),
    onPIISubjectRequestCreated: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) }),
    onPIISubjectRequestCompleted: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) }),
    onPIIErasureRequested: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) }),
    onPIIErasureCompleted: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) }),
    onPIIKeyRotated: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) }),
    onPIIRecordAccessed: (event) => Effect.sync(() => { projected.push({ tag: event._tag }) })
  }
  const noOpHandlers: ProjectionHandlers = { ...perEventHandlers, dispatch: makeDispatch(perEventHandlers) }

  const noOpOutbox = {
    enqueue: (message: PIIProviderEventMessage) =>
      Effect.sync(() => { outboxed.push({ messageId: message.id }) }),
    claimPending: () => Effect.succeed([] as const),
    markDispatched: () => Effect.void,
    markFailed: () => Effect.void,
    markDeadLetter: () => Effect.void
  }

  const layer = Layer.mergeAll(
    journalLayer,
    identityLayer,
    Layer.succeed(PIIProviderProjectionStore, noOpHandlers),
    Layer.succeed(PIIProviderOutbox, noOpOutbox),
    EventLogApi.layer(PIIProviderEventLogSchema).pipe(
      Layer.provide(PIIProviderProjectionLayer),
      Layer.provide(Layer.merge(journalLayer, identityLayer))
    )
  )

  yield* (Effect.gen(function* () {
    const publish = yield* EventLogApi.makeClient(PIIProviderEventLogSchema)
    yield* publish("PIIRecordCreated", {
      storageKey: storageKey,
      recordId: recordId,
      schemaVersion: "1.0.0",
      entityReference: new EntityReference({
        entityId: "00000000-0000-4000-8000-000000000111",
        entityType: "AGGREGATE",
        entityVersion: 1
      }),
      jurisdiction: new Jurisdiction({
        countryCode: "RU",
        applicableLaws: ["152-FZ"]
      }),
      encryptedPayload: new EncryptedPayload({
        encryptedData: "ciphertext",
        encryptedDek: "dek",
        encryption: new EncryptionInfo({
          keyId: "local",
          algorithm: "AES-256-GCM",
          keyVersion: 1,
          encryptedAt: now
        })
      }),
      consent: new ConsentState({
        given: true,
        purposes: ["PROFILE_MATCHING"],
        withdrawalRequested: false
      }),
      dataSubjectRequests: [],
      retention: null,
      audit: new AuditSummary({
        createdAt: now,
        createdBy: actorId,
        accessCount: 0
      }),
      auditEntry: new AuditEntry({
        id: "00000000-0000-4000-8000-000000000444",
        action: "CREATE",
        actorId: actorId,
        actorType: "SYSTEM",
        accessedAt: now,
        success: true
      }),
      extractionInfo: null,
      status: "ACTIVE",
      occurredAt: now,
      actorId: actorId,
      summary: "created",
      revision: 1
    })
  }).pipe(
    Effect.provide(layer)
  ) as unknown as Effect.Effect<void, never, Scope.Scope>)

  expect(projected).toEqual([{ tag: "PIIRecordCreated" }])
  expect(outboxed).toEqual([{ messageId: `${recordId}:1:PIIRecordCreated` }])
}))
