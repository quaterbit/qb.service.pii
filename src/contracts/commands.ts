import * as Schema from "effect/Schema"
import * as N2 from "@semyenov/n2/helpers"
import {
  ActorType,
  ConsentPurpose,
  ConsentState,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  EntityReference,
  ExtractionInfo,
  Jurisdiction,
  PIIAuditLog,
  PIIRecordDocument,
  PIIRecordId,
  PIIRecordInput,
  PIIStorageKey,
  SensitivePIIData,
  storageKeyFromEntityReference
} from "./common.js"
import { PIIError, PIINotFound } from "./errors.js"
import { PIIHistory, PIIState } from "./state.js"

export class CommandResult extends Schema.Class<CommandResult>("PIICommandResult")({
  storageKey: PIIStorageKey,
  recordId: PIIRecordId,
  status: Schema.String,
  revision: Schema.Number.pipe(Schema.int())
}) {}

export class StoreExtractedPII extends Schema.TaggedRequest<StoreExtractedPII>("StoreExtractedPII")(
  "StoreExtractedPII",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: PIIStorageKey,
      recordId: PIIRecordId,
      schemaVersion: Schema.String,
      entityReference: EntityReference,
      jurisdiction: Jurisdiction,
      piiJson: Schema.String,
      consent: ConsentState,
      extractionInfo: Schema.optional(ExtractionInfo),
      actorId: Schema.UUID,
      summary: Schema.String
    }
  }
) {}

export class CreatePIIRecord extends Schema.TaggedRequest<CreatePIIRecord>("CreatePIIRecord")(
  "CreatePIIRecord",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: Schema.optional(PIIStorageKey),
      record: PIIRecordInput,
      actorId: Schema.UUID,
      summary: Schema.String
    }
  }
) {}

export class PatchPIIRecord extends Schema.TaggedRequest<PatchPIIRecord>("PatchPIIRecord")(
  "PatchPIIRecord",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: PIIStorageKey,
      personalData: SensitivePIIData,
      actorId: Schema.UUID,
      reason: Schema.String
    }
  }
) {}

export class UpdatePIIConsent extends Schema.TaggedRequest<UpdatePIIConsent>("UpdatePIIConsent")(
  "UpdatePIIConsent",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: PIIStorageKey,
      given: Schema.Boolean,
      purposes: Schema.Array(ConsentPurpose),
      consentVersion: Schema.String,
      actorId: Schema.UUID
    }
  }
) {}

export class WithdrawPIIConsent extends Schema.TaggedRequest<WithdrawPIIConsent>("WithdrawPIIConsent")(
  "WithdrawPIIConsent",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: PIIStorageKey,
      reason: Schema.String,
      retainForLegal: Schema.Boolean,
      actorId: Schema.UUID
    }
  }
) {}

export class CreateSubjectRequest extends Schema.TaggedRequest<CreateSubjectRequest>("CreateSubjectRequest")(
  "CreateSubjectRequest",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: PIIStorageKey,
      requestId: Schema.UUID,
      requestType: DataSubjectRequestType,
      notes: Schema.optional(Schema.String),
      actorId: Schema.UUID
    }
  }
) {}

export class CompleteSubjectRequest extends Schema.TaggedRequest<CompleteSubjectRequest>("CompleteSubjectRequest")(
  "CompleteSubjectRequest",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: PIIStorageKey,
      requestId: Schema.UUID,
      status: DataSubjectRequestStatus,
      notes: Schema.optional(Schema.String),
      actorId: Schema.UUID
    }
  }
) {}

export class RequestPIIErasure extends Schema.TaggedRequest<RequestPIIErasure>("RequestPIIErasure")(
  "RequestPIIErasure",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: PIIStorageKey,
      requestId: Schema.UUID,
      reason: Schema.String,
      immediate: Schema.Boolean,
      actorId: Schema.UUID
    }
  }
) {}

export class CompletePIIErasure extends Schema.TaggedRequest<CompletePIIErasure>("CompletePIIErasure")(
  "CompletePIIErasure",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: PIIStorageKey,
      requestId: Schema.UUID,
      actorId: Schema.UUID
    }
  }
) {}

export class RotatePIIKey extends Schema.TaggedRequest<RotatePIIKey>("RotatePIIKey")(
  "RotatePIIKey",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: PIIStorageKey,
      reason: Schema.String,
      actorId: Schema.UUID
    }
  }
) {}

