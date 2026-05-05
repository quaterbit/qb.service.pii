import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import { BunRuntime } from "@effect/platform-bun"
import * as EventJournalApi from "@effect/experimental/EventJournal"
import {
  makeEventDecoder,
  makeReplayProgram,
  makeReplayTool,
  parseReplayOptions,
  type ReplayOptions
} from "@semyenov/n2/helpers"
import { makeReplayInfrastructureLayer } from "@semyenov/n2/runtime"
import {
  PIIConsentUpdated,
  PIIConsentWithdrawn,
  PIIErasureCompleted,
  PIIErasureRequested,
  PIIKeyRotated,
  PIIRecordAccessed,
  PIIRecordCreated,
  PIIRecordStoredFromProfile,
  PIIRecordUpdated,
  PIISubjectRequestCompleted,
  PIISubjectRequestCreated,
  type PIIProviderEvent
} from "./contracts/events.js"
import { PIIProviderEventJournalTables } from "./event-journal.js"
import { PIIProviderEventGroup } from "./events.js"
import { PIIProviderProjectionStore } from "./projection-store.js"
import {
  PIIProviderProjectionStorePgLive,
  resetPIIProviderPgProjection
} from "./projection-store-pg.js"

const decodeEvent = makeEventDecoder<PIIProviderEvent>(PIIProviderEventGroup, {
  PIIRecordCreated,
  PIIRecordStoredFromProfile,
  PIIRecordUpdated,
  PIIConsentUpdated,
  PIIConsentWithdrawn,
  PIISubjectRequestCreated,
  PIISubjectRequestCompleted,
  PIIErasureRequested,
  PIIErasureCompleted,
  PIIKeyRotated,
  PIIRecordAccessed
})

const dispatchToStore = (event: PIIProviderEvent) =>
  Effect.flatMap(PIIProviderProjectionStore, (store) => store.dispatch(event))

const replay = makeReplayTool({
  decodeEvent,
  entityIdOf: (event) => event.storageKey,
  dispatch: dispatchToStore,
  eventGroup: PIIProviderEventGroup
})

export { parseReplayOptions, type ReplayOptions }
export const toPIIProviderEvent = decodeEvent
export const matchesReplayOptions = replay.matchesOptions
export const collectReplayEvents = replay.collectEvents

const ReplayLayer = makeReplayInfrastructureLayer({
  eventJournal: PIIProviderEventJournalTables,
  projectionStoreLayer: PIIProviderProjectionStorePgLive
})

const program = Effect.gen(function* () {
  const resetFromEnv = yield* Config.boolean("RESET_PROJECTIONS").pipe(Config.withDefault(true))
  yield* makeReplayProgram({
    argv: Bun.argv.slice(2),
    resetDefault: resetFromEnv,
    label: "pii-provider projection",
    entries: Effect.flatMap(EventJournalApi.EventJournal, (journal) => journal.entries),
    decodeEvent,
    entityIdOf: (event) => event.storageKey,
    dispatch: dispatchToStore,
    eventGroup: PIIProviderEventGroup,
    reset: resetPIIProviderPgProjection
  })
})

const main = program.pipe(Effect.provide(ReplayLayer))

if (import.meta.main) {
  BunRuntime.runMain(main)
}
