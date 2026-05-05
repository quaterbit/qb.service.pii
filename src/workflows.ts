import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  computeRetryDelaySeconds,
  makeEventMessageFactory,
  makeEventMessageFields,
  makePublishWorkflow
} from "@semyenov/n2/helpers"
import { ObjectStorage, parseObjectUri, type ObjectStorageError } from "@semyenov/n2-service-shared/object-storage"
import { ProfilePiiReferenceNotifier, type PIIErasureCompletedNotification } from "./profile-notifier.js"

const TOPIC = "pii-provider.events"

type PIIErasureCompletedPayload = PIIErasureCompletedNotification & {
  readonly _tag: "PIIErasureCompleted"
  readonly deletedPayloadUri?: string
}

const erasureCompletedPayload = (payload: unknown): PIIErasureCompletedPayload | undefined => {
  if (typeof payload !== "object" || payload === null) return undefined
  const event = payload as Partial<PIIErasureCompletedPayload>
  return event._tag === "PIIErasureCompleted" &&
    typeof event.storageKey === "string" &&
    typeof event.recordId === "string" &&
    typeof event.actorId === "string"
    ? event as PIIErasureCompletedPayload
    : undefined
}

const isIdempotentMissingObjectDelete = (error: ObjectStorageError) => {
  const message = error.message.toLowerCase()
  return message.includes("not found") ||
    message.includes("nosuchkey") ||
    message.includes("no such key") ||
    message.includes("specified key does not exist")
}

export class PIIProviderEventMessage extends Schema.Class<PIIProviderEventMessage>("PIIProviderEventMessage")({
  ...makeEventMessageFields("recordId")
}) {}

export class PIIProviderEventPublisher extends Context.Tag("PIIProviderEventPublisher")<
  PIIProviderEventPublisher,
  {
    readonly publish: (message: PIIProviderEventMessage) => Effect.Effect<void, unknown>
  }
>() {}

export { computeRetryDelaySeconds }

export const makePIIProviderEventMessage = makeEventMessageFactory({
  topic: TOPIC,
  entityIdKey: "recordId",
  schema: PIIProviderEventMessage
})

const publishWorkflow = makePublishWorkflow({
  name: "PIIEventPublish",
  messageSchema: PIIProviderEventMessage,
  publisherTag: PIIProviderEventPublisher,
  idOf: (message) => message.id
})

export const PIIEventPublishWorkflow = publishWorkflow.workflow
export const startPIIEventPublish = publishWorkflow.start
export const PIIProviderEventPublishHandlers = publishWorkflow.handlers

export const PIIProviderEventPublisherLive = Layer.effect(
  PIIProviderEventPublisher,
  Effect.gen(function* () {
    const storage = yield* ObjectStorage
    const notifier = yield* ProfilePiiReferenceNotifier

    const deletePayloadObject = (deletedPayloadUri: string | undefined) => {
      if (deletedPayloadUri === undefined || deletedPayloadUri.length === 0) return Effect.void
      const reference = parseObjectUri(deletedPayloadUri)
      if (reference === undefined) return Effect.void
      return storage.deleteObject(reference).pipe(
        Effect.catchAll((error) =>
          isIdempotentMissingObjectDelete(error)
            ? Effect.void
            : Effect.logWarning(`[pii-provider] encrypted payload delete failed: ${String(error)}`).pipe(
                Effect.zipRight(Effect.fail(error))
              )
        )
      )
    }

    return {
      publish: (message) => {
        const erasure = erasureCompletedPayload(message.payload)
        return Effect.logInfo("[pii-provider] event published").pipe(
          Effect.annotateLogs({
            eventMessageId: message.id,
            topic: message.topic,
            partitionKey: message.partitionKey,
            payloadSize: JSON.stringify(message.payload).length
          }),
          Effect.zipRight(
            erasure === undefined
              ? Effect.void
              : deletePayloadObject(erasure.deletedPayloadUri).pipe(
                  Effect.zipRight(notifier.forgetPiiReference(erasure))
                )
          )
        )
      }
    }
  })
)
