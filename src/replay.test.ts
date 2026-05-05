import { it, expect } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as ExpEventJournal from "@effect/experimental/EventJournal"
import { EventLog as EL } from "@effect/experimental"
import * as EventLogApi from "@effect/experimental/EventLog"
import { Identity } from "@effect/experimental/EventLog"
import {
  AuditEntry,
  AuditSummary,
  ConsentState,
  EncryptedPayload,
  EncryptionInfo,
  EntityReference,
  Jurisdiction
} from "./contracts/common.js"
import { PIIProviderEventJournalTables } from "./event-journal.js"
import { PIIProviderEventGroup, PIIProviderEventLogSchema } from "./events.js"
import { collectReplayEvents, parseReplayOptions } from "./replay.js"

const now = DateTime.unsafeMake("2026-01-01T00:00:00.000Z")

const NoOpProjection = EL.group(
  PIIProviderEventGroup,
  (handlers) =>
    handlers
      .handle("PIIRecordCreated", () => Effect.void)
      .handle("PIIRecordStoredFromProfile", () => Effect.void)
      .handle("PIIRecordUpdated", () => Effect.void)
      .handle("PIIConsentUpdated", () => Effect.void)
      .handle("PIIConsentWithdrawn", () => Effect.void)
      .handle("PIISubjectRequestCreated", () => Effect.void)
      .handle("PIISubjectRequestCompleted", () => Effect.void)
      .handle("PIIErasureRequested", () => Effect.void)
      .handle("PIIErasureCompleted", () => Effect.void)
      .handle("PIIKeyRotated", () => Effect.void)
      .handle("PIIRecordAccessed", () => Effect.void)
)

const makeEventLogTestLayer = () => {
  const journalLayer = ExpEventJournal.layerMemory
  const identityLayer = Layer.succeed(Identity, Identity.makeRandom())

  return Layer.mergeAll(
    journalLayer,
    identityLayer,
    EventLogApi.layer(PIIProviderEventLogSchema).pipe(
      Layer.provide(NoOpProjection),
      Layer.provide(Layer.merge(journalLayer, identityLayer))
    )
  )
}

const publishCreated = (
  storageKey: string,
  recordId: string,
  revision: number
) =>
  Effect.gen(function* () {
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
        createdBy: "00000000-0000-4000-8000-000000000333",
        accessCount: 0
      }),
      auditEntry: new AuditEntry({
        id: "00000000-0000-4000-8000-000000000444",
        action: "CREATE",
        actorId: "00000000-0000-4000-8000-000000000333",
        actorType: "SYSTEM",
        accessedAt: now,
        success: true
      }),
      extractionInfo: null,
      status: "ACTIVE",
      occurredAt: now,
      actorId: "00000000-0000-4000-8000-000000000333",
      summary: "created",
      revision
    })
  })

it("parseReplayOptions parses pii entity and revision filters", () => {
  expect(parseReplayOptions([
    "--entity-id", "pii-1",
    "--min-revision", "2",
    "--max-revision", "8",
    "--dry-run",
    "--no-reset"
  ], true)).toEqual({
    entityId: "pii-1",
    minRevision: 2,
    maxRevision: 8,
    dryRun: true,
    reset: false
  })
})

it("event journal tables are service-specific", () => {
  expect(PIIProviderEventJournalTables).toEqual({
    entryTable: "pii_provider_event_journal",
    remotesTable: "pii_provider_event_remotes"
  })
})

it.scoped("collectReplayEvents filters journal entries by storage key and revision range", () => Effect.gen(function* () {
  const layer = makeEventLogTestLayer()
  const firstStorageKey = "aggregate:profile-1:1"
  const secondStorageKey = "aggregate:profile-2:1"

  const events = yield* (Effect.gen(function* () {
    yield* publishCreated(firstStorageKey, "00000000-0000-4000-8000-000000000101", 1)
    yield* publishCreated(secondStorageKey, "00000000-0000-4000-8000-000000000202", 3)
    yield* publishCreated(firstStorageKey, "00000000-0000-4000-8000-000000000101", 5)

    const journal = yield* ExpEventJournal.EventJournal
    const entries = yield* journal.entries
    return yield* collectReplayEvents(entries, {
      entityId: firstStorageKey,
      minRevision: 2,
      maxRevision: 5,
      reset: false,
      dryRun: true
    })
  }).pipe(
    Effect.provide(layer),
    Effect.orDie
  ) as unknown as Effect.Effect<ReadonlyArray<{ readonly _tag: string; readonly storageKey: string; readonly revision: number }>, never, Scope.Scope>)

  expect(events.map((event) => ({
    tag: event._tag,
    storageKey: event.storageKey,
    revision: event.revision
  }))).toEqual([
    {
      tag: "PIIRecordCreated",
      storageKey: firstStorageKey,
      revision: 5
    }
  ])
}))
