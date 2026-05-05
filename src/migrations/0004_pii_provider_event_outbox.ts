import { SqlClient } from "@effect/sql/SqlClient"
import * as Effect from "effect/Effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS pii_provider_event_outbox (
      id              TEXT PRIMARY KEY,
      payload_json    TEXT NOT NULL,
      status          TEXT NOT NULL,
      retry_count     INTEGER NOT NULL,
      last_error      TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      published_at    TEXT NOT NULL,
      next_attempt_at TEXT NOT NULL
    )
  `
})
