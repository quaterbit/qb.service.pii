import * as EventLogApi from "@effect/experimental/EventLog"
import { PIIProviderEvents } from "./contracts/events.js"

export const PIIProviderEventGroup = PIIProviderEvents.toEventGroup((p) => p.storageKey)

export const PIIProviderEventLogSchema = EventLogApi.schema(PIIProviderEventGroup)
