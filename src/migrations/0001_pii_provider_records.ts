import { SqlClient } from "@effect/sql/SqlClient"
import * as Effect from "effect/Effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS pii_provider_records (
      storage_key          TEXT PRIMARY KEY,
      record_id            TEXT NOT NULL,
      status               TEXT NOT NULL,
      revision             INTEGER NOT NULL,
      schema_version       TEXT NOT NULL,
      entity_id            TEXT NOT NULL,
      entity_type          TEXT NOT NULL,
      entity_version       INTEGER NOT NULL,
      jurisdiction_json    TEXT NOT NULL,
      encrypted_data       TEXT NOT NULL,
      encrypted_dek        TEXT NOT NULL,
      encryption_json      TEXT NOT NULL,
      consent_json         TEXT NOT NULL,
      retention_json       TEXT NOT NULL,
      audit_json           TEXT NOT NULL,
      extraction_info_json TEXT NOT NULL,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    )
  `
})
