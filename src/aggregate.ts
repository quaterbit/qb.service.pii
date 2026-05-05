import { randomUUID } from "node:crypto"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as N2 from "@semyenov/n2/helpers"
import { parseObjectUri } from "@semyenov/n2-service-shared/object-storage"
import {
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
  type PIIProviderEvent
} from "./contracts/events.js"
import {
  CommandResult,
  type PIIProviderCommand,
  PIIProviderCommands,
  storageKeyOfCommand
} from "./contracts/commands.js"
import {
  AuditEntry,
  AuditSummary,
  ConsentState,
  DataSubjectRequest,
  EncryptedPayload,
  EncryptionInfo,
  PIIRecordInput,
  PIIRecordDocument,
  PIIRevisionEntry,
  SensitivePIIData,
  sensitiveDataFromInput,
  storageKeyFromEntityReference
} from "./contracts/common.js"
import { PIIError } from "./contracts/errors.js"
import { type PIIState, initialPIIState } from "./contracts/state.js"
import {
  decodeSensitiveDataPayload,
  decryptSensitiveData,
  encryptSensitiveData,
  rotateEncryptedPayload
} from "./payload-store.js"

export { initialPIIState }

const nextRevision = (state: PIIState, offset: number) => state.revision + offset + 1

const appendRevision = (
  state: PIIState,
  revision: number,
  eventType: string,
  summary: string,
  occurredAt: DateTime.Utc,
  actorId: string
) =>
  [
    ...state.revisions,
    new PIIRevisionEntry({
      revision,
      eventType: eventType,
      summary,
      occurredAt: occurredAt,
      actorId: actorId
    })
  ]

const ensureExists = (state: PIIState) =>
  state.status === "empty"
    ? Effect.fail(new PIIError({ message: "PII record does not exist" }))
    : Effect.void

const ensureNotDeleted = (state: PIIState) =>
  state.status === "DELETED"
    ? Effect.fail(new PIIError({ message: "PII record is deleted" }))
    : Effect.void

const ensureCreateAllowed = (state: PIIState) =>
  state.status !== "empty"
    ? Effect.fail(new PIIError({ message: "PII record already exists" }))
    : Effect.void

const ensureStorageKeyMatchesEntityReference = (storageKey: string, record: { readonly entityReference: PIIRecordInput["entityReference"] }) => {
  const expectedStorageKey = storageKeyFromEntityReference(record.entityReference)
  return storageKey === expectedStorageKey
    ? Effect.void
    : Effect.fail(new PIIError({
        message: `PII storage key "${storageKey}" does not match entity reference "${expectedStorageKey}"`
      }))
}

const makeAuditEntry = (
  action: AuditEntry["action"],
  actorId: string,
  actorType: AuditEntry["actorType"],
  occurredAt: DateTime.Utc,
  options?: {
    readonly purpose?: string
    readonly success?: boolean
    readonly failureReason?: string
    readonly ipAddress?: string
    readonly userAgent?: string
  }
) =>
  new AuditEntry({
    id: randomUUID(),
    action,
    actorId: actorId,
    actorType: actorType,
    ipAddress: options?.ipAddress,
    userAgent: options?.userAgent,
    accessedAt: occurredAt,
    success: options?.success ?? true,
    failureReason: options?.failureReason,
    purpose: options?.purpose
  })

const touchAudit = (audit: AuditSummary, occurredAt: DateTime.Utc) =>
  new AuditSummary({
    ...audit,
    lastModifiedAt: occurredAt,
    lastAccessedBy: audit.lastAccessedBy,
    accessCount: audit.accessCount
  })

const accessAudit = (audit: AuditSummary, actorId: string, occurredAt: DateTime.Utc) =>
  new AuditSummary({
    ...audit,
    lastAccessedAt: occurredAt,
    lastAccessedBy: actorId,
    accessCount: (audit.accessCount ?? 0) + 1
  })

const parseExtractedPII = (piiJson: string) =>
  Effect.try({
    try: () => JSON.parse(piiJson) as unknown,
    catch: (error) => new PIIError({ message: `Invalid piiJson: ${String(error)}` })
  }).pipe(
    Effect.flatMap((value) => decodeSensitiveDataPayload(value)),
    Effect.mapError((error) =>
      error instanceof PIIError
        ? error
        : new PIIError({ message: `Invalid extracted PII payload: ${String(error)}` })
    )
  )

