import type { EventJournalTableOptions } from "@semyenov/n2/runtime"

export const PIIProviderEventJournalTables = {
  entryTable: "pii_provider_event_journal",
  remotesTable: "pii_provider_event_remotes"
} as const satisfies EventJournalTableOptions
