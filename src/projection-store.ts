import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type { SqlError } from "@effect/sql/SqlError"
import type {
  PIIConsentUpdated,
  PIIConsentWithdrawn,
  PIIErasureCompleted,
  PIIErasureRequested,
  PIIKeyRotated,
  PIIProviderEvent,
  PIIRecordAccessed,
  PIIRecordCreated,
  PIIRecordStoredFromProfile,
  PIIRecordUpdated,
  PIISubjectRequestCompleted,
  PIISubjectRequestCreated
} from "./contracts/events.js"

export interface ProjectionHandlers {
  readonly onPIIRecordCreated: (event: PIIRecordCreated) => Effect.Effect<void, SqlError>
  readonly onPIIRecordStoredFromProfile: (event: PIIRecordStoredFromProfile) => Effect.Effect<void, SqlError>
  readonly onPIIRecordUpdated: (event: PIIRecordUpdated) => Effect.Effect<void, SqlError>
  readonly onPIIConsentUpdated: (event: PIIConsentUpdated) => Effect.Effect<void, SqlError>
  readonly onPIIConsentWithdrawn: (event: PIIConsentWithdrawn) => Effect.Effect<void, SqlError>
  readonly onPIISubjectRequestCreated: (event: PIISubjectRequestCreated) => Effect.Effect<void, SqlError>
  readonly onPIISubjectRequestCompleted: (event: PIISubjectRequestCompleted) => Effect.Effect<void, SqlError>
  readonly onPIIErasureRequested: (event: PIIErasureRequested) => Effect.Effect<void, SqlError>
  readonly onPIIErasureCompleted: (event: PIIErasureCompleted) => Effect.Effect<void, SqlError>
  readonly onPIIKeyRotated: (event: PIIKeyRotated) => Effect.Effect<void, SqlError>
  readonly onPIIRecordAccessed: (event: PIIRecordAccessed) => Effect.Effect<void, SqlError>
  readonly dispatch: (event: PIIProviderEvent) => Effect.Effect<void, SqlError>
}

export const makeDispatch = (handlers: Omit<ProjectionHandlers, "dispatch">) =>
  (event: PIIProviderEvent): Effect.Effect<void, SqlError> => {
    switch (event._tag) {
      case "PIIRecordCreated": return handlers.onPIIRecordCreated(event)
      case "PIIRecordStoredFromProfile": return handlers.onPIIRecordStoredFromProfile(event)
      case "PIIRecordUpdated": return handlers.onPIIRecordUpdated(event)
      case "PIIConsentUpdated": return handlers.onPIIConsentUpdated(event)
      case "PIIConsentWithdrawn": return handlers.onPIIConsentWithdrawn(event)
      case "PIISubjectRequestCreated": return handlers.onPIISubjectRequestCreated(event)
      case "PIISubjectRequestCompleted": return handlers.onPIISubjectRequestCompleted(event)
      case "PIIErasureRequested": return handlers.onPIIErasureRequested(event)
      case "PIIErasureCompleted": return handlers.onPIIErasureCompleted(event)
      case "PIIKeyRotated": return handlers.onPIIKeyRotated(event)
      case "PIIRecordAccessed": return handlers.onPIIRecordAccessed(event)
    }
  }

export class PIIProviderProjectionStore extends Context.Tag("PIIProviderProjectionStore")<
  PIIProviderProjectionStore,
  ProjectionHandlers
>() {}
