import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  ObjectStorage,
  parseObjectUri,
  piiPayloadsBucket
} from "@semyenov/n2-service-shared/object-storage"
import {
  EncryptedPayload,
  SensitivePIIData
} from "./contracts/common.js"
import { PIIError } from "./contracts/errors.js"
import type { PIIState } from "./contracts/state.js"
import { PIICrypto } from "./crypto.js"

const encodeSensitiveData = Schema.encodeSync(SensitivePIIData)
export const decodeSensitiveDataPayload = Schema.decodeUnknown(SensitivePIIData)

export const encryptSensitiveData = (
  storageKey: string,
  sensitiveData: SensitivePIIData
) =>
  Effect.gen(function* () {
    const crypto = yield* PIICrypto
    const storage = yield* ObjectStorage
    const plaintextJson = JSON.stringify(encodeSensitiveData(sensitiveData))
    const encryptedPayload = yield* crypto.encrypt({ storageKey, plaintextJson })
    const bucket = piiPayloadsBucket()
    const key = `${storageKey}/payload.enc`
    const reference = yield* storage.putObject({
      bucket,
      key,
      body: encryptedPayload.encryptedData,
      contentType: "application/octet-stream",
      metadata: { storageKey }
    })
    return new EncryptedPayload({
      ...encryptedPayload,
      encryptedData: reference.uri
    })
  }).pipe(
    Effect.mapError((error) => new PIIError({ message: `PII encryption failed: ${String(error)}` }))
  )

export const decryptSensitiveData = (state: PIIState) =>
  Effect.gen(function* () {
    const crypto = yield* PIICrypto
    const storage = yield* ObjectStorage
    const reference = parseObjectUri(state.encryptedPayload.encryptedData)
    const encryptedData = reference === undefined
      ? state.encryptedPayload.encryptedData
      : Buffer.from(yield* storage.getObject(reference)).toString("utf8")
    const plaintextJson = yield* crypto.decrypt({
      storageKey: state.storageKey,
      encryptedData,
      encryptedDek: state.encryptedPayload.encryptedDek,
      encryption: state.encryptedPayload.encryption
    })
    const parsed = JSON.parse(plaintextJson) as unknown
    return yield* decodeSensitiveDataPayload(parsed)
  }).pipe(
    Effect.mapError((error) => new PIIError({ message: `PII decryption failed: ${String(error)}` }))
  )

export const rotateEncryptedPayload = (state: PIIState) =>
  Effect.gen(function* () {
    const crypto = yield* PIICrypto
    const storage = yield* ObjectStorage
    const reference = parseObjectUri(state.encryptedPayload.encryptedData)
    const encryptedData = reference === undefined
      ? state.encryptedPayload.encryptedData
      : Buffer.from(yield* storage.getObject(reference)).toString("utf8")
    const encryptedPayload = yield* crypto.rotate({
      storageKey: state.storageKey,
      encryptedData,
      encryptedDek: state.encryptedPayload.encryptedDek,
      encryption: state.encryptedPayload.encryption
    })
    const bucket = piiPayloadsBucket()
    const key = `${state.storageKey}/payload.enc`
    const nextReference = yield* storage.putObject({
      bucket,
      key,
      body: encryptedPayload.encryptedData,
      contentType: "application/octet-stream",
      metadata: { storageKey: state.storageKey }
    })
    return new EncryptedPayload({
      ...encryptedPayload,
      encryptedData: nextReference.uri
    })
  }).pipe(
    Effect.mapError((error) => new PIIError({ message: `PII key rotation failed: ${String(error)}` }))
  )
