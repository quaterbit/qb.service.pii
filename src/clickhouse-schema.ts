import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ClickhouseClient from "@effect/sql-clickhouse/ClickhouseClient"

const createProjectionEventsTable = Effect.gen(function* () {
  const clickhouse = yield* ClickhouseClient.ClickhouseClient
  yield* clickhouse.asCommand(clickhouse`
    CREATE TABLE IF NOT EXISTS pii_provider_projection_events (
      storage_key String,
      record_id String,
      revision UInt64,
      event_type String,
      occurred_at String,
      actor_id String,
      status String,
      summary String,
      metadata_json String
    )
    ENGINE = ReplacingMergeTree(revision)
    ORDER BY (storage_key, revision, event_type)
  `)
})

const createRecordsCurrentTable = Effect.gen(function* () {
  const clickhouse = yield* ClickhouseClient.ClickhouseClient
  yield* clickhouse.asCommand(clickhouse`
    CREATE TABLE IF NOT EXISTS pii_provider_records_current (
      storage_key String,
      record_id String,
      revision UInt64,
      status String,
      schema_version String,
      entity_id String,
      entity_type String,
      entity_version UInt64,
      jurisdiction_json String,
      consent_json String,
      subject_requests_json String,
      retention_json String,
      audit_json String,
      extraction_info_json String,
      created_at String,
      updated_at String
    )
    ENGINE = ReplacingMergeTree(revision)
    ORDER BY (storage_key, revision)
  `)
})

const createAuditEventsTable = Effect.gen(function* () {
  const clickhouse = yield* ClickhouseClient.ClickhouseClient
  yield* clickhouse.asCommand(clickhouse`
    CREATE TABLE IF NOT EXISTS pii_provider_audit_events (
      storage_key String,
      record_id String,
      revision UInt64,
      action String,
      actor_id String,
      actor_type String,
      accessed_at String,
      success UInt8,
      purpose String,
      failure_reason String,
      payload_json String
    )
    ENGINE = MergeTree
    ORDER BY (storage_key, accessed_at, revision)
  `)
})

export const PIIProviderClickhouseBootstrapLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* createProjectionEventsTable
    yield* createRecordsCurrentTable
    yield* createAuditEventsTable
  })
)

export const resetPIIProviderClickhouseTables = Effect.gen(function* () {
  const clickhouse = yield* ClickhouseClient.ClickhouseClient
  yield* clickhouse.asCommand(clickhouse`DROP TABLE IF EXISTS pii_provider_projection_events`)
  yield* clickhouse.asCommand(clickhouse`DROP TABLE IF EXISTS pii_provider_records_current`)
  yield* clickhouse.asCommand(clickhouse`DROP TABLE IF EXISTS pii_provider_audit_events`)
  yield* createProjectionEventsTable
  yield* createRecordsCurrentTable
  yield* createAuditEventsTable
})
