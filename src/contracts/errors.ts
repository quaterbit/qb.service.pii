import * as Schema from "effect/Schema"
import { PIIStorageKey } from "./common.js"

export class PIIError extends Schema.TaggedError<PIIError>()(
  "PIIError",
  { message: Schema.String }
) {}

export class PIINotFound extends Schema.TaggedError<PIINotFound>()(
  "PIINotFound",
  { storageKey: PIIStorageKey }
) {}
