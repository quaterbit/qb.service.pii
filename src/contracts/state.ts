import * as Schema from "effect/Schema"
import * as DateTime from "effect/DateTime"
import {
  AuditEntry,
  AuditSummary,
  ConsentState,
  DataSubjectRequest,
  EncryptedPayload,
  EncryptionInfo,
  EntityReference,
  ExtractionInfo,
  Jurisdiction,
  PIIRecordId,
  PIIRevisionEntry,
  PIIStateStatus,
  RetentionInfo
} from "./common.js"

const emptyReference = new EntityReference({
  entityId: "00000000-0000-4000-8000-000000000000",
  entityType: "AGGREGATE",
  entityVersion: 1
})

const emptyJurisdiction = new Jurisdiction({
  countryCode: "US",
  applicableLaws: ["OTHER"]
})

const emptyAudit = new AuditSummary({
  createdAt: DateTime.unsafeMake("1970-01-01T00:00:00.000Z"),
  createdBy: "00000000-0000-4000-8000-000000000000",
  accessCount: 0
})

const emptyConsent = new ConsentState({
  given: false,
  purposes: [],
  withdrawalRequested: false
})

const emptyEncryptedPayload = new EncryptedPayload({
  encryptedData: "",
  encryptedDek: "",
  encryption: new EncryptionInfo({
    keyId: "",
    algorithm: "AES-256-GCM",
    keyVersion: 1,
    encryptedAt: DateTime.unsafeMake("1970-01-01T00:00:00.000Z")
  })
})

export class PIIState extends Schema.Class<PIIState>("PIIState")({
  status: PIIStateStatus,
  storageKey: Schema.String,
  recordId: PIIRecordId,
  schemaVersion: Schema.String,
  entityReference: EntityReference,
  jurisdiction: Jurisdiction,
  encryptedPayload: EncryptedPayload,
  consent: ConsentState,
  dataSubjectRequests: Schema.Array(DataSubjectRequest),
  retention: Schema.NullOr(RetentionInfo),
  audit: AuditSummary,
  auditEntries: Schema.Array(AuditEntry),
  extractionInfo: Schema.NullOr(ExtractionInfo),
  revisions: Schema.Array(PIIRevisionEntry),
  revision: Schema.Number.pipe(Schema.int())
}) {}

export const initialPIIState = new PIIState({
  status: "empty",
  storageKey: "",
  recordId: "00000000-0000-4000-8000-000000000000",
  schemaVersion: "",
  entityReference: emptyReference,
  jurisdiction: emptyJurisdiction,
  encryptedPayload: emptyEncryptedPayload,
  consent: emptyConsent,
  dataSubjectRequests: [],
  retention: null,
  audit: emptyAudit,
  auditEntries: [],
  extractionInfo: null,
  revisions: [],
  revision: 0
})

export class PIIHistory extends Schema.Class<PIIHistory>("PIIHistory")({
  storageKey: Schema.String,
  recordId: PIIRecordId,
  currentRevision: Schema.Number.pipe(Schema.int()),
  status: PIIStateStatus,
  requests: Schema.Array(DataSubjectRequest),
  auditEntries: Schema.Array(AuditEntry),
  revisions: Schema.Array(PIIRevisionEntry)
}) {}
