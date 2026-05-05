import { it, expect } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { handle, initialPIIState, decryptSensitiveData, toPIIRecordDocument } from "./aggregate.js"
import {
  CreatePIIRecord,
  RequestPIIErasure,
  CompletePIIErasure,
  GetPIIRecord,
  PatchPIIRecord,
  RotatePIIKey,
  StoreExtractedPII,
  UpdatePIIConsent,
  WithdrawPIIConsent
} from "./contracts/commands.js"
import {
  AuditSummary,
  ConsentState,
  EntityReference,
  Jurisdiction,
  PIIRecordInput,
  SensitivePIIData,
  storageKeyFromEntityReference
} from "./contracts/common.js"
import { PIIError } from "./contracts/errors.js"
import { PIICrypto, PIICryptoLive } from "./crypto.js"
import {
  ObjectStorage,
  ObjectStorageError,
  objectUri
} from "@semyenov/n2-service-shared/object-storage"

const makeUuid = (seed: number) =>
  `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`

const decodeSensitive = Schema.decodeUnknownSync(SensitivePIIData)

const storedObjects = new Map<string, Uint8Array>()
const storedObjectKey = (bucket: string, key: string) => `${bucket}/${key}`

const TestObjectStorage = Layer.succeed(ObjectStorage, {
  ensureBucket: (_bucket: string) => Effect.void,
  putObject: (input) =>
    Effect.sync(() => {
      const body = typeof input.body === "string"
        ? Buffer.from(input.body)
        : Buffer.from(input.body)
      storedObjects.set(storedObjectKey(input.bucket, input.key), body)
      return { bucket: input.bucket, key: input.key, uri: objectUri(input.bucket, input.key) }
    }),
  getObject: (input) =>
    Effect.try({
      try: () => {
        const object = storedObjects.get(storedObjectKey(input.bucket, input.key))
        if (object === undefined) {
          throw new Error(`Object "${input.bucket}/${input.key}" not found`)
        }
        return object
      },
      catch: (cause) => new ObjectStorageError({ message: String(cause) })
    }),
  deleteObject: (input) =>
    Effect.sync(() => {
      storedObjects.delete(storedObjectKey(input.bucket, input.key))
    })
})

const TestInfrastructure = Layer.merge(PIICryptoLive, TestObjectStorage)

const run = <A, E>(effect: Effect.Effect<A, E, PIICrypto | ObjectStorage>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestInfrastructure)))

const makeReference = (seed = 1) =>
  new EntityReference({
    entityId: makeUuid(seed),
    entityType: "AGGREGATE",
    entityVersion: 1
  })

const makeJurisdiction = () =>
  new Jurisdiction({
    countryCode: "RU",
    applicableLaws: ["152-FZ"],
    dataResidency: "RU"
  })

const makeConsent = () =>
  new ConsentState({
    given: true,
    givenAt: DateTime.unsafeMake("2026-01-01T00:00:00.000Z"),
    consentVersion: "1.0",
    purposes: ["PROFILE_MATCHING"],
    withdrawalRequested: false
  })

const makeAudit = (actorId: string) =>
  new AuditSummary({
    createdAt: DateTime.unsafeMake("2026-01-01T00:00:00.000Z"),
    createdBy: actorId,
    accessCount: 0
  })

const makeSensitive = (name = "Ada") =>
  decodeSensitive({
    personalIdentity: {
      fullName: {
        firstName: name,
        lastName: "Lovelace"
      }
    },
    contactData: {
      phones: [{ number: "+79001234567", type: "MOBILE", verified: true }],
      emails: [{ address: `${name.toLowerCase()}@example.test`, type: "WORK" }]
    }
  })

const makeRecord = (recordId: string, actorId: string, reference = makeReference()) =>
  new PIIRecordInput({
    id: recordId,
    schemaVersion: "1.0.0",
    entityReference: reference,
    jurisdiction: makeJurisdiction(),
    personalIdentity: makeSensitive("Ada").personalIdentity,
    contactData: makeSensitive("Ada").contactData,
    consent: makeConsent(),
    dataSubjectRequests: [],
    audit: makeAudit(actorId),
    status: "ACTIVE"
  })

