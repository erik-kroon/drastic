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
  UnsupportedProfile: 422,
  Unavailable: 503,
  InternalError: 500,
} satisfies Record<typeof Accounting.FailureCode.Type, number>;

export const accountingErrors = [401, 403, 404, 409, 422, 503, 500].map((status) =>
  Accounting.AccountingError.check(
    Schema.makeFilter((error) => AccountingErrorStatus[error.code] === status),
  ).annotate({ httpApiStatus: status }),
);
