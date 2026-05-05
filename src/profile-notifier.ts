import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { makeFetchClient } from "@semyenov/n2/helpers"
import { ProfileProviderRpcs } from "../../profile-provider/src/contracts/commands.js"
import type { PIIErasureCompleted } from "./contracts/events.js"

export type PIIErasureCompletedNotification = Pick<
  PIIErasureCompleted,
  "storageKey" | "recordId" | "actorId"
>

type StorageKeyReference = {
  readonly entityType: "AGGREGATE" | "SNAPSHOT"
  readonly entityId: string
}

const parseStorageKeyReference = (storageKey: string): StorageKeyReference | undefined => {
  const [entityType, entityId] = storageKey.split(":")
  if (entityId === undefined) return undefined
  if (entityType === "aggregate") return { entityType: "AGGREGATE", entityId }
  if (entityType === "snapshot") return { entityType: "SNAPSHOT", entityId }
  return undefined
}

export class ProfilePiiReferenceNotifier extends Context.Tag("ProfilePiiReferenceNotifier")<
  ProfilePiiReferenceNotifier,
  {
    readonly forgetPiiReference: (event: PIIErasureCompletedNotification) => Effect.Effect<void, unknown>
  }
>() {}

export const ProfilePiiReferenceNotifierLive = Layer.effect(
  ProfilePiiReferenceNotifier,
  Effect.sync(() => {
    const baseUrl = process.env.PROFILE_PROVIDER_BASE_URL?.trim() || "http://127.0.0.1:4100"
    const client = makeFetchClient(ProfileProviderRpcs, `${baseUrl}/rpc/profile-provider`)

    return {
      forgetPiiReference: (event) => {
        const reference = parseStorageKeyReference(event.storageKey)
        if (reference === undefined) return Effect.void

        return Effect.tryPromise({
          try: async () => {
            await client.ForgetProfilePiiReference({
              profileId: reference.entityId,
              piiStorageKey: event.storageKey,
              reason: `PII erasure completed for ${event.recordId}`,
              actorId: event.actorId
            })
          },
          catch: (cause) => cause
        }).pipe(Effect.asVoid)
      }
    }
  })
)

export const ProfilePiiReferenceNotifierNoop = Layer.succeed(
  ProfilePiiReferenceNotifier,
  { forgetPiiReference: () => Effect.void }
)
