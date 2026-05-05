import { it, expect } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SqlClient, type SqlClient as SqlClientInstance } from "@effect/sql/SqlClient"
import {
  AuditEntry,
  AuditSummary,
  ConsentState,
  DataSubjectRequest,
  EncryptedPayload,
  EncryptionInfo,
  EntityReference,
  Jurisdiction
} from "./contracts/common.js"
import {
  PIIConsentUpdated,
  PIIErasureCompleted,
  PIIRecordCreated,
  PIISubjectRequestCompleted,
  PIISubjectRequestCreated
} from "./contracts/events.js"
import { PIIProviderProjectionStore } from "./projection-store.js"
import { PIIProviderProjectionStorePgLive } from "./projection-store-pg.js"

const now = DateTime.unsafeMake("2026-01-01T00:00:00.000Z")
const storageKey = "aggregate:00000000-0000-4000-8000-000000000111:1"
const recordId = "00000000-0000-4000-8000-000000000222"
const actorId = "00000000-0000-4000-8000-000000000333"
const requestId = "00000000-0000-4000-8000-000000000444"

const makeAudit = (accessCount: number) =>
  new AuditSummary({
    createdAt: now,
    createdBy: actorId,
    accessCount
  })

const makeAuditEntry = (
  idSeed: number,
  action: AuditEntry["action"],
  purpose: string
) =>
  new AuditEntry({
    id: `00000000-0000-4000-8000-${idSeed.toString().padStart(12, "0")}`,
    action,
    actorId,
    actorType: "USER",
    accessedAt: now,
    success: true,
    purpose
  })

const encryptedPayload = new EncryptedPayload({
  encryptedData: "ciphertext",
  encryptedDek: "dek",
  encryption: new EncryptionInfo({
    keyId: "local",
    algorithm: "AES-256-GCM",
    keyVersion: 1,
    encryptedAt: now
  })
})

const consent = new ConsentState({
  given: true,
  givenAt: now,
  consentVersion: "1.0",
  purposes: ["PROFILE_MATCHING"],
  withdrawalRequested: false
})

const entityReference = new EntityReference({
  entityId: "00000000-0000-4000-8000-000000000111",
  entityType: "AGGREGATE",
  entityVersion: 1
})

const jurisdiction = new Jurisdiction({
  countryCode: "RU",
  applicableLaws: ["152-FZ"],
  dataResidency: "RU"
})

const subjectRequest = (status: DataSubjectRequest["status"]) =>
  new DataSubjectRequest({
    requestId,
    requestType: "ERASURE",
    requestedAt: now,
    completedAt: status === "COMPLETED" ? now : undefined,
    status,
    notes: "delete"
  })

it.effect("PG projection writes record, subject request, and audit rows", () => Effect.gen(function* () {
  const calls: Array<{ readonly text: string; readonly params: ReadonlyArray<unknown> }> = []

  type FakeSql = {
    (strings: TemplateStringsArray | string, ...params: ReadonlyArray<unknown>): unknown
  }

  const fakeSql = ((strings: TemplateStringsArray | string, ...params: ReadonlyArray<unknown>) => {
    if (typeof strings === "string") return { identifier: strings }
    calls.push({ text: strings.join("?"), params })
    return Effect.succeed([])
  }) as FakeSql

  const layer = Layer.provide(
    PIIProviderProjectionStorePgLive,
    Layer.succeed(SqlClient, fakeSql as unknown as SqlClientInstance)
  )

  yield* Effect.gen(function* () {
    const store = yield* PIIProviderProjectionStore
    yield* store.onPIIRecordCreated(new PIIRecordCreated({
      storageKey,
      recordId,
      schemaVersion: "1.0.0",
      entityReference,
      jurisdiction,
      encryptedPayload,
      consent,
      dataSubjectRequests: [],
      retention: null,
      audit: makeAudit(0),
      auditEntry: makeAuditEntry(1, "CREATE", "create"),
      extractionInfo: null,
      status: "ACTIVE",
      occurredAt: now,
      actorId,
      revision: 1,
      summary: "created"
    }))
    yield* store.onPIIConsentUpdated(new PIIConsentUpdated({
      storageKey,
      recordId,
      consent: new ConsentState({ ...consent, consentVersion: "2.0" }),
      audit: makeAudit(0),
      auditEntry: makeAuditEntry(2, "UPDATE", "consent"),
      occurredAt: now,
      actorId,
      revision: 2
    }))
    yield* store.onPIISubjectRequestCreated(new PIISubjectRequestCreated({
      storageKey,
      recordId,
      subjectRequest: subjectRequest("PENDING"),
      status: "PENDING_DELETION",
      audit: makeAudit(0),
      auditEntry: makeAuditEntry(3, "DELETE", "erasure requested"),
      occurredAt: now,
      actorId,
      revision: 3
    }))
    yield* store.onPIISubjectRequestCompleted(new PIISubjectRequestCompleted({
      storageKey,
      recordId,
      subjectRequest: subjectRequest("COMPLETED"),
      status: "PENDING_DELETION",
      audit: makeAudit(0),
      auditEntry: makeAuditEntry(4, "UPDATE", "ERASURE"),
      occurredAt: now,
      actorId,
      revision: 4
    }))
    yield* store.onPIIErasureCompleted(new PIIErasureCompleted({
      storageKey,
      recordId,
      subjectRequest: subjectRequest("COMPLETED"),
      status: "DELETED",
      encryptedPayload: new EncryptedPayload({
        ...encryptedPayload,
        encryptedData: "",
        encryptedDek: ""
      }),
      deletedPayloadUri: encryptedPayload.encryptedData,
      audit: makeAudit(0),
      auditEntry: makeAuditEntry(5, "DELETE", "erasure completed"),
      occurredAt: now,
      actorId,
      revision: 5
    }))
  }).pipe(Effect.provide(layer))

  expect(calls.some((call) =>
    call.text.includes("INSERT INTO pii_provider_records") &&
    call.params.includes(storageKey) &&
    call.params.includes("ACTIVE")
  )).toBe(true)
  expect(calls.some((call) =>
    call.text.includes("UPDATE pii_provider_records") &&
    call.params.includes("DELETED")
  )).toBe(true)
  expect(calls.filter((call) => call.text.includes("INSERT INTO pii_provider_subject_requests")).length).toBe(3)
  expect(calls.filter((call) => call.text.includes("INSERT INTO pii_provider_audit_log")).length).toBe(5)
  expect(calls.some((call) =>
    call.text.includes("UPDATE pii_provider_records") &&
    call.params.some((param) => typeof param === "string" && param.includes("\"consentVersion\":\"2.0\""))
  )).toBe(true)
}))
