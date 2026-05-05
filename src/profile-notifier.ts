import * as Context from "effect/Context"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { makeFetchClient } from "@semyenov/n2/helpers"
import { ProfileProviderRpcs } from "qb.service.profiler/contracts"
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

const optionText = (value: Option.Option<string>) =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (text) => text.trim().toLowerCase()
  })

const isLocalEnvironment = (
  deployment: Option.Option<string>,
  nodeEnv: Option.Option<string>,
  vitest: Option.Option<string>
) => {
  const configuredDeployment = optionText(deployment)
  if (configuredDeployment !== undefined) {
    return configuredDeployment === "local" ||
      configuredDeployment === "development" ||
      configuredDeployment === "test"
  }
  const configuredNodeEnv = optionText(nodeEnv)
  return configuredNodeEnv === "development" ||
    configuredNodeEnv === "test" ||
    Option.isSome(vitest)
}

const readProfileProviderBaseUrl = Effect.gen(function* () {
  const configured = yield* Config.option(Config.string("PROFILE_PROVIDER_BASE_URL"))
  if (Option.isSome(configured) && configured.value.trim().length > 0) {
    return configured.value.trim()
  }

  const deployment = yield* Config.option(Config.string("DEPLOYMENT_ENVIRONMENT"))
  const nodeEnv = yield* Config.option(Config.string("NODE_ENV"))
  const vitest = yield* Config.option(Config.string("VITEST"))

  if (isLocalEnvironment(deployment, nodeEnv, vitest)) return "http://127.0.0.1:4100"
  return yield* Effect.fail(new Error("PROFILE_PROVIDER_BASE_URL is required outside local/test environments"))
})

export class ProfilePiiReferenceNotifier extends Context.Tag("ProfilePiiReferenceNotifier")<
  ProfilePiiReferenceNotifier,
  {
    readonly forgetPiiReference: (event: PIIErasureCompletedNotification) => Effect.Effect<void, unknown>
  }
>() {}

export const ProfilePiiReferenceNotifierLive = Layer.effect(
  ProfilePiiReferenceNotifier,
  Effect.gen(function* () {
    const baseUrl = yield* readProfileProviderBaseUrl
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