const mergeSensitiveData = (current: SensitivePIIData, patch: SensitivePIIData) =>
  new SensitivePIIData({
    personalIdentity: patch.personalIdentity ?? current.personalIdentity,
    contactData: patch.contactData ?? current.contactData,
    biometricData: patch.biometricData ?? current.biometricData,
    financialData: patch.financialData ?? current.financialData,
    socialProfiles: patch.socialProfiles ?? current.socialProfiles
  })

const makeCreatedEventFields = (
  record: PIIRecordInput,
  storageKey: string,
  encryptedPayload: EncryptedPayload,
  occurredAt: DateTime.Utc,
  actorId: string,
  summary: string,
  revision: number
) => {
  const auditEntry = makeAuditEntry("CREATE", actorId, "SYSTEM", occurredAt)
  return {
    storageKey: storageKey,
    recordId: record.id,
    schemaVersion: record.schemaVersion,
    entityReference: record.entityReference,
    jurisdiction: record.jurisdiction,
    encryptedPayload: encryptedPayload,
    consent: record.consent,
    dataSubjectRequests: record.dataSubjectRequests ?? [],
    retention: record.retention ?? null,
    audit: record.audit,
    auditEntry: auditEntry,
    extractionInfo: record.extractionInfo ?? null,
    status: record.status,
    occurredAt: occurredAt,
    actorId: actorId,
    revision,
    summary
  }
}

const completeRequest = (
  requests: ReadonlyArray<DataSubjectRequest>,
  requestId: string,
  status: DataSubjectRequest["status"],
  completedAt: DateTime.Utc,
  notes?: string
) =>
  requests.map((request) =>
    request.requestId === requestId
      ? new DataSubjectRequest({
          ...request,
          status,
          completedAt: completedAt,
          notes: notes ?? request.notes
        })
      : request
  )

const destroyedPayload = (state: PIIState, occurredAt: DateTime.Utc) =>
  new EncryptedPayload({
    encryptedData: "",
    encryptedDek: "",
    encryption: new EncryptionInfo({
      ...state.encryptedPayload.encryption,
      keyId: `destroyed:${state.encryptedPayload.encryption.keyId}`,
      encryptedAt: occurredAt
    })
  })

