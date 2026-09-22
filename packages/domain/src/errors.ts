import * as Schema from "effect/Schema";

export const FailureCode = Schema.Literals([
  "Unauthorized",
  "Forbidden",
  "NotFound",
  "InvalidJournal",
  "MissingEvidence",
  "PeriodLocked",
  "StaleDependency",
  "IdempotencyConflict",
  "AlreadyPosted",
  "ApprovalRequired",
  "UnsupportedProfile",
  "Unavailable",
  "InternalError",
]);

export class AccountingError extends Schema.TaggedError<AccountingError>()("AccountingError", {
  code: FailureCode,
  message: Schema.String,
}) {}
