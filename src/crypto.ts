import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as DateTime from "effect/DateTime"
import * as Redacted from "effect/Redacted"
import {
  EncryptedPayload,
  EncryptionInfo,
  type EncryptionAlgorithm
} from "./contracts/common.js"

type EncryptedInput = {
  readonly storageKey: string
  readonly encryptedData: string
  readonly encryptedDek: string
  readonly encryption: EncryptionInfo
}

type EncryptInput = {
  readonly storageKey: string
  readonly plaintextJson: string
  readonly algorithm?: EncryptionAlgorithm
  readonly keyVersion?: number
  readonly encryptedAt?: DateTime.Utc
}

const LOCAL_KEY_ID = "local-pii-master-key"
const LOCAL_MASTER_SECRET = Redacted.make("n2-local-pii-master-key")

type MasterSecret = Redacted.Redacted<string>

const isLocalEnvironment = () => {
  const deployment = process.env.DEPLOYMENT_ENVIRONMENT?.trim().toLowerCase()
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase()
  if (deployment !== undefined) {
    return deployment === "local" || deployment === "development" || deployment === "test"
  }
  return nodeEnv === "development" || nodeEnv === "test" || process.env.VITEST !== undefined
}

const masterSecret = () => {
  const configured = process.env.PII_MASTER_KEY?.trim()
  if (configured !== undefined && configured.length > 0) return Redacted.make(configured)
  if (isLocalEnvironment()) return LOCAL_MASTER_SECRET
  throw new Error("PII_MASTER_KEY is required outside local/test environments")
}

const masterKey = (secret: MasterSecret) => createHash("sha256").update(Redacted.value(secret)).digest()

const encodeSealed = (iv: Buffer, tag: Buffer, ciphertext: Buffer) =>
  `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`

const decodeSealed = (sealed: string) => {
  const [iv, tag, ciphertext] = sealed.split(".")
  if (iv === undefined || tag === undefined || ciphertext === undefined) {
    throw new Error("Invalid encrypted payload format")
  }
  return {
    iv: Buffer.from(iv, "base64"),
    tag: Buffer.from(tag, "base64"),
    ciphertext: Buffer.from(ciphertext, "base64")
  }
}

const seal = (key: Buffer, plaintext: Buffer, aad: string) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from(aad))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return encodeSealed(iv, cipher.getAuthTag(), ciphertext)
}

const open = (key: Buffer, sealed: string, aad: string) => {
  const { iv, tag, ciphertext } = decodeSealed(sealed)
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

const encryptLocal = (secret: MasterSecret, input: EncryptInput) => {
  if ((input.algorithm ?? "AES-256-GCM") !== "AES-256-GCM") {
    throw new Error("Local PII crypto supports AES-256-GCM only")
  }

  const dek = randomBytes(32)
  const keyVersion = input.keyVersion ?? 1
  const encryptedAt = input.encryptedAt ?? DateTime.unsafeMake(new Date().toISOString())
  const encryptedData = seal(dek, Buffer.from(input.plaintextJson), `${input.storageKey}:data`)
  const encryptedDek = seal(masterKey(secret), dek, `${input.storageKey}:${LOCAL_KEY_ID}:${keyVersion}`)

  return new EncryptedPayload({
    encryptedData: encryptedData,
    encryptedDek: encryptedDek,
    encryption: new EncryptionInfo({
      keyId: LOCAL_KEY_ID,
      algorithm: "AES-256-GCM",
      keyVersion: keyVersion,
      encryptedAt: encryptedAt
    })
  })
}

const decryptLocal = (secret: MasterSecret, input: EncryptedInput) => {
  if (input.encryption.algorithm !== "AES-256-GCM") {
    throw new Error("Local PII crypto supports AES-256-GCM only")
  }
  const dek = open(
    masterKey(secret),
    input.encryptedDek,
    `${input.storageKey}:${input.encryption.keyId}:${input.encryption.keyVersion ?? 1}`
  )
  return open(dek, input.encryptedData, `${input.storageKey}:data`).toString("utf8")
}

export class PIICrypto extends Context.Tag("PIICrypto")<
  PIICrypto,
  {
    readonly encrypt: (input: EncryptInput) => Effect.Effect<EncryptedPayload, unknown>
    readonly decrypt: (input: EncryptedInput) => Effect.Effect<string, unknown>
    readonly rotate: (input: EncryptedInput) => Effect.Effect<EncryptedPayload, unknown>
  }
>() {}

export const PIICryptoLive = Layer.effect(
  PIICrypto,
  Effect.sync(() => {
    const secret = masterSecret()
    return {
      encrypt: (input) =>
        Effect.try({
          try: () => encryptLocal(secret, input),
          catch: (cause) => cause
        }),
      decrypt: (input) =>
        Effect.try({
          try: () => decryptLocal(secret, input),
          catch: (cause) => cause
        }),
      rotate: (input) =>
        Effect.try({
          try: () => {
            const plaintextJson = decryptLocal(secret, input)
            return encryptLocal(secret, {
              storageKey: input.storageKey,
              plaintextJson,
              keyVersion: (input.encryption.keyVersion ?? 1) + 1
            })
          },
          catch: (cause) => cause
        })
    }
  })
)
