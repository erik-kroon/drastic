import * as Schema from "effect/Schema";
import * as Accounting from "./accounting";

export const AccountingErrorStatus = {
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  InvalidJournal: 422,
  MissingEvidence: 422,
  PeriodLocked: 409,
  StaleDependency: 409,
  IdempotencyConflict: 409,
  AlreadyPosted: 409,
  ApprovalRequired: 403,
  PresenceRequired: 403,
  UnsupportedProfile: 422,
  Unavailable: 503,
  InternalError: 500,
  InvalidPostingLine: 422,
  InvalidPostingLineCount: 422,
  DuplicatePostingLine: 422,
  InvalidPostingSide: 422,
  UnbalancedPosting: 422,
  AccountingPeriodMissing: 422,
  PostingDateOutsidePeriod: 422,
  AccountMissing: 422,
  AccountInactive: 422,
  ConfigurationError: 503,
  TransactionRetry: 503,
  InvalidRequest: 400,
  RequestTooLarge: 413,
  RequestTimeout: 408,
  MethodNotAllowed: 405,
} satisfies Record<typeof Accounting.FailureCode.Type, number>;

export const accountingErrors = [400, 401, 403, 404, 405, 408, 409, 413, 422, 503, 500].map(
  (status) =>
    Accounting.AccountingError.check(
      Schema.makeFilter((error) => AccountingErrorStatus[error.code] === status),
    ).annotate({ httpApiStatus: status }),
);
