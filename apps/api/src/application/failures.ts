import * as Accounting from "@open-erp/domain/errors";

const messages = {
  Unauthorized: "Sign in or provide a valid API token.",
  Forbidden: "You do not have permission for this action.",
  NotFound: "The requested record was not found.",
  InvalidJournal: "The journal is invalid. Review the posting details.",
  MissingEvidence: "Add supporting evidence before continuing.",
  PeriodLocked: "The accounting period is locked.",
  StaleDependency: "The book changed. Prepare and approve a new proposal.",
  IdempotencyConflict: "This request key was already used for a different command.",
  AlreadyPosted: "This event has already been posted.",
  ApprovalRequired: "A current operator approval is required.",
  UnsupportedProfile: "This accounting profile does not support this operation.",
  Unavailable: "The accounting service is unavailable. Try again later.",
  InternalError: "The accounting service could not complete this request.",
} satisfies Record<typeof Accounting.FailureCode.Type, string>;

export function failure(code: typeof Accounting.FailureCode.Type) {
  return new Accounting.AccountingError({ code, message: messages[code] });
}
