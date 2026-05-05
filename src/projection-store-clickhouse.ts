import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Clickhouse from "@clickhouse/client"
import * as ClickhouseClient from "@effect/sql-clickhouse/ClickhouseClient"
import {
  queryClickhouseJsonRows,
  withClickhouseProjectionInsertSettings
} from "@semyenov/n2/runtime"
import type {
  AuditEntry,
  AuditSummary,
  ConsentState,
  DataSubjectRequest,
  EntityReference,
  ExtractionInfo,
  Jurisdiction,
  RetentionInfo
} from "./contracts/common.js"
import type {
  PIIConsentUpdated,
  PIIConsentWithdrawn,
  PIIErasureCompleted,
  PIIErasureRequested,
  PIIKeyRotated,
  PIIRecordAccessed,
  PIIRecordCreated,
  PIIRecordStoredFromProfile,
  PIIRecordUpdated,
  PIISubjectRequestCompleted,
  PIISubjectRequestCreated,
  PIIProviderEvent
} from "./contracts/events.js"
import { makeDispatch, PIIProviderProjectionStore, type ProjectionHandlers } from "./projection-store.js"

type RecordCurrentRow = {
  readonly storage_key: string
  readonly record_id: string
  readonly revision: number
  readonly status: string
  readonly schema_version: string
  readonly entity_id: string
  readonly entity_type: string
  readonly entity_version: number
  readonly jurisdiction_json: string
  readonly consent_json: string
  readonly subject_requests_json: string
  readonly retention_json: string
  readonly audit_json: string
  readonly extraction_info_json: string
  readonly created_at: string
  readonly updated_at: string
}

const asJson = (value: unknown) => JSON.stringify(value ?? null)

const recordRow = (input: {
  readonly storageKey: string
  readonly recordId: string
  readonly revision: number
  readonly status: string
  readonly schemaVersion: string
  readonly entityReference: EntityReference
  readonly jurisdiction: Jurisdiction
  readonly consent: ConsentState
  readonly subjectRequests: ReadonlyArray<DataSubjectRequest>
  readonly retention: RetentionInfo | null
  readonly audit: AuditSummary
  readonly extractionInfo: ExtractionInfo | null
  readonly createdAt: string
  readonly updatedAt: string
}): RecordCurrentRow => ({
  storage_key: input.storageKey,
  record_id: input.recordId,
  revision: input.revision,
  status: input.status,
  schema_version: input.schemaVersion,
  entity_id: input.entityReference.entityId,
  entity_type: input.entityReference.entityType,
  entity_version: input.entityReference.entityVersion,
  jurisdiction_json: asJson(input.jurisdiction),
  consent_json: asJson(input.consent),
  subject_requests_json: asJson(input.subjectRequests),
  retention_json: asJson(input.retention),
  audit_json: asJson(input.audit),
  extraction_info_json: asJson(input.extractionInfo),
  created_at: input.createdAt,
  updated_at: input.updatedAt
})

const applySubjectRequest = (
  currentJson: string,
  request: DataSubjectRequest
) => {
  const current = currentJson.trim().length === 0 ? [] : JSON.parse(currentJson) as Array<DataSubjectRequest>
  const index = current.findIndex((item) => item.requestId === request.requestId)
  if (index === -1) return [...current, request]
  return current.map((item) => item.requestId === request.requestId ? request : item)
}

const loadLatestRecord = (client: Clickhouse.ClickHouseClient, storageKey: string) =>
  queryClickhouseJsonRows<RecordCurrentRow>(
    client,
    `SELECT storage_key, record_id, revision, status, schema_version,
            entity_id, entity_type, entity_version, jurisdiction_json,
            consent_json, subject_requests_json, retention_json, audit_json, extraction_info_json,
            created_at, updated_at
     FROM pii_provider_records_current
     WHERE storage_key = {storageKey:String}
     ORDER BY revision DESC LIMIT 1`,
    { storageKey }
  ).pipe(Effect.map((rows) => rows[0]))

const eventStatus = (event: PIIProviderEvent) =>
  "status" in event ? event.status : ""

const eventSummary = (event: PIIProviderEvent) => {
  if ("summary" in event) return event.summary
  if ("reason" in event) return event.reason
  if ("subjectRequest" in event) return event.subjectRequest.requestType
  return event._tag
}

