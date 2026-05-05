import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { EntityProxy, EntityProxyServer } from "@effect/cluster"
import {
  makeToError,
  makeWriteThroughAfterCommitPublisher
} from "@semyenov/n2/helpers"
import {
  PIIProvider,
  decryptSensitiveData,
  toCommandResult,
  toPIIRecordDocument
} from "./aggregate.js"
import { InfrastructureLayer } from "./layers.js"
import { PIIProviderEventGroup } from "./events.js"
import type { PIIProviderEvent } from "./contracts/events.js"
import {
  type PIIProviderCommand,
  PIIProviderEntity,
  PIIProviderRpcs,
  RecordPIIAccess,
  storageKeyOfCommand
} from "./contracts/commands.js"
import { PIIAuditLog, storageKeyFromEntityReference } from "./contracts/common.js"
import { PIIError, PIINotFound } from "./contracts/errors.js"
import { PIIHistory, type PIIState } from "./contracts/state.js"
import { PIIProviderOutbox } from "./outbox.js"
import { PIIProviderProjectionStore } from "./projection-store.js"
import { PIIProviderAggregateSnapshotOps } from "./snapshots.js"
import { makePIIProviderEventMessage } from "./workflows.js"

const toHistory = (state: PIIState) =>
  new PIIHistory({
    storageKey: state.storageKey,
    recordId: state.recordId,
    currentRevision: state.revision,
    status: state.status,
    requests: state.dataSubjectRequests,
    auditEntries: state.auditEntries,
    revisions: state.revisions
  })

type ReadAuditCommand = Extract<PIIProviderCommand, {
  readonly _tag: "GetPIIRecord" | "GetPIIRecordByEntity"
}>

type OverrideContext = {
  readonly getState: (entityId: string) => Effect.Effect<PIIState, never, unknown>
  readonly commit: (command: PIIProviderCommand) => Effect.Effect<{
    readonly state: PIIState
  }, unknown, unknown>
}

const ensureReadableState = (storageKey: string, state: PIIState) =>
  state.status === "empty" || state.status === "DELETED"
    ? Effect.fail(new PIINotFound({ storageKey }))
    : Effect.succeed(state)

const recordReadAccess = (
  storageKey: string,
  command: ReadAuditCommand,
  ctx: OverrideContext,
  input: { readonly success: boolean; readonly failureReason?: string }
) =>
  ctx.commit(new RecordPIIAccess({
    storageKey,
    actorId: command.actorId,
    actorType: command.actorType,
    purpose: command.purpose,
    ipAddress: command.ipAddress,
    userAgent: command.userAgent,
    success: input.success,
    failureReason: input.failureReason
  })).pipe(
    Effect.map((result) => result.state)
  )

const getRecord = (
  storageKey: string,
  command: ReadAuditCommand,
  ctx: OverrideContext
) =>
  Effect.gen(function* () {
    const state = yield* ctx.getState(storageKey).pipe(
      Effect.flatMap((current) => ensureReadableState(storageKey, current))
    )
    const sensitiveData = yield* decryptSensitiveData(state).pipe(
      Effect.catchAll((error) =>
        recordReadAccess(storageKey, command, ctx, {
          success: false,
          failureReason: error.message
        }).pipe(
          Effect.zipRight(Effect.fail(error))
        )
      )
    )
    const auditedState = yield* recordReadAccess(storageKey, command, ctx, { success: true })
    return toPIIRecordDocument(auditedState, sensitiveData)
  })

const overrides = {
  GetPIIRecord: (command: Extract<PIIProviderCommand, { readonly _tag: "GetPIIRecord" }>, ctx: {
    readonly getState: (entityId: string) => Effect.Effect<PIIState, never, unknown>
    readonly commit: (command: PIIProviderCommand) => Effect.Effect<{ readonly state: PIIState }, unknown, unknown>
  }) => getRecord(command.storageKey, command, ctx),

  GetPIIRecordByEntity: (command: Extract<PIIProviderCommand, { readonly _tag: "GetPIIRecordByEntity" }>, ctx: {
    readonly getState: (entityId: string) => Effect.Effect<PIIState, never, unknown>
    readonly commit: (command: PIIProviderCommand) => Effect.Effect<{ readonly state: PIIState }, unknown, unknown>
  }) => getRecord(storageKeyFromEntityReference(command.entityReference), command, ctx),

  GetPIIHistory: (command: Extract<PIIProviderCommand, { readonly _tag: "GetPIIHistory" }>, ctx: {
    readonly getState: (entityId: string) => Effect.Effect<PIIState, never, unknown>
  }) =>
    ctx.getState(command.storageKey).pipe(
      Effect.flatMap((state) =>
        state.status === "empty"
          ? Effect.fail(new PIINotFound({ storageKey: command.storageKey }))
          : Effect.succeed(toHistory(state))
      )
    ),

  GetPIIAuditLog: (command: Extract<PIIProviderCommand, { readonly _tag: "GetPIIAuditLog" }>, ctx: {
    readonly getState: (entityId: string) => Effect.Effect<PIIState, never, unknown>
  }) =>
    ctx.getState(command.storageKey).pipe(
      Effect.flatMap((state) =>
        state.status === "empty"
          ? Effect.fail(new PIINotFound({ storageKey: command.storageKey }))
          : Effect.succeed(new PIIAuditLog({
              storageKey: command.storageKey,
              auditEntries: state.auditEntries,
              total: state.auditEntries.length
            }))
      )
    )
}

const toError = makeToError(PIIError)

const afterCommit = makeWriteThroughAfterCommitPublisher({
  group: PIIProviderEventGroup,
  storeTag: PIIProviderProjectionStore,
  outboxTag: PIIProviderOutbox,
  makeMessage: (event: PIIProviderEvent) =>
    makePIIProviderEventMessage({
      recordId: event.recordId,
      revision: event.revision,
      eventType: event._tag,
      occurredAt: String(event.occurredAt.toJSON()),
      payload: event
    }),
  logPrefix: "[pii-provider]"
})

export const PIIProviderEntityLayer = PIIProvider.toEntityLayer(
  PIIProviderEntity,
  {
    toResult: ({ entityId, state }) => toCommandResult(entityId, state),
    toError,
    snapshots: PIIProviderAggregateSnapshotOps,
    afterCommit,
    overrides
  },
  { maxIdleTime: "10 minutes", concurrency: "unbounded" }
)

export const PIIProviderProxyRpcs = EntityProxy.toRpcGroup(PIIProviderEntity)
export const PIIProviderProxyHandlers = EntityProxyServer.layerRpcHandlers(PIIProviderEntity)

export const PIIProviderHandlersRaw = PIIProvider.toStatefulRpcHandlers(
  PIIProviderRpcs,
  {
    entityId: (command) => storageKeyOfCommand(command),
    toResult: ({ entityId, state }) => toCommandResult(entityId, state),
    toError,
    snapshots: PIIProviderAggregateSnapshotOps,
    afterCommit,
    metrics: { prefix: "pii_provider" },
    overrides
  }
)

export const PIIProviderHandlers = Layer.provide(PIIProviderHandlersRaw, InfrastructureLayer)
