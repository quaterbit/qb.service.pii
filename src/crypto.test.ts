import { it, expect } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import { PIICrypto, PIICryptoLive } from "./crypto.js"

const withEnv = async <A>(env: Record<string, string>, run: () => Promise<A>) => {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key])
    process.env[key] = env[key]
  }
  try {
    return await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

it("PIICryptoLive uses a configured redacted master key for encrypt, decrypt, and rotate", async () => {
  await withEnv({
    DEPLOYMENT_ENVIRONMENT: "production",
    PII_MASTER_KEY: "production-test-master-key"
  }, async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const crypto = yield* PIICrypto
        const encrypted = yield* crypto.encrypt({
          storageKey: "aggregate:00000000-0000-4000-8000-000000000001:1",
          plaintextJson: "{\"name\":\"Ada\"}",
          encryptedAt: DateTime.unsafeMake("2026-01-01T00:00:00.000Z")
        })
        const decrypted = yield* crypto.decrypt({
          storageKey: "aggregate:00000000-0000-4000-8000-000000000001:1",
          encryptedData: encrypted.encryptedData,
          encryptedDek: encrypted.encryptedDek,
          encryption: encrypted.encryption
        })
        const rotated = yield* crypto.rotate({
          storageKey: "aggregate:00000000-0000-4000-8000-000000000001:1",
          encryptedData: encrypted.encryptedData,
          encryptedDek: encrypted.encryptedDek,
          encryption: encrypted.encryption
        })
        const rotatedPlaintext = yield* crypto.decrypt({
          storageKey: "aggregate:00000000-0000-4000-8000-000000000001:1",
          encryptedData: rotated.encryptedData,
          encryptedDek: rotated.encryptedDek,
          encryption: rotated.encryption
        })
        return { encrypted, decrypted, rotated, rotatedPlaintext }
      }).pipe(Effect.provide(PIICryptoLive))
    )

    expect(result.encrypted.encryptedData).not.toContain("Ada")
    expect(result.decrypted).toBe("{\"name\":\"Ada\"}")
    expect(result.rotated.encryption.keyVersion).toBe(2)
    expect(result.rotatedPlaintext).toBe("{\"name\":\"Ada\"}")
  })
})
