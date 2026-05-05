import { makeProjectionLayer } from "@semyenov/n2/helpers"
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
import { PIIProviderEventGroup } from "./events.js"
import { PIIProviderOutbox } from "./outbox.js"
import { PIIProviderProjectionStore } from "./projection-store.js"
import { makePIIProviderEventMessage } from "./workflows.js"

const makeMessage = (event: PIIProviderEvent) =>
  makePIIProviderEventMessage({
    recordId: event.recordId,
    revision: event.revision,
    eventType: event._tag,
    occurredAt: String(event.occurredAt.toJSON()),
    payload: event
  })

export const PIIProviderProjectionLayer = makeProjectionLayer({
  group: PIIProviderEventGroup,
  storeTag: PIIProviderProjectionStore,
  outboxTag: PIIProviderOutbox,
  makeMessage,
  handlers: {
    PIIRecordCreated: { event: PIIRecordCreated, storeMethod: "onPIIRecordCreated" },
    PIIRecordStoredFromProfile: { event: PIIRecordStoredFromProfile, storeMethod: "onPIIRecordStoredFromProfile" },
    PIIRecordUpdated: { event: PIIRecordUpdated, storeMethod: "onPIIRecordUpdated" },
    PIIConsentUpdated: { event: PIIConsentUpdated, storeMethod: "onPIIConsentUpdated" },
    PIIConsentWithdrawn: { event: PIIConsentWithdrawn, storeMethod: "onPIIConsentWithdrawn" },
    PIISubjectRequestCreated: { event: PIISubjectRequestCreated, storeMethod: "onPIISubjectRequestCreated" },
    PIISubjectRequestCompleted: { event: PIISubjectRequestCompleted, storeMethod: "onPIISubjectRequestCompleted" },
    PIIErasureRequested: { event: PIIErasureRequested, storeMethod: "onPIIErasureRequested" },
    PIIErasureCompleted: { event: PIIErasureCompleted, storeMethod: "onPIIErasureCompleted" },
    PIIKeyRotated: { event: PIIKeyRotated, storeMethod: "onPIIKeyRotated" },
    PIIRecordAccessed: { event: PIIRecordAccessed, storeMethod: "onPIIRecordAccessed" }
  }
})
