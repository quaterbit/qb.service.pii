import * as Schema from "effect/Schema"
import * as N2 from "@semyenov/n2/helpers"
import {
  AuditEntry,
  AuditSummary,
  ConsentState,
  DataSubjectRequest,
  EncryptedPayload,
  EntityReference,
  ExtractionInfo,
  Jurisdiction,
  PIIRecordId,
  PIIRecordStatus,
  PIIStorageKey,
  RetentionInfo
} from "./common.js"

const PIIEventBase = {
  storageKey: PIIStorageKey,
  recordId: PIIRecordId,
  occurredAt: Schema.DateTimeUtc,
  actorId: Schema.UUID,
  revision: Schema.Number.pipe(Schema.int())
}

const RecordCreatedFields = {
  ...PIIEventBase,
  schemaVersion: Schema.String,
  entityReference: EntityReference,
  jurisdiction: Jurisdiction,
  encryptedPayload: EncryptedPayload,
  consent: ConsentState,
  dataSubjectRequests: Schema.Array(DataSubjectRequest),
  retention: Schema.NullOr(RetentionInfo),
  audit: AuditSummary,
  auditEntry: AuditEntry,
  extractionInfo: Schema.NullOr(ExtractionInfo),
  status: PIIRecordStatus,
  summary: Schema.String
}

export class PIIRecordCreated extends Schema.TaggedClass<PIIRecordCreated>()(
  "PIIRecordCreated",
  RecordCreatedFields
) {}

export class PIIRecordStoredFromProfile extends Schema.TaggedClass<PIIRecordStoredFromProfile>()(
  "PIIRecordStoredFromProfile",
  RecordCreatedFields
) {}

export class PIIRecordUpdated extends Schema.TaggedClass<PIIRecordUpdated>()(
  "PIIRecordUpdated",
  {
    ...PIIEventBase,
    encryptedPayload: EncryptedPayload,
    audit: AuditSummary,
    auditEntry: AuditEntry,
    summary: Schema.String
  }
) {}

export class PIIConsentUpdated extends Schema.TaggedClass<PIIConsentUpdated>()(
  "PIIConsentUpdated",
  {
    ...PIIEventBase,
    consent: ConsentState,
    audit: AuditSummary,
    auditEntry: AuditEntry
  }
) {}

export class PIIConsentWithdrawn extends Schema.TaggedClass<PIIConsentWithdrawn>()(
  "PIIConsentWithdrawn",
  {
    ...PIIEventBase,
    consent: ConsentState,
    audit: AuditSummary,
    auditEntry: AuditEntry,
    reason: Schema.String,
    retainForLegal: Schema.Boolean
  }
) {}

export class PIISubjectRequestCreated extends Schema.TaggedClass<PIISubjectRequestCreated>()(
  "PIISubjectRequestCreated",
  {
    ...PIIEventBase,
    subjectRequest: DataSubjectRequest,
    status: PIIRecordStatus,
    audit: AuditSummary,
    auditEntry: AuditEntry
  }
) {}

export class PIISubjectRequestCompleted extends Schema.TaggedClass<PIISubjectRequestCompleted>()(
  "PIISubjectRequestCompleted",
  {
    ...PIIEventBase,
    subjectRequest: DataSubjectRequest,
    status: PIIRecordStatus,
    audit: AuditSummary,
    auditEntry: AuditEntry
  }
) {}

export class PIIErasureRequested extends Schema.TaggedClass<PIIErasureRequested>()(
  "PIIErasureRequested",
  {
    ...PIIEventBase,
    subjectRequest: DataSubjectRequest,
    status: PIIRecordStatus,
    audit: AuditSummary,
    auditEntry: AuditEntry,
    reason: Schema.String,
    immediate: Schema.Boolean
  }
) {}

export class PIIErasureCompleted extends Schema.TaggedClass<PIIErasureCompleted>()(
  "PIIErasureCompleted",
  {
    ...PIIEventBase,
    subjectRequest: DataSubjectRequest,
    status: PIIRecordStatus,
    encryptedPayload: EncryptedPayload,
    deletedPayloadUri: Schema.optionalWith(Schema.String, { default: () => "" }),
    audit: AuditSummary,
    auditEntry: AuditEntry
  }
) {}

export class PIIKeyRotated extends Schema.TaggedClass<PIIKeyRotated>()(
  "PIIKeyRotated",
  {
    ...PIIEventBase,
    encryptedPayload: EncryptedPayload,
    audit: AuditSummary,
    auditEntry: AuditEntry,
    reason: Schema.String
  }
) {}

export class PIIRecordAccessed extends Schema.TaggedClass<PIIRecordAccessed>()(
  "PIIRecordAccessed",
  {
    ...PIIEventBase,
    audit: AuditSummary,
    auditEntry: AuditEntry
  }
) {}

export const PIIProviderEvents = N2.defineEvents(
  PIIRecordCreated,
  PIIRecordStoredFromProfile,
  PIIRecordUpdated,
  PIIConsentUpdated,
  PIIConsentWithdrawn,
  PIISubjectRequestCreated,
  PIISubjectRequestCompleted,
  PIIErasureRequested,
  PIIErasureCompleted,
  PIIKeyRotated,
  PIIRecordAccessed
)

export const PIIProviderEvent = PIIProviderEvents.schema
export type PIIProviderEvent = typeof PIIProviderEvent.Type