const projectionMetadata = (event: PIIProviderEvent) =>
  asJson({
    schemaVersion: "schemaVersion" in event ? event.schemaVersion : undefined,
    entityReference: "entityReference" in event ? event.entityReference : undefined,
    jurisdiction: "jurisdiction" in event ? event.jurisdiction : undefined,
    consentGiven: "consent" in event ? event.consent.given : undefined,
    consentPurposes: "consent" in event ? event.consent.purposes : undefined,
    subjectRequestType: "subjectRequest" in event ? event.subjectRequest.requestType : undefined,
    subjectRequestStatus: "subjectRequest" in event ? event.subjectRequest.status : undefined,
    reason: "reason" in event ? event.reason : undefined,
    immediate: "immediate" in event ? event.immediate : undefined,
    retainForLegal: "retainForLegal" in event ? event.retainForLegal : undefined,
    auditAction: event.auditEntry.action,
    auditSuccess: event.auditEntry.success
  })

const insertProjectionEvent = (
  ch: ClickhouseClient.ClickhouseClient,
  event: PIIProviderEvent
) =>
  ch.insertQuery({
    table: "pii_provider_projection_events",
    values: [{
      storage_key: event.storageKey,
      record_id: event.recordId,
      revision: event.revision,
      event_type: event._tag,
      occurred_at: String(event.occurredAt.toJSON()),
      actor_id: event.actorId,
      status: eventStatus(event),
      summary: eventSummary(event),
      metadata_json: projectionMetadata(event)
    }]
  }).pipe(
    Effect.asVoid,
    (effect) =>
      withClickhouseProjectionInsertSettings(ch, effect, "pii_provider_projection_events", {
        "event.name": event._tag,
        "n2.storage_key": event.storageKey,
        "n2.revision": event.revision
      })
  )

const insertRecord = (
  ch: ClickhouseClient.ClickhouseClient,
  row: RecordCurrentRow
) =>
  ch.insertQuery({
    table: "pii_provider_records_current",
    values: [row]
  }).pipe(
    Effect.asVoid,
    (effect) =>
      withClickhouseProjectionInsertSettings(ch, effect, "pii_provider_records_current", {
        "n2.storage_key": row.storage_key,
        "n2.revision": row.revision
      })
  )

const insertAudit = (
  ch: ClickhouseClient.ClickhouseClient,
  event: PIIProviderEvent,
  auditEntry: AuditEntry
) =>
  ch.insertQuery({
    table: "pii_provider_audit_events",
    values: [{
      storage_key: event.storageKey,
      record_id: event.recordId,
      revision: event.revision,
      action: auditEntry.action,
      actor_id: auditEntry.actorId,
      actor_type: auditEntry.actorType,
      accessed_at: String(auditEntry.accessedAt.toJSON()),
      success: auditEntry.success ? 1 : 0,
      purpose: auditEntry.purpose ?? "",
      failure_reason: auditEntry.failureReason ?? "",
      payload_json: JSON.stringify(auditEntry)
    }]
  }).pipe(
    Effect.asVoid,
    (effect) =>
      withClickhouseProjectionInsertSettings(ch, effect, "pii_provider_audit_events", {
        "event.name": event._tag,
        "n2.storage_key": event.storageKey,
        "n2.revision": event.revision
      })
  )

const createdRecordRow = (event: PIIRecordCreated | PIIRecordStoredFromProfile) => {
  const occurredAt = String(event.occurredAt.toJSON())
  return recordRow({
    storageKey: event.storageKey,
    recordId: event.recordId,
    revision: event.revision,
    status: event.status,
    schemaVersion: event.schemaVersion,
    entityReference: event.entityReference,
    jurisdiction: event.jurisdiction,
    consent: event.consent,
    subjectRequests: event.dataSubjectRequests,
    retention: event.retention,
    audit: event.audit,
    extractionInfo: event.extractionInfo,
    createdAt: occurredAt,
    updatedAt: occurredAt
  })
}

