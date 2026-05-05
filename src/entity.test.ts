import { it, expect } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as ExpEventJournal from "@effect/experimental/EventJournal"
import { RpcTest } from "@effect/rpc"
import {
  AuditSummary,
  ConsentState,
  EntityReference,
  FullName,
  Jurisdiction,
  PersonalIdentity,
  PIIRecordInput,
  storageKeyFromEntityReference
} from "./contracts/common.js"
import type { PIIProviderEventMessage } from "./workflows.js"
import { PIIProviderHandlersRaw } from "./entity.js"
import { PIIProviderOutbox } from "./outbox.js"
import { makeDispatch, PIIProviderProjectionStore, type ProjectionHandlers } from "./projection-store.js"
import { PIIProviderRpcs } from "./contracts/commands.js"
import { PIIProviderAggregateSnapshots } from "./snapshots.js"
import { PIICryptoLive } from "./crypto.js"
import { ProfilePiiReferenceNotifierNoop } from "./profile-notifier.js"
import { ObjectStorageMemory } from "@semyenov/n2-service-shared/object-storage"

const makeUuid = (seed: number) =>
  `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`

const noOpProjectionHandlers: Omit<ProjectionHandlers, "dispatch"> = {
  onPIIRecordCreated: () => Effect.void,
  onPIIRecordStoredFromProfile: () => Effect.void,
  onPIIRecordUpdated: () => Effect.void,
  onPIIConsentUpdated: () => Effect.void,
  onPIIConsentWithdrawn: () => Effect.void,
  onPIISubjectRequestCreated: () => Effect.void,
  onPIISubjectRequestCompleted: () => Effect.void,
  onPIIErasureRequested: () => Effect.void,
  onPIIErasureCompleted: () => Effect.void,
  onPIIKeyRotated: () => Effect.void,
  onPIIRecordAccessed: () => Effect.void
}

const testLayer = Layer.provide(
  PIIProviderHandlersRaw,
  Layer.mergeAll(
    PIICryptoLive,
    ObjectStorageMemory,
    ProfilePiiReferenceNotifierNoop,
    ExpEventJournal.layerMemory,
    Layer.succeed(PIIProviderProjectionStore, {
      ...noOpProjectionHandlers,
      dispatch: makeDispatch(noOpProjectionHandlers)
    }),
    Layer.succeed(PIIProviderOutbox, {
      enqueue: (_message: PIIProviderEventMessage) => Effect.void,
      claimPending: () => Effect.succeed([]),
      markDispatched: () => Effect.void,
      markFailed: () => Effect.void,
      markDeadLetter: () => Effect.void
    }),
    Layer.succeed(PIIProviderAggregateSnapshots, {
      load: () => Effect.succeed(Option.none()),
      save: () => Effect.void
    })
  )
)

it.scoped("GetPIIRecord decrypts and records read audit in the same handler path", () =>
  Effect.gen(function* () {
    const actorId = makeUuid(1)
    const recordId = makeUuid(2)
    const entityReference = new EntityReference({
      entityId: makeUuid(3),
      entityType: "AGGREGATE",
      entityVersion: 1
    })
    const storageKey = storageKeyFromEntityReference(entityReference)
    const client = yield* RpcTest.makeClient(PIIProviderRpcs)

    yield* client.CreatePIIRecord({
      record: new PIIRecordInput({
        id: recordId,
        schemaVersion: "1.0.0",
        entityReference,
        jurisdiction: new Jurisdiction({
          countryCode: "RU",
          applicableLaws: ["152-FZ"],
          dataResidency: "RU"
        }),
        personalIdentity: new PersonalIdentity({
          fullName: new FullName({
            firstName: "Ada",
            lastName: "Lovelace"
          })
        }),
        consent: new ConsentState({
          given: true,
          givenAt: DateTime.unsafeMake("2026-01-01T00:00:00.000Z"),
          consentVersion: "1.0",
          purposes: ["PROFILE_MATCHING"],
          withdrawalRequested: false
        }),
        audit: new AuditSummary({
          createdAt: DateTime.unsafeMake("2026-01-01T00:00:00.000Z"),
          createdBy: actorId,
          accessCount: 0
        }),
        status: "ACTIVE"
      }),
      actorId,
      summary: "create"
    })

    const record = yield* client.GetPIIRecord({
      storageKey,
      actorId,
      actorType: "USER",
      purpose: "PROFILE_VIEW"
    })
    const audit = yield* client.GetPIIAuditLog({ storageKey })
    const history = yield* client.GetPIIHistory({ storageKey })

    expect(record.personalIdentity?.fullName?.firstName).toBe("Ada")
    expect(record.audit.accessCount).toBe(1)
    expect(audit.total).toBe(2)
    expect(audit.auditEntries.map((entry) => entry.action)).toEqual(["CREATE", "READ"])
    expect(history.currentRevision).toBe(2)
  }).pipe(Effect.provide(testLayer)))
