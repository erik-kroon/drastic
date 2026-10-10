import * as Accounting from "@open-erp/domain/errors";
import type { PostingValidationFailure } from "@open-erp/domain/posting";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

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
  PresenceRequired: "Confirm this exact action with your enrolled security key.",
  UnsupportedProfile: "This accounting profile does not support this operation.",
  Unavailable: "The accounting service is unavailable. Try again later.",
  InternalError: "The accounting service could not complete this request.",
  InvalidPostingLine: "Use valid exact amounts and identifiers for each posting line.",
  InvalidPostingLineCount: "Use between two and 500 posting lines.",
  DuplicatePostingLine: "Give every posting line a unique identifier.",
  InvalidPostingSide: "Each posting line must have exactly one positive debit or credit side.",
  UnbalancedPosting: "Posting debits and credits must balance exactly with a nonzero total.",
  AccountingPeriodMissing: "Select an accounting period that exists in this book.",
  PostingDateOutsidePeriod:
    "Choose a posting date inside the selected accounting period and fiscal year.",
  AccountMissing: "Select accounts that exist in this book's chart.",
  AccountInactive: "Activate the account or select an active account before posting.",
  ConfigurationError: "The accounting service configuration requires repair before retrying.",
  TransactionRetry: "A temporary transaction conflict rolled back this attempt.",
  InvalidRequest:
    "The request does not match the API contract. Review its fields and exact values.",
  RequestTooLarge: "Request body exceeds the byte limit.",
  RequestTimeout: "Request body timed out before the operation began. Retry with the original key.",
  MethodNotAllowed: "Use the HTTP method declared for this operation.",
} satisfies Record<typeof Accounting.FailureCode.Type, string>;

// Causes stay outside the serializable accounting error contract.
const causes = new WeakMap<Accounting.AccountingError, unknown>();

const logged = new WeakSet<Accounting.AccountingError>();

export function failure(code: typeof Accounting.FailureCode.Type, cause?: unknown) {
  const error = new Accounting.AccountingError({
    code,
    message: messages[code],
    recovery: Accounting.failureRecovery(code),
  });

  if (cause !== undefined) causes.set(error, cause);

  return error;
}

export function postingFailure(code: PostingValidationFailure["code"]) {
  const codes = {
    InvalidLine: "InvalidPostingLine",
    LineCount: "InvalidPostingLineCount",
    LineId: "DuplicatePostingLine",
    LineSide: "InvalidPostingSide",
    Unbalanced: "UnbalancedPosting",
    InvalidGroup: "InvalidJournal",
    DuplicateGroupId: "InvalidJournal",
    UnknownDependency: "InvalidJournal",
    DependencyCycle: "InvalidJournal",
  } satisfies Record<PostingValidationFailure["code"], typeof Accounting.FailureCode.Type>;

  return failure(codes[code]);
}

const schemaIssues = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: (issue) => {
    if (!Predicate.isTagged(issue, "InvalidType")) return issue._tag;

    return Predicate.isTagged(issue.ast, "Literal")
      ? `Expected literal ${String(issue.ast.literal)}`
      : `Expected ${issue.ast._tag}`;
  },
  checkHook: () => "Schema check failed",
});

const DatabaseDiagnostic = Schema.Struct({
  code: Schema.String,
  schema: Schema.optional(Schema.String),
  table: Schema.optional(Schema.String),
  column: Schema.optional(Schema.String),
  constraint: Schema.optional(Schema.String),
});

function diagnosticCause(cause: unknown, depth = 0): Schema.JsonObject {
  if (depth >= 8) return { truncated: true };

  if (Cause.isCause(cause)) {
    return {
      reasons: cause.reasons
        .filter((reason) => !Cause.isInterruptReason(reason))
        .map((reason) =>
          diagnosticCause(Cause.isFailReason(reason) ? reason.error : reason.defect, depth + 1),
        ),
    };
  }

  if (Schema.isSchemaError(cause)) {
    return {
      name: "SchemaError",
      issues: schemaIssues(cause.issue).issues.map((issue) => ({
        path: issue.path?.map(String) ?? [],
        message: issue.message,
      })),
    };
  }

  const diagnostic: { [key: string]: Schema.Json } = {};

  if (cause instanceof Error) {
    diagnostic.name = cause.name;
    // Error messages can contain SQL parameters, credentials or source content.
    diagnostic.frames =
      cause.stack
        ?.split("\n")
        .filter((line) => line.trimStart().startsWith("at "))
        .slice(0, 12) ?? [];
  }

  if (Schema.is(DatabaseDiagnostic)(cause)) {
    diagnostic.code = cause.code;
    diagnostic.schema = cause.schema ?? null;
    diagnostic.table = cause.table ?? null;
    diagnostic.column = cause.column ?? null;
    diagnostic.constraint = cause.constraint ?? null;
  }

  if (Predicate.hasProperty(cause, "_tag") && Predicate.isString(cause._tag))
    diagnostic.tag = cause._tag;

  if (Predicate.hasProperty(cause, "reason"))
    diagnostic.reason = diagnosticCause(cause.reason, depth + 1);

  if (Predicate.hasProperty(cause, "cause"))
    diagnostic.cause = diagnosticCause(cause.cause, depth + 1);

  return diagnostic;
}

export const logFailure = Effect.fn("Accounting.logFailure")(function* (
  error: Accounting.AccountingError,
) {
  if (
    !["InternalError", "Unavailable", "ConfigurationError", "TransactionRetry"].includes(
      error.code,
    ) ||
    logged.has(error)
  )
    return;
  logged.add(error);

  yield* Effect.logError(
    "Accounting operation failed",
    JSON.stringify({
      code: error.code,
      diagnostic: diagnosticCause(causes.get(error) ?? error),
    }),
  ).pipe(Effect.provideService(Logger.LogToStderr, true));
});