export class RecordPIIAccess extends Schema.TaggedRequest<RecordPIIAccess>("RecordPIIAccess")(
  "RecordPIIAccess",
  {
    failure: PIIError,
    success: CommandResult,
    payload: {
      storageKey: PIIStorageKey,
      actorId: Schema.UUID,
      actorType: ActorType,
      purpose: Schema.String,
      ipAddress: Schema.optional(Schema.String),
      userAgent: Schema.optional(Schema.String),
      success: Schema.Boolean,
      failureReason: Schema.optional(Schema.String)
    }
  }
) {}

export class GetPIIRecord extends Schema.TaggedRequest<GetPIIRecord>("GetPIIRecord")(
  "GetPIIRecord",
  {
    failure: Schema.Union(PIINotFound, PIIError),
    success: PIIRecordDocument,
    payload: {
      storageKey: PIIStorageKey,
      actorId: Schema.UUID,
      actorType: ActorType,
      purpose: Schema.String,
      ipAddress: Schema.optional(Schema.String),
      userAgent: Schema.optional(Schema.String)
    }
  }
) {}

export class GetPIIRecordByEntity extends Schema.TaggedRequest<GetPIIRecordByEntity>("GetPIIRecordByEntity")(
  "GetPIIRecordByEntity",
  {
    failure: Schema.Union(PIINotFound, PIIError),
    success: PIIRecordDocument,
    payload: {
      entityReference: EntityReference,
      actorId: Schema.UUID,
      actorType: ActorType,
      purpose: Schema.String,
      ipAddress: Schema.optional(Schema.String),
      userAgent: Schema.optional(Schema.String)
    }
  }
) {}

export class GetPIIHistory extends Schema.TaggedRequest<GetPIIHistory>("GetPIIHistory")(
  "GetPIIHistory",
  {
    failure: PIINotFound,
    success: PIIHistory,
    payload: { storageKey: PIIStorageKey }
  }
) {}

export class GetPIIAuditLog extends Schema.TaggedRequest<GetPIIAuditLog>("GetPIIAuditLog")(
  "GetPIIAuditLog",
  {
    failure: PIINotFound,
    success: PIIAuditLog,
    payload: { storageKey: PIIStorageKey }
  }
) {}

export const PIIProviderCommands = N2.defineCommands(
  StoreExtractedPII,
  CreatePIIRecord,
  PatchPIIRecord,
  UpdatePIIConsent,
  WithdrawPIIConsent,
  CreateSubjectRequest,
  CompleteSubjectRequest,
  RequestPIIErasure,
  CompletePIIErasure,
  RotatePIIKey,
  RecordPIIAccess,
  GetPIIRecord,
  GetPIIRecordByEntity,
  GetPIIHistory,
  GetPIIAuditLog
)

export const PIIProviderCommand = PIIProviderCommands.schema
export type PIIProviderCommand = typeof PIIProviderCommand.Type

export const storageKeyOfCommand = (command: PIIProviderCommand): string => {
  switch (command._tag) {
    case "StoreExtractedPII":
    case "PatchPIIRecord":
    case "UpdatePIIConsent":
    case "WithdrawPIIConsent":
    case "CreateSubjectRequest":
    case "CompleteSubjectRequest":
    case "RequestPIIErasure":
    case "CompletePIIErasure":
    case "RotatePIIKey":
    case "RecordPIIAccess":
    case "GetPIIRecord":
    case "GetPIIHistory":
    case "GetPIIAuditLog":
      return command.storageKey
    case "CreatePIIRecord":
      return command.storageKey ?? storageKeyFromEntityReference(command.record.entityReference)
    case "GetPIIRecordByEntity":
      return storageKeyFromEntityReference(command.entityReference)
  }
}

const storageKeyOfPersistedCommand = (command: unknown) =>
  storageKeyOfCommand(command as PIIProviderCommand)

export const PIIProviderEntity = PIIProviderCommands.toEntityWithPersisted(
  "PIIProvider",
  storageKeyOfPersistedCommand,
  [
    "StoreExtractedPII",
    "CreatePIIRecord",
    "PatchPIIRecord",
    "UpdatePIIConsent",
    "WithdrawPIIConsent",
    "CreateSubjectRequest",
    "CompleteSubjectRequest",
    "RequestPIIErasure",
    "CompletePIIErasure",
    "RotatePIIKey",
    "RecordPIIAccess"
  ]
)
export const PIIProviderRpcs = PIIProviderEntity.protocol
