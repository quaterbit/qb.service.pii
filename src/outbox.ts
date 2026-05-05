import * as Context from "effect/Context"
import { makeStandardOutboxWiring, type OutboxService } from "@semyenov/n2/helpers"
import {
  PIIProviderEventMessage,
  startPIIEventPublish
} from "./workflows.js"

export class PIIProviderOutbox extends Context.Tag("PIIProviderOutbox")<
  PIIProviderOutbox,
  OutboxService<PIIProviderEventMessage>
>() {}

const outbox = makeStandardOutboxWiring({
  tag: PIIProviderOutbox,
  table: "pii_provider_event_outbox",
  schema: PIIProviderEventMessage,
  publish: (message) => startPIIEventPublish(message),
  metricsPrefix: "pii_provider.outbox",
  idleDelay: "5 seconds"
})

export const PIIProviderOutboxPgLive = outbox.live
export const drainPIIProviderOutboxOnce = outbox.drainOnce
export const PIIProviderOutboxWorkerLive = outbox.workerLive