it("CreatePIIRecord stores encrypted PII and keeps profile linkage", async () => {
  const actorId = makeUuid(10)
  const record = makeRecord(makeUuid(20), actorId)
  const storageKey = storageKeyFromEntityReference(record.entityReference)

  const { state, events } = await run(handle(initialPIIState, new CreatePIIRecord({
    record,
    actorId: actorId,
    summary: "store profile pii"
  })))

  expect(state.status).toBe("ACTIVE")
  expect(state.storageKey).toBe(storageKey)
  expect(state.encryptedPayload.encryptedData).toBe(`s3://n2-pii-payloads/${storageKey}/payload.enc`)
  expect(state.encryptedPayload.encryptedData).not.toContain("Ada")
  expect(storedObjects.has(storedObjectKey("n2-pii-payloads", `${storageKey}/payload.enc`))).toBe(true)
  expect(events.map((event) => event._tag)).toEqual(["PIIRecordCreated"])

  const sensitive = await run(decryptSensitiveData(state))
  const document = toPIIRecordDocument(state, sensitive)
  expect(document.personalIdentity?.fullName?.firstName).toBe("Ada")
  expect(document.entityReference.entityId).toBe(record.entityReference.entityId)
})

it("StoreExtractedPII accepts the profile-provider extraction payload shape", async () => {
  const actorId = makeUuid(11)
  const reference = makeReference(2)
  const storageKey = storageKeyFromEntityReference(reference)

  const { state, events } = await run(handle(initialPIIState, new StoreExtractedPII({
    storageKey: storageKey,
    recordId: makeUuid(21),
    schemaVersion: "1.0.0",
    entityReference: reference,
    jurisdiction: makeJurisdiction(),
    piiJson: JSON.stringify(Schema.encodeSync(SensitivePIIData)(makeSensitive("Grace"))),
    consent: makeConsent(),
    actorId: actorId,
    summary: "ingest PersonalDataExtracted"
  })))

  expect(state.storageKey).toBe(storageKey)
  expect(events[0]?._tag).toBe("PIIRecordStoredFromProfile")
  const sensitive = await run(decryptSensitiveData(state))
  expect(sensitive.personalIdentity?.fullName?.firstName).toBe("Grace")
})

it("StoreExtractedPII rejects storage keys that do not match the entity reference", async () => {
  const actorId = makeUuid(111)
  const reference = makeReference(12)
  const result = await run(Effect.either(handle(initialPIIState, new StoreExtractedPII({
    storageKey: "profile:pii:custom",
    recordId: makeUuid(121),
    schemaVersion: "1.0.0",
    entityReference: reference,
    jurisdiction: makeJurisdiction(),
    piiJson: JSON.stringify(Schema.encodeSync(SensitivePIIData)(makeSensitive("Grace"))),
    consent: makeConsent(),
    actorId: actorId,
    summary: "ingest PersonalDataExtracted"
  }))))

  expect(result._tag).toBe("Left")
  if (result._tag === "Left") {
    expect(result.left).toBeInstanceOf(PIIError)
  }
})

it("PatchPIIRecord updates encrypted payload without exposing plaintext in state", async () => {
  const actorId = makeUuid(12)
  const record = makeRecord(makeUuid(22), actorId)
  const created = await run(handle(initialPIIState, new CreatePIIRecord({
    record,
    actorId: actorId,
    summary: "create"
  })))

  const patched = await run(handle(created.state, new PatchPIIRecord({
    storageKey: created.state.storageKey,
    personalData: makeSensitive("Katherine"),
    actorId: actorId,
    reason: "user requested update"
  })))

  expect(patched.state.encryptedPayload.encryptedData).not.toContain("Katherine")
  const sensitive = await run(decryptSensitiveData(patched.state))
  expect(sensitive.personalIdentity?.fullName?.firstName).toBe("Katherine")
})

