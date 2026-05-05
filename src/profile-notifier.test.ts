import { it, expect } from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
  ProfilePiiReferenceNotifier,
  ProfilePiiReferenceNotifierLive
} from "./profile-notifier.js"

const makeId = (seed: number) =>
  `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`

it("ProfilePiiReferenceNotifierLive ignores unsupported storage key formats", async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = Object.assign(
    async () => {
      calls += 1
      return new Response(JSON.stringify([{ result: {} }]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    },
    { preconnect: originalFetch.preconnect }
  )

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const notifier = yield* ProfilePiiReferenceNotifier
        yield* notifier.forgetPiiReference({
          storageKey: `unsupported:${makeId(1)}:1`,
          recordId: makeId(2),
          actorId: makeId(3)
        })
      }).pipe(Effect.provide(ProfilePiiReferenceNotifierLive))
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  expect(calls).toBe(0)
})
