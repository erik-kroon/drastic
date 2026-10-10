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
  "PresenceRequired",
  "UnsupportedProfile",
  "Unavailable",
  "InternalError",
  "InvalidPostingLine",
  "InvalidPostingLineCount",
  "DuplicatePostingLine",
  "InvalidPostingSide",
  "UnbalancedPosting",
  "AccountingPeriodMissing",
  "PostingDateOutsidePeriod",
  "AccountMissing",
  "AccountInactive",
  "ConfigurationError",
  "TransactionRetry",
  "InvalidRequest",
  "RequestTooLarge",
  "RequestTimeout",
  "MethodNotAllowed",
]);

export const RecoveryClass = Schema.Literals(["permanent", "transient", "outcome-unknown"]);

const recoveryByCode = {
  Unauthorized: "permanent",
  Forbidden: "permanent",
  NotFound: "permanent",
  InvalidJournal: "permanent",
  MissingEvidence: "permanent",
  PeriodLocked: "permanent",
  StaleDependency: "permanent",
  IdempotencyConflict: "permanent",
  AlreadyPosted: "permanent",
  ApprovalRequired: "permanent",
  PresenceRequired: "permanent",
  UnsupportedProfile: "permanent",
  Unavailable: "outcome-unknown",
  InternalError: "outcome-unknown",
  InvalidPostingLine: "permanent",
  InvalidPostingLineCount: "permanent",
  DuplicatePostingLine: "permanent",
  InvalidPostingSide: "permanent",
  UnbalancedPosting: "permanent",
  AccountingPeriodMissing: "permanent",
  PostingDateOutsidePeriod: "permanent",
  AccountMissing: "permanent",
  AccountInactive: "permanent",
  ConfigurationError: "permanent",
  TransactionRetry: "transient",
  InvalidRequest: "permanent",
  RequestTooLarge: "permanent",
  RequestTimeout: "transient",
  MethodNotAllowed: "permanent",
} satisfies Record<typeof FailureCode.Type, typeof RecoveryClass.Type>;

const recoveryClasses = new Map<string, typeof RecoveryClass.Type>(Object.entries(recoveryByCode));

// Recovery describes unchanged automatic retry, not whether an operator may
// repair referenced state and explicitly retry a saved request under its own rules.
export function failureRecovery(code: string): typeof RecoveryClass.Type {
  return recoveryClasses.get(code) ?? "outcome-unknown";
}

export class AccountingError extends Schema.TaggedError<AccountingError>()("AccountingError", {
  code: FailureCode,
  message: Schema.String,
  // Retained pre-DF-10 refusals must decode without adding fields to sealed bytes.
  recovery: Schema.optional(RecoveryClass),
}) {}
