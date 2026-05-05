import { SqlClient } from "@effect/sql/SqlClient"
import * as Effect from "effect/Effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS pii_provider_subject_requests (
      request_id    TEXT PRIMARY KEY,
      storage_key   TEXT NOT NULL,
      record_id     TEXT NOT NULL,
      request_type  TEXT NOT NULL,
      status        TEXT NOT NULL,
      requested_at  TEXT NOT NULL,
      completed_at  TEXT NOT NULL,
      notes         TEXT NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE IF NOT EXISTS pii_provider_audit_log (
      id             TEXT PRIMARY KEY,
      storage_key    TEXT NOT NULL,
      record_id      TEXT NOT NULL,
      action         TEXT NOT NULL,
      actor_id       TEXT NOT NULL,
      actor_type     TEXT NOT NULL,
      ip_address     TEXT NOT NULL,
      user_agent     TEXT NOT NULL,
      accessed_at    TEXT NOT NULL,
      success        BOOLEAN NOT NULL,
      failure_reason TEXT NOT NULL,
      purpose        TEXT NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE IF NOT EXISTS pii_provider_retention_policies (
      id                TEXT PRIMARY KEY,
      jurisdiction      TEXT NOT NULL,
      policy_name       TEXT NOT NULL,
      retention_days    INTEGER NOT NULL,
      grace_period_days INTEGER NOT NULL,
      is_default        BOOLEAN NOT NULL
    )
  `
})
