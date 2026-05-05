import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SqlClient } from "@effect/sql/SqlClient"
import type {
  AuditEntry,
  AuditSummary,
  ConsentState,
  DataSubjectRequest,
  EncryptedPayload,
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
  PIIProviderEvent,
  PIIRecordAccessed,
  PIIRecordCreated,
  PIIRecordStoredFromProfile,
  PIIRecordUpdated,
  PIISubjectRequestCompleted,
  PIISubjectRequestCreated
} from "./contracts/events.js"
import { makeDispatch, PIIProviderProjectionStore, type ProjectionHandlers } from "./projection-store.js"

const asJson = (value: unknown) => JSON.stringify(value ?? null)
const asDate = (value: { readonly toJSON: () => unknown }) => String(value.toJSON())

export const resetPIIProviderPgProjection = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    TRUNCATE TABLE
      pii_provider_records,
      pii_provider_subject_requests,
      pii_provider_audit_log,
      pii_provider_retention_policies
  `.pipe(Effect.asVoid)
})

interface RecordRowInput {
  readonly storageKey: string
  readonly recordId: string
  readonly revision: number
  readonly status: string
  readonly schemaVersion: string
  readonly entityReference: EntityReference
  readonly jurisdiction: Jurisdiction
  readonly encryptedPayload: EncryptedPayload
  readonly consent: ConsentState
  readonly retention: RetentionInfo | null
  readonly audit: AuditSummary
  readonly extractionInfo: ExtractionInfo | null
  readonly createdAt: string
  readonly updatedAt: string
}

const createdRecordRow = (event: PIIRecordCreated | PIIRecordStoredFromProfile): RecordRowInput => {
  const occurredAt = asDate(event.occurredAt)
  return {
    storageKey: event.storageKey,
    recordId: event.recordId,
    revision: event.revision,
    status: event.status,
    schemaVersion: event.schemaVersion,
    entityReference: event.entityReference,
    jurisdiction: event.jurisdiction,
    encryptedPayload: event.encryptedPayload,
    consent: event.consent,
    retention: event.retention,
    audit: event.audit,
    extractionInfo: event.extractionInfo,
    createdAt: occurredAt,
    updatedAt: occurredAt
  }
}

export const makePIIProviderProjectionStorePg = Effect.gen(function* () {
  const sql = yield* SqlClient

  const upsertRecord = (row: RecordRowInput) =>
    sql`
      INSERT INTO pii_provider_records
        (storage_key, record_id, status, revision, schema_version, entity_id, entity_type,
         entity_version, jurisdiction_json, encrypted_data, encrypted_dek, encryption_json,
         consent_json, retention_json, audit_json, extraction_info_json, created_at, updated_at)
      VALUES (
        ${row.storageKey}, ${row.recordId}, ${row.status}, ${row.revision}, ${row.schemaVersion},
        ${row.entityReference.entityId}, ${row.entityReference.entityType}, ${row.entityReference.entityVersion},
        ${asJson(row.jurisdiction)}, ${row.encryptedPayload.encryptedData}, ${row.encryptedPayload.encryptedDek},
        ${asJson(row.encryptedPayload.encryption)}, ${asJson(row.consent)}, ${asJson(row.retention)},
        ${asJson(row.audit)}, ${asJson(row.extractionInfo)}, ${row.createdAt}, ${row.updatedAt}
      )
      ON CONFLICT (storage_key) DO UPDATE SET
        record_id = EXCLUDED.record_id,
        status = EXCLUDED.status,
        revision = EXCLUDED.revision,
        schema_version = EXCLUDED.schema_version,
        entity_id = EXCLUDED.entity_id,
        entity_type = EXCLUDED.entity_type,
        entity_version = EXCLUDED.entity_version,
        jurisdiction_json = EXCLUDED.jurisdiction_json,
        encrypted_data = EXCLUDED.encrypted_data,
        encrypted_dek = EXCLUDED.encrypted_dek,
        encryption_json = EXCLUDED.encryption_json,
        consent_json = EXCLUDED.consent_json,
        retention_json = EXCLUDED.retention_json,
        audit_json = EXCLUDED.audit_json,
        extraction_info_json = EXCLUDED.extraction_info_json,
        updated_at = EXCLUDED.updated_at
    `.pipe(Effect.asVoid)

  const updateEncryptedRecord = (
    event: PIIProviderEvent,
    encryptedPayload: EncryptedPayload,
    audit: AuditSummary,
    status?: string
  ) =>
    sql`
      UPDATE pii_provider_records
      SET revision = ${event.revision},
          status = COALESCE(${status ?? null}, status),
          encrypted_data = ${encryptedPayload.encryptedData},
          encrypted_dek = ${encryptedPayload.encryptedDek},
          encryption_json = ${asJson(encryptedPayload.encryption)},
          audit_json = ${asJson(audit)},
          updated_at = ${asDate(event.occurredAt)}
      WHERE storage_key = ${event.storageKey}
    `.pipe(Effect.asVoid)

  const updateConsentRecord = (
    event: PIIConsentUpdated | PIIConsentWithdrawn,
    consent: ConsentState
  ) =>
    sql`
      UPDATE pii_provider_records
      SET revision = ${event.revision},
          consent_json = ${asJson(consent)},
          audit_json = ${asJson(event.audit)},
          updated_at = ${asDate(event.occurredAt)}
      WHERE storage_key = ${event.storageKey}
    `.pipe(Effect.asVoid)

  const updateAuditRecord = (event: PIIProviderEvent, audit: AuditSummary, status?: string) =>
    sql`
      UPDATE pii_provider_records
      SET revision = ${event.revision},
          status = COALESCE(${status ?? null}, status),
          audit_json = ${asJson(audit)},
          updated_at = ${asDate(event.occurredAt)}
      WHERE storage_key = ${event.storageKey}
    `.pipe(Effect.asVoid)

  const upsertSubjectRequest = (event: PIIProviderEvent, request: DataSubjectRequest) =>
    sql`
      INSERT INTO pii_provider_subject_requests
        (request_id, storage_key, record_id, request_type, status, requested_at, completed_at, notes)
      VALUES (
        ${request.requestId}, ${event.storageKey}, ${event.recordId}, ${request.requestType}, ${request.status},
        ${asDate(request.requestedAt)}, ${request.completedAt === undefined ? "" : asDate(request.completedAt)},
        ${request.notes ?? ""}
      )
      ON CONFLICT (request_id) DO UPDATE SET
        storage_key = EXCLUDED.storage_key,
        record_id = EXCLUDED.record_id,
        request_type = EXCLUDED.request_type,
        status = EXCLUDED.status,
        requested_at = EXCLUDED.requested_at,
        completed_at = EXCLUDED.completed_at,
        notes = EXCLUDED.notes
    `.pipe(Effect.asVoid)

  const insertAudit = (event: PIIProviderEvent, auditEntry: AuditEntry) =>
    sql`
      INSERT INTO pii_provider_audit_log
        (id, storage_key, record_id, action, actor_id, actor_type, ip_address, user_agent,
         accessed_at, success, failure_reason, purpose)
      VALUES (
        ${auditEntry.id}, ${event.storageKey}, ${event.recordId}, ${auditEntry.action},
        ${auditEntry.actorId}, ${auditEntry.actorType}, ${auditEntry.ipAddress ?? ""},
        ${auditEntry.userAgent ?? ""}, ${asDate(auditEntry.accessedAt)}, ${auditEntry.success},
        ${auditEntry.failureReason ?? ""}, ${auditEntry.purpose ?? ""}
      )
      ON CONFLICT (id) DO UPDATE SET
        storage_key = EXCLUDED.storage_key,
        record_id = EXCLUDED.record_id,
        action = EXCLUDED.action,
        actor_id = EXCLUDED.actor_id,
        actor_type = EXCLUDED.actor_type,
        ip_address = EXCLUDED.ip_address,
        user_agent = EXCLUDED.user_agent,
        accessed_at = EXCLUDED.accessed_at,
        success = EXCLUDED.success,
        failure_reason = EXCLUDED.failure_reason,
        purpose = EXCLUDED.purpose
    `.pipe(Effect.asVoid)

  const upsertSubjectRequests = (
    event: PIIProviderEvent,
    requests: ReadonlyArray<DataSubjectRequest>
  ) =>
    Effect.forEach(requests, (request) => upsertSubjectRequest(event, request), { discard: true })

  const handlers: Omit<ProjectionHandlers, "dispatch"> = {
    onPIIRecordCreated: (event: PIIRecordCreated) =>
      Effect.all([
        upsertRecord(createdRecordRow(event)),
        upsertSubjectRequests(event, event.dataSubjectRequests),
        insertAudit(event, event.auditEntry)
      ], { discard: true }),

    onPIIRecordStoredFromProfile: (event: PIIRecordStoredFromProfile) =>
      Effect.all([
        upsertRecord(createdRecordRow(event)),
        upsertSubjectRequests(event, event.dataSubjectRequests),
        insertAudit(event, event.auditEntry)
      ], { discard: true }),

    onPIIRecordUpdated: (event: PIIRecordUpdated) =>
      Effect.all([
        updateEncryptedRecord(event, event.encryptedPayload, event.audit),
        insertAudit(event, event.auditEntry)
      ], { discard: true }),

    onPIIConsentUpdated: (event: PIIConsentUpdated) =>
      Effect.all([
        updateConsentRecord(event, event.consent),
        insertAudit(event, event.auditEntry)
      ], { discard: true }),

    onPIIConsentWithdrawn: (event: PIIConsentWithdrawn) =>
      Effect.all([
        updateConsentRecord(event, event.consent),
        insertAudit(event, event.auditEntry)
      ], { discard: true }),

    onPIISubjectRequestCreated: (event: PIISubjectRequestCreated) =>
      Effect.all([
        updateAuditRecord(event, event.audit, event.status),
        upsertSubjectRequest(event, event.subjectRequest),
        insertAudit(event, event.auditEntry)
      ], { discard: true }),

    onPIISubjectRequestCompleted: (event: PIISubjectRequestCompleted) =>
      Effect.all([
        updateAuditRecord(event, event.audit, event.status),
        upsertSubjectRequest(event, event.subjectRequest),
        insertAudit(event, event.auditEntry)
      ], { discard: true }),

    onPIIErasureRequested: (event: PIIErasureRequested) =>
      Effect.all([
        updateAuditRecord(event, event.audit, event.status),
        upsertSubjectRequest(event, event.subjectRequest),
        insertAudit(event, event.auditEntry)
      ], { discard: true }),

    onPIIErasureCompleted: (event: PIIErasureCompleted) =>
      Effect.all([
        updateEncryptedRecord(event, event.encryptedPayload, event.audit, event.status),
        upsertSubjectRequest(event, event.subjectRequest),
        insertAudit(event, event.auditEntry)
      ], { discard: true }),

    onPIIKeyRotated: (event: PIIKeyRotated) =>
      Effect.all([
        updateEncryptedRecord(event, event.encryptedPayload, event.audit),
        insertAudit(event, event.auditEntry)
      ], { discard: true }),

    onPIIRecordAccessed: (event: PIIRecordAccessed) =>
      Effect.all([
        updateAuditRecord(event, event.audit),
        insertAudit(event, event.auditEntry)
      ], { discard: true })
  }

  return { ...handlers, dispatch: makeDispatch(handlers) }
})

export const PIIProviderProjectionStorePgLive = Layer.effect(
  PIIProviderProjectionStore,
  makePIIProviderProjectionStorePg
)