export const PIIProvider = N2.define<PIIProviderEvent, PIIProviderCommand>()({
  initialState: initialPIIState,
  commands: PIIProviderCommands.constructors,
  evolve: {
    PIIRecordCreated: (state, event) => ({
      ...state,
      status: event.status,
      storageKey: event.storageKey,
      recordId: event.recordId,
      schemaVersion: event.schemaVersion,
      entityReference: event.entityReference,
      jurisdiction: event.jurisdiction,
      encryptedPayload: event.encryptedPayload,
      consent: event.consent,
      dataSubjectRequests: event.dataSubjectRequests,
      retention: event.retention,
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      extractionInfo: event.extractionInfo,
      revisions: appendRevision(state, event.revision, event._tag, event.summary, event.occurredAt, event.actorId),
      revision: event.revision
    }),
    PIIRecordStoredFromProfile: (state, event) => ({
      ...state,
      status: event.status,
      storageKey: event.storageKey,
      recordId: event.recordId,
      schemaVersion: event.schemaVersion,
      entityReference: event.entityReference,
      jurisdiction: event.jurisdiction,
      encryptedPayload: event.encryptedPayload,
      consent: event.consent,
      dataSubjectRequests: event.dataSubjectRequests,
      retention: event.retention,
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      extractionInfo: event.extractionInfo,
      revisions: appendRevision(state, event.revision, event._tag, event.summary, event.occurredAt, event.actorId),
      revision: event.revision
    }),
    PIIRecordUpdated: (state, event) => ({
      ...state,
      encryptedPayload: event.encryptedPayload,
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      revisions: appendRevision(state, event.revision, event._tag, event.summary, event.occurredAt, event.actorId),
      revision: event.revision
    }),
    PIIConsentUpdated: (state, event) => ({
      ...state,
      consent: event.consent,
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      revisions: appendRevision(state, event.revision, event._tag, "consent updated", event.occurredAt, event.actorId),
      revision: event.revision
    }),
    PIIConsentWithdrawn: (state, event) => ({
      ...state,
      consent: event.consent,
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      revisions: appendRevision(state, event.revision, event._tag, event.reason, event.occurredAt, event.actorId),
      revision: event.revision
    }),
    PIISubjectRequestCreated: (state, event) => ({
      ...state,
      status: event.status,
      dataSubjectRequests: [...state.dataSubjectRequests, event.subjectRequest],
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      revisions: appendRevision(state, event.revision, event._tag, event.subjectRequest.requestType, event.occurredAt, event.actorId),
      revision: event.revision
    }),
    PIISubjectRequestCompleted: (state, event) => ({
      ...state,
      status: event.status,
      dataSubjectRequests: completeRequest(
        state.dataSubjectRequests,
        event.subjectRequest.requestId,
        event.subjectRequest.status,
        event.occurredAt,
        event.subjectRequest.notes
      ),
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      revisions: appendRevision(state, event.revision, event._tag, event.subjectRequest.requestType, event.occurredAt, event.actorId),
      revision: event.revision
    }),
    PIIErasureRequested: (state, event) => ({
      ...state,
      status: event.status,
      dataSubjectRequests: [...state.dataSubjectRequests, event.subjectRequest],
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      revisions: appendRevision(state, event.revision, event._tag, event.reason, event.occurredAt, event.actorId),
      revision: event.revision
    }),
    PIIErasureCompleted: (state, event) => ({
      ...state,
      status: event.status,
      encryptedPayload: event.encryptedPayload,
      dataSubjectRequests: completeRequest(
        state.dataSubjectRequests,
        event.subjectRequest.requestId,
        event.subjectRequest.status,
        event.occurredAt,
        event.subjectRequest.notes
      ),
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      revisions: appendRevision(state, event.revision, event._tag, "erasure completed", event.occurredAt, event.actorId),
      revision: event.revision
    }),
    PIIKeyRotated: (state, event) => ({
      ...state,
      encryptedPayload: event.encryptedPayload,
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      revisions: appendRevision(state, event.revision, event._tag, event.reason, event.occurredAt, event.actorId),
      revision: event.revision
    }),
    PIIRecordAccessed: (state, event) => ({
      ...state,
      audit: event.audit,
      auditEntries: [...state.auditEntries, event.auditEntry],
      revisions: appendRevision(state, event.revision, event._tag, event.auditEntry.purpose ?? "access", event.occurredAt, event.actorId),
      revision: event.revision
    })
  },
  decide: {
    StoreExtractedPII: (state, command) =>
      Effect.gen(function* () {
        yield* ensureCreateAllowed(state)
        yield* ensureStorageKeyMatchesEntityReference(command.storageKey, command)
        const now = yield* DateTime.now
        const sensitiveData = yield* parseExtractedPII(command.piiJson)
        const encryptedPayload = yield* encryptSensitiveData(command.storageKey, sensitiveData)
        const record = new PIIRecordInput({
          id: command.recordId,
          schemaVersion: command.schemaVersion,
          entityReference: command.entityReference,
          jurisdiction: command.jurisdiction,
          personalIdentity: sensitiveData.personalIdentity,
          contactData: sensitiveData.contactData,
          biometricData: sensitiveData.biometricData,
          financialData: sensitiveData.financialData,
          socialProfiles: sensitiveData.socialProfiles,
          consent: command.consent,
          audit: new AuditSummary({
            createdAt: now,
            createdBy: command.actorId,
            accessCount: 0
          }),
          extractionInfo: command.extractionInfo,
          status: "ACTIVE"
        })
        return [
          new PIIRecordStoredFromProfile(makeCreatedEventFields(
            record,
            command.storageKey,
            encryptedPayload,
            now,
            command.actorId,
            command.summary,
            nextRevision(state, 0)
          ))
        ]
      }),
    CreatePIIRecord: (state, command) =>
      Effect.gen(function* () {
        yield* ensureCreateAllowed(state)
        const storageKey = command.storageKey ?? storageKeyFromEntityReference(command.record.entityReference)
        yield* ensureStorageKeyMatchesEntityReference(storageKey, command.record)
        const now = yield* DateTime.now
        const encryptedPayload = yield* encryptSensitiveData(storageKey, sensitiveDataFromInput(command.record))
        return [
          new PIIRecordCreated(makeCreatedEventFields(
            command.record,
            storageKey,
            encryptedPayload,
            now,
            command.actorId,
            command.summary,
            nextRevision(state, 0)
          ))
        ]
      }),
    PatchPIIRecord: (state, command) =>
      Effect.gen(function* () {
        yield* ensureExists(state)
        yield* ensureNotDeleted(state)
        const now = yield* DateTime.now
        const current = yield* decryptSensitiveData(state)
        const next = mergeSensitiveData(current, command.personalData)
        const encryptedPayload = yield* encryptSensitiveData(command.storageKey, next)
        const audit = touchAudit(state.audit, now)
        return [
          new PIIRecordUpdated({
            storageKey: state.storageKey,
            recordId: state.recordId,
            encryptedPayload: encryptedPayload,
            audit,
            auditEntry: makeAuditEntry("UPDATE", command.actorId, "USER", now, { purpose: command.reason }),
            occurredAt: now,
            actorId: command.actorId,
            revision: nextRevision(state, 0),
            summary: command.reason
          })
        ]
      }),
    UpdatePIIConsent: (state, command) =>
      Effect.gen(function* () {
        yield* ensureExists(state)
        yield* ensureNotDeleted(state)
        const now = yield* DateTime.now
        const consent = new ConsentState({
          given: command.given,
          givenAt: now,
          consentVersion: command.consentVersion,
          purposes: command.purposes,
          withdrawalRequested: false
        })
        const audit = touchAudit(state.audit, now)
        return [
          new PIIConsentUpdated({
            storageKey: state.storageKey,
            recordId: state.recordId,
            consent,
            audit,
            auditEntry: makeAuditEntry("UPDATE", command.actorId, "USER", now, { purpose: "consent" }),
            occurredAt: now,
            actorId: command.actorId,
            revision: nextRevision(state, 0)
          })
        ]
      }),
    WithdrawPIIConsent: (state, command) =>
      Effect.gen(function* () {
        yield* ensureExists(state)
        yield* ensureNotDeleted(state)
        const now = yield* DateTime.now
        const consent = new ConsentState({
          ...state.consent,
          given: false,
          withdrawalRequested: true,
          withdrawalDate: now
        })
        const audit = touchAudit(state.audit, now)
        return [
          new PIIConsentWithdrawn({
            storageKey: state.storageKey,
            recordId: state.recordId,
            consent,
            audit,
            auditEntry: makeAuditEntry("UPDATE", command.actorId, "USER", now, { purpose: "consent withdrawal" }),
            reason: command.reason,
            retainForLegal: command.retainForLegal,
            occurredAt: now,
            actorId: command.actorId,
            revision: nextRevision(state, 0)
          })
        ]
      }),
    CreateSubjectRequest: (state, command) =>
      Effect.gen(function* () {
        yield* ensureExists(state)
        yield* ensureNotDeleted(state)
        const now = yield* DateTime.now
        const subjectRequest = new DataSubjectRequest({
          requestId: command.requestId,
          requestType: command.requestType,
          requestedAt: now,
          status: "PENDING",
          notes: command.notes
        })
        const audit = touchAudit(state.audit, now)
        return [
          new PIISubjectRequestCreated({
            storageKey: state.storageKey,
            recordId: state.recordId,
            subjectRequest: subjectRequest,
            status: state.status === "empty" ? "ACTIVE" : state.status,
            audit,
            auditEntry: makeAuditEntry("UPDATE", command.actorId, "USER", now, { purpose: command.requestType }),
            occurredAt: now,
            actorId: command.actorId,
            revision: nextRevision(state, 0)
          })
        ]
      }),
    CompleteSubjectRequest: (state, command) =>
      Effect.gen(function* () {
        yield* ensureExists(state)
        yield* ensureNotDeleted(state)
        const existing = state.dataSubjectRequests.find((request) => request.requestId === command.requestId)
        if (existing === undefined) {
          return yield* new PIIError({ message: `Subject request "${command.requestId}" does not exist` })
        }
        const now = yield* DateTime.now
        const subjectRequest = new DataSubjectRequest({
          ...existing,
          status: command.status,
          completedAt: now,
          notes: command.notes ?? existing.notes
        })
        const audit = touchAudit(state.audit, now)
        return [
          new PIISubjectRequestCompleted({
            storageKey: state.storageKey,
            recordId: state.recordId,
            subjectRequest: subjectRequest,
            status: state.status === "empty" ? "ACTIVE" : state.status,
            audit,
            auditEntry: makeAuditEntry("UPDATE", command.actorId, "USER", now, { purpose: existing.requestType }),
            occurredAt: now,
            actorId: command.actorId,
            revision: nextRevision(state, 0)
          })
        ]
      }),
    RequestPIIErasure: (state, command) =>
      Effect.gen(function* () {
        yield* ensureExists(state)
        yield* ensureNotDeleted(state)
        if (state.retention?.legalHold === true) {
          return yield* new PIIError({ message: "Cannot erase PII while legal hold is active" })
        }
        const now = yield* DateTime.now
        const subjectRequest = new DataSubjectRequest({
          requestId: command.requestId,
          requestType: "ERASURE",
          requestedAt: now,
          status: "PENDING",
          notes: command.reason
        })
        const audit = touchAudit(state.audit, now)
        return [
          new PIIErasureRequested({
            storageKey: state.storageKey,
            recordId: state.recordId,
            subjectRequest: subjectRequest,
            status: "PENDING_DELETION",
            audit,
            auditEntry: makeAuditEntry("DELETE", command.actorId, "USER", now, { purpose: "erasure requested" }),
            reason: command.reason,
            immediate: command.immediate,
            occurredAt: now,
            actorId: command.actorId,
            revision: nextRevision(state, 0)
          })
        ]
      }),
    CompletePIIErasure: (state, command) =>
      Effect.gen(function* () {
        yield* ensureExists(state)
        yield* ensureNotDeleted(state)
        const existing = state.dataSubjectRequests.find((request) => request.requestId === command.requestId)
        if (existing === undefined || existing.requestType !== "ERASURE") {
          return yield* new PIIError({ message: `Erasure request "${command.requestId}" does not exist` })
        }
        const now = yield* DateTime.now
        const deletedPayloadUri = parseObjectUri(state.encryptedPayload.encryptedData)?.uri ?? ""
        const subjectRequest = new DataSubjectRequest({
          ...existing,
          status: "COMPLETED",
          completedAt: now
        })
        const audit = touchAudit(state.audit, now)
        return [
          new PIIErasureCompleted({
            storageKey: state.storageKey,
            recordId: state.recordId,
            subjectRequest: subjectRequest,
            status: "DELETED",
            encryptedPayload: destroyedPayload(state, now),
            deletedPayloadUri,
            audit,
            auditEntry: makeAuditEntry("DELETE", command.actorId, "ADMIN", now, { purpose: "erasure completed" }),
            occurredAt: now,
            actorId: command.actorId,
            revision: nextRevision(state, 0)
          })
        ]
      }),
    RotatePIIKey: (state, command) =>
      Effect.gen(function* () {
        yield* ensureExists(state)
        yield* ensureNotDeleted(state)
        const now = yield* DateTime.now
        const encryptedPayload = yield* rotateEncryptedPayload(state)
        const audit = touchAudit(state.audit, now)
        return [
          new PIIKeyRotated({
            storageKey: state.storageKey,
            recordId: state.recordId,
            encryptedPayload: encryptedPayload,
            audit,
            auditEntry: makeAuditEntry("UPDATE", command.actorId, "ADMIN", now, { purpose: "key rotation" }),
            reason: command.reason,
            occurredAt: now,
            actorId: command.actorId,
            revision: nextRevision(state, 0)
          })
        ]
      }),
    RecordPIIAccess: (state, command) =>
      Effect.gen(function* () {
        yield* ensureExists(state)
        const now = yield* DateTime.now
        const audit = command.success
          ? accessAudit(state.audit, command.actorId, now)
          : state.audit
        return [
          new PIIRecordAccessed({
            storageKey: state.storageKey,
            recordId: state.recordId,
            audit,
            auditEntry: makeAuditEntry("READ", command.actorId, command.actorType, now, {
              purpose: command.purpose,
              success: command.success,
              failureReason: command.failureReason,
              ipAddress: command.ipAddress,
              userAgent: command.userAgent
            }),
            occurredAt: now,
            actorId: command.actorId,
            revision: nextRevision(state, 0)
          })
        ]
      }),
    GetPIIRecord: (_state, _command) => Effect.succeed([]),
    GetPIIRecordByEntity: (_state, _command) => Effect.succeed([]),
    GetPIIHistory: (_state, _command) => Effect.succeed([]),
    GetPIIAuditLog: (_state, _command) => Effect.succeed([])
  }
})

export const { evolve, decide, handle, initialState: _initialState } = PIIProvider

export const toCommandResult = (entityId: string, state: PIIState) =>
  new CommandResult({
    storageKey: entityId,
    recordId: state.recordId,
    status: state.status,
    revision: state.revision
  })

export const toPIIRecordDocument = (state: PIIState, sensitiveData: SensitivePIIData) =>
  new PIIRecordDocument({
    id: state.recordId,
    schemaVersion: state.schemaVersion,
    entityReference: state.entityReference,
    jurisdiction: state.jurisdiction,
    encryption: state.encryptedPayload.encryption,
    personalIdentity: sensitiveData.personalIdentity,
    contactData: sensitiveData.contactData,
    biometricData: sensitiveData.biometricData,
    financialData: sensitiveData.financialData,
    socialProfiles: sensitiveData.socialProfiles,
    consent: state.consent,
    dataSubjectRequests: state.dataSubjectRequests,
    retention: state.retention ?? undefined,
    audit: state.audit,
    extractionInfo: state.extractionInfo ?? undefined,
    status: state.status === "empty" ? "ACTIVE" : state.status
  })

export { decryptSensitiveData, storageKeyOfCommand }
