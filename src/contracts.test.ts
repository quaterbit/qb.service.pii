import { it, expect } from "@effect/vitest"
import * as Schema from "effect/Schema"
import {
  EntityReference,
  PIIRecordInput,
  SensitivePIIData,
  storageKeyFromEntityReference
} from "./contracts/common.js"
import { storageKeyOfCommand, type PIIProviderCommand } from "./contracts/commands.js"

const decodeRecord = Schema.decodeUnknownSync(PIIRecordInput)
const decodeSensitive = Schema.decodeUnknownSync(SensitivePIIData)

it("decodes the canonical PII record shape with camelCase fields", () => {
  const record = decodeRecord({
    id: "550e8400-e29b-41d4-a716-446655440000",
    schemaVersion: "1.0.0",
    entityReference: {
      entityId: "660e8400-e29b-41d4-a716-446655440001",
      entityType: "AGGREGATE",
      entityVersion: 5
    },
    jurisdiction: {
      countryCode: "RU",
      applicableLaws: ["152-FZ", "GDPR"],
      dataResidency: "RU"
    },
    personalIdentity: {
      fullName: {
        firstName: "Ivan",
        lastName: "Petrov",
        middleName: "Sergeevich"
      },
      birthDate: "1990-05-15",
      citizenship: ["RU"]
    },
    contactData: {
      phones: [{ number: "+79001234567", type: "MOBILE", verified: true }],
      emails: [{ address: "ivan.petrov@example.com", type: "PERSONAL", verified: true }]
    },
    consent: {
      given: true,
      givenAt: "2024-01-15T10:00:00Z",
      consentVersion: "2.0",
      purposes: ["PROFILE_MATCHING", "COMMUNICATION"]
    },
    dataSubjectRequests: [],
    retention: {
      policyId: "retention-ru-standard",
      retentionPeriodDays: 1095,
      expiresAt: "2027-01-15T10:30:00Z",
      legalHold: false
    },
    audit: {
      createdAt: "2024-01-15T10:30:00Z",
      createdBy: "770e8400-e29b-41d4-a716-446655440002",
      accessCount: 3
    },
    extractionInfo: {
      extractedFields: ["userData.personalInfo.firstName"],
      extractionMethod: "LLM_DETECTION",
      confidenceScores: { fullName: 0.99 }
    },
    status: "ACTIVE"
  })

  expect(record.jurisdiction.countryCode).toBe("RU")
  expect(storageKeyFromEntityReference(record.entityReference)).toBe(
    "aggregate:660e8400-e29b-41d4-a716-446655440001:5"
  )
})

it("decodes extracted sensitive PII payloads stored by profile events", () => {
  const sensitive = decodeSensitive({
    personalIdentity: {
      fullName: {
        firstName: "Ada",
        lastName: "Lovelace"
      }
    },
    contactData: {
      emails: [{ address: "ada@example.test", type: "WORK" }]
    }
  })

  expect(sensitive.personalIdentity?.fullName?.firstName).toBe("Ada")
})

it("routes every PII command to a deterministic storage key", () => {
  const storageKey = "aggregate:660e8400-e29b-41d4-a716-446655440001:5"
  const entityReference = new EntityReference({
    entityId: "660e8400-e29b-41d4-a716-446655440001",
    entityType: "AGGREGATE",
    entityVersion: 5
  })
  const commandsWithStorageKey = [
    "StoreExtractedPII",
    "PatchPIIRecord",
    "UpdatePIIConsent",
    "WithdrawPIIConsent",
    "CreateSubjectRequest",
    "CompleteSubjectRequest",
    "RequestPIIErasure",
    "CompletePIIErasure",
    "RotatePIIKey",
    "RecordPIIAccess",
    "GetPIIRecord",
    "GetPIIHistory",
    "GetPIIAuditLog"
  ] as const

  for (const tag of commandsWithStorageKey) {
    expect(storageKeyOfCommand({ _tag: tag, storageKey } as PIIProviderCommand)).toBe(storageKey)
  }

  expect(storageKeyOfCommand({
    _tag: "CreatePIIRecord",
    record: { entityReference }
  } as PIIProviderCommand)).toBe(storageKey)
  expect(storageKeyOfCommand({
    _tag: "GetPIIRecordByEntity",
    entityReference
  } as PIIProviderCommand)).toBe(storageKey)
})