it("consent withdrawal and erasure follow the PII lifecycle", async () => {
  const actorId = makeUuid(13)
  const record = makeRecord(makeUuid(23), actorId)
  const created = await run(handle(initialPIIState, new CreatePIIRecord({
    record,
    actorId: actorId,
    summary: "create"
  })))
  const consentUpdated = await run(handle(created.state, new UpdatePIIConsent({
    storageKey: created.state.storageKey,
    given: true,
    purposes: ["PROFILE_MATCHING", "COMMUNICATION"],
    consentVersion: "2.0",
    actorId: actorId
  })))
  const withdrawn = await run(handle(consentUpdated.state, new WithdrawPIIConsent({
    storageKey: created.state.storageKey,
    reason: "user withdrawal",
    retainForLegal: false,
    actorId: actorId
  })))
  const erasureRequested = await run(handle(withdrawn.state, new RequestPIIErasure({
    storageKey: created.state.storageKey,
    requestId: makeUuid(77),
    reason: "right to be forgotten",
    immediate: false,
    actorId: actorId
  })))
  const erased = await run(handle(erasureRequested.state, new CompletePIIErasure({
    storageKey: created.state.storageKey,
    requestId: makeUuid(77),
    actorId: actorId
  })))

  expect(withdrawn.state.consent.given).toBe(false)
  expect(erasureRequested.state.status).toBe("PENDING_DELETION")
  expect(erased.state.status).toBe("DELETED")
  expect(erased.state.encryptedPayload.encryptedData).toBe("")
  expect(erased.events[0]?._tag).toBe("PIIErasureCompleted")
  if (erased.events[0]?._tag === "PIIErasureCompleted") {
    expect(erased.events[0].deletedPayloadUri).toBe(`s3://n2-pii-payloads/${created.state.storageKey}/payload.enc`)
  }
  const repeated = await run(handle(erased.state, new CompletePIIErasure({
    storageKey: created.state.storageKey,
    requestId: makeUuid(77),
    actorId: actorId
  })).pipe(Effect.flip))
  expect(repeated).toEqual(new PIIError({ message: "PII record is deleted" }))
  expect(storedObjects.has(storedObjectKey("n2-pii-payloads", `${created.state.storageKey}/payload.enc`))).toBe(true)
})

it("RotatePIIKey increments key version and preserves decryptability", async () => {
  const actorId = makeUuid(14)
  const record = makeRecord(makeUuid(24), actorId)
  const created = await run(handle(initialPIIState, new CreatePIIRecord({
    record,
    actorId: actorId,
    summary: "create"
  })))
  const rotated = await run(handle(created.state, new RotatePIIKey({
    storageKey: created.state.storageKey,
    reason: "scheduled rotation",
    actorId: actorId
  })))

  expect(rotated.state.encryptedPayload.encryption.keyVersion).toBe(2)
  const sensitive = await run(decryptSensitiveData(rotated.state))
  expect(sensitive.personalIdentity?.fullName?.firstName).toBe("Ada")
})

it("commands fail when the record does not exist", async () => {
  const result = await run(Effect.either(handle(initialPIIState, new PatchPIIRecord({
    storageKey: "missing",
    personalData: makeSensitive("Missing"),
    actorId: makeUuid(15),
    reason: "missing"
  }))))

  expect(result._tag).toBe("Left")
  if (result._tag === "Left") {
    expect(result.left).toBeInstanceOf(PIIError)
  }
})

it("read commands are handled by entity overrides", async () => {
  const events = await run(handle(initialPIIState, new GetPIIRecord({
    storageKey: "anything",
    actorId: makeUuid(99),
    actorType: "USER",
    purpose: "test read"
  })).pipe(Effect.map((result) => result.events)))

  expect(events).toEqual([])
})
