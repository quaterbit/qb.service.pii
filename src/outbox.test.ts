import { it, expect } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { WorkflowEngine } from "@effect/workflow"
import type { OutboxEntry } from "@semyenov/n2/helpers"
import {
  drainPIIProviderOutboxOnce,
  PIIProviderOutbox
} from "./outbox.js"
import {
  makePIIProviderEventMessage,
  PIIProviderEventMessage,
  PIIProviderEventPublishHandlers,
  PIIProviderEventPublisher
} from "./workflows.js"

const makeRecordId = (seed: number) =>
  `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`

const makeEntry = (seed: number): OutboxEntry<PIIProviderEventMessage> => {
  const message = makePIIProviderEventMessage({
    recordId: makeRecordId(seed),
    revision: seed,
    eventType: "PIIRecordCreated",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { seed }
  })

  return {
    id: message.id,
    message,
    retryCount: 0
  }
}

it.scopedLive("outbox drain dispatches claimed events and marks them dispatched", () =>
  Effect.gen(function* () {
    const entry = makeEntry(1)
    const dispatched: Array<string> = []
    const published: Array<string> = []

    const layer = Layer.mergeAll(
      Layer.provideMerge(PIIProviderEventPublishHandlers, WorkflowEngine.layerMemory),
      Layer.succeed(PIIProviderEventPublisher, {
        publish: (message) =>
          Effect.sync(() => {
            published.push(message.id)
          })
      }),
      Layer.succeed(PIIProviderOutbox, {
        enqueue: (_message) => Effect.void,
        claimPending: (_limit) => Effect.succeed([entry]),
        markDispatched: (id) =>
          Effect.sync(() => {
            dispatched.push(id)
          }),
        markFailed: (_id, _retryCount, _error) => Effect.void,
        markDeadLetter: (_id, _error) => Effect.void
      })
    )

    const result = yield* drainPIIProviderOutboxOnce.pipe(
      Effect.provide(layer)
    )

    expect(result).toBe(true)
    expect(published).toEqual([entry.id])
    expect(dispatched).toEqual([entry.id])
  }))

it.scopedLive("outbox drain marks failures when workflow execution cannot start", () =>
  Effect.gen(function* () {
    const entry = makeEntry(2)
    const failures: Array<{ id: string; retryCount: number; error: string }> = []

    const layer = Layer.succeed(PIIProviderOutbox, {
      enqueue: (_message) => Effect.void,
      claimPending: (_limit) => Effect.succeed([entry]),
      markDispatched: (_id) => Effect.void,
      markFailed: (id, retryCount, error) =>
        Effect.sync(() => {
          failures.push({ id, retryCount, error })
        }),
      markDeadLetter: (_id, _error) => Effect.void
    })

    const result = yield* (drainPIIProviderOutboxOnce.pipe(
      Effect.provide(layer)
    ) as unknown as Effect.Effect<boolean, never, Scope.Scope>)

    expect(result).toBe(true)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.id).toBe(entry.id)
    expect(failures[0]?.retryCount).toBe(1)
  }))

it.scopedLive("outbox drain reports no work when queue is empty", () =>
  Effect.gen(function* () {
    const layer = Layer.mergeAll(
      Layer.provideMerge(PIIProviderEventPublishHandlers, WorkflowEngine.layerMemory),
      Layer.succeed(PIIProviderEventPublisher, {
        publish: (_message) => Effect.void
      }),
      Layer.succeed(PIIProviderOutbox, {
        enqueue: (_message) => Effect.void,
        claimPending: (_limit) => Effect.succeed([]),
        markDispatched: (_id) => Effect.void,
        markFailed: (_id, _retryCount, _error) => Effect.void,
        markDeadLetter: (_id, _error) => Effect.void
      })
    )

    const result = yield* drainPIIProviderOutboxOnce.pipe(
      Effect.provide(layer)
    )

    expect(result).toBe(false)
  }))