export const makePIIProviderProjectionStoreClickhouse = Effect.gen(function* () {
    const ch = yield* ClickhouseClient.ClickhouseClient
    const direct = yield* Effect.acquireRelease(
      Effect.sync(() => Clickhouse.createClient(ch.config)),
      (client) => Effect.promise(() => client.close())
    )
    const rows = new Map<string, RecordCurrentRow>()

    const insertAndCache = (row: RecordCurrentRow) =>
      insertRecord(ch, row).pipe(
        Effect.tap(() => Effect.sync(() => rows.set(row.storage_key, row)))
      )

    const getRecordRow = (storageKey: string) => {
      const cached = rows.get(storageKey)
      if (cached !== undefined) return Effect.succeed(cached)
      return loadLatestRecord(direct, storageKey).pipe(
        Effect.tap((row) =>
          row === undefined
            ? Effect.void
            : Effect.sync(() => {
                rows.set(storageKey, row)
              })
        )
      )
    }

    const updateRecord = (
      event: PIIProviderEvent,
      update: (current: RecordCurrentRow) => RecordCurrentRow,
      auditEntry?: AuditEntry
    ) =>
      Effect.gen(function* () {
        const current = yield* getRecordRow(event.storageKey)
        yield* insertProjectionEvent(ch, event)
        if (current !== undefined) {
          yield* insertAndCache(update(current))
        }
        if (auditEntry !== undefined) {
          yield* insertAudit(ch, event, auditEntry)
        }
      })

    const handlers: Omit<ProjectionHandlers, "dispatch"> = {
      onPIIRecordCreated: (event: PIIRecordCreated) =>
        Effect.all([
          insertProjectionEvent(ch, event),
          insertAndCache(createdRecordRow(event)),
          insertAudit(ch, event, event.auditEntry)
        ], { discard: true }),

      onPIIRecordStoredFromProfile: (event: PIIRecordStoredFromProfile) =>
        Effect.all([
          insertProjectionEvent(ch, event),
          insertAndCache(createdRecordRow(event)),
          insertAudit(ch, event, event.auditEntry)
        ], { discard: true }),

      onPIIRecordUpdated: (event: PIIRecordUpdated) =>
        updateRecord(event, (current) => ({
          ...current,
          revision: event.revision,
          audit_json: asJson(event.audit),
          updated_at: String(event.occurredAt.toJSON())
        }), event.auditEntry),

      onPIIConsentUpdated: (event: PIIConsentUpdated) =>
        updateRecord(event, (current) => ({
          ...current,
          revision: event.revision,
          consent_json: asJson(event.consent),
          audit_json: asJson(event.audit),
          updated_at: String(event.occurredAt.toJSON())
        }), event.auditEntry),

      onPIIConsentWithdrawn: (event: PIIConsentWithdrawn) =>
        updateRecord(event, (current) => ({
          ...current,
          revision: event.revision,
          consent_json: asJson(event.consent),
          audit_json: asJson(event.audit),
          updated_at: String(event.occurredAt.toJSON())
        }), event.auditEntry),

      onPIISubjectRequestCreated: (event: PIISubjectRequestCreated) =>
        updateRecord(event, (current) => ({
          ...current,
          revision: event.revision,
          status: event.status,
          subject_requests_json: asJson(applySubjectRequest(current.subject_requests_json, event.subjectRequest)),
          audit_json: asJson(event.audit),
          updated_at: String(event.occurredAt.toJSON())
        }), event.auditEntry),

      onPIISubjectRequestCompleted: (event: PIISubjectRequestCompleted) =>
        updateRecord(event, (current) => ({
          ...current,
          revision: event.revision,
          status: event.status,
          subject_requests_json: asJson(applySubjectRequest(current.subject_requests_json, event.subjectRequest)),
          audit_json: asJson(event.audit),
          updated_at: String(event.occurredAt.toJSON())
        }), event.auditEntry),

      onPIIErasureRequested: (event: PIIErasureRequested) =>
        updateRecord(event, (current) => ({
          ...current,
          revision: event.revision,
          status: event.status,
          subject_requests_json: asJson(applySubjectRequest(current.subject_requests_json, event.subjectRequest)),
          audit_json: asJson(event.audit),
          updated_at: String(event.occurredAt.toJSON())
        }), event.auditEntry),

      onPIIErasureCompleted: (event: PIIErasureCompleted) =>
        updateRecord(event, (current) => ({
          ...current,
          revision: event.revision,
          status: event.status,
          subject_requests_json: asJson(applySubjectRequest(current.subject_requests_json, event.subjectRequest)),
          audit_json: asJson(event.audit),
          updated_at: String(event.occurredAt.toJSON())
        }), event.auditEntry),

      onPIIKeyRotated: (event: PIIKeyRotated) =>
        updateRecord(event, (current) => ({
          ...current,
          revision: event.revision,
          audit_json: asJson(event.audit),
          updated_at: String(event.occurredAt.toJSON())
        }), event.auditEntry),

      onPIIRecordAccessed: (event: PIIRecordAccessed) =>
        updateRecord(event, (current) => ({
          ...current,
          revision: event.revision,
          audit_json: asJson(event.audit),
          updated_at: String(event.occurredAt.toJSON())
        }), event.auditEntry)
    }

  return { ...handlers, dispatch: makeDispatch(handlers) }
})

export const PIIProviderProjectionStoreClickhouseLive = Layer.scoped(
  PIIProviderProjectionStore,
  makePIIProviderProjectionStoreClickhouse
)
