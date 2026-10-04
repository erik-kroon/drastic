import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import * as Profiles from "./company-profiles";
import * as Intake from "./source-intake";
import { accountingErrors } from "./accounting-errors";

export const OnboardingPath = Schema.Literals([
  "new_company",
  "existing_company",
  "bureau_managed",
  "demo",
]);

export const MigrationDepth = Schema.Literals([
  "opening_only",
  "current_fiscal_year",
  "full_supported_history",
]);

export const SourceCategory = Schema.Literals([
  "company",
  "previous_books",
  "bank",
  "sales",
  "purchases",
  "tax",
  "assets",
  "payroll",
  "other",
]);

const Revision = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2147483646 }));

const DateOrUnknown = Schema.NullOr(A.AccountingDate);

export const OnboardingDates = Schema.Struct({
  historyStartsOn: DateOrUnknown,
  historyEndsOn: DateOrUnknown,
  detailStartsOn: DateOrUnknown,
  openingOn: DateOrUnknown,
  acceptanceStartsOn: DateOrUnknown,
  acceptanceEndsOn: DateOrUnknown,
  candidateLiveOn: DateOrUnknown,
  provingPeriodEndsOn: DateOrUnknown,
}).check(
  Schema.makeFilter((dates) => {
    const issues: Array<Schema.FilterIssue> = [];

    const ordered = (start: keyof typeof dates, end: keyof typeof dates, strict = false) => {
      const first = dates[start];
      const last = dates[end];

      if (first !== null && last !== null && (strict ? first >= last : first > last))
        issues.push({ path: [end], issue: `The ${end} must follow ${start}.` });
    };

    ordered("historyStartsOn", "historyEndsOn");
    ordered("historyStartsOn", "detailStartsOn");
    ordered("detailStartsOn", "historyEndsOn");
    ordered("openingOn", "acceptanceStartsOn", true);
    ordered("acceptanceStartsOn", "acceptanceEndsOn");
    ordered("acceptanceEndsOn", "historyEndsOn");
    ordered("acceptanceEndsOn", "candidateLiveOn", true);
    ordered("candidateLiveOn", "provingPeriodEndsOn");

    return issues;
  }),
);

export const OnboardingConfiguration = Schema.Struct({
  migrationDepth: Schema.NullOr(MigrationDepth),
  incumbentSystem: Schema.NullOr(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  dates: OnboardingDates,
}).check(
  Schema.makeFilter(
    (configuration) =>
      configuration.migrationDepth !== "opening_only" ||
      configuration.dates.detailStartsOn === null ||
      "Opening-only migration cannot claim detailed history.",
  ),
);

export const StartOnboarding = Schema.Struct({ path: OnboardingPath });

export const SaveOnboarding = Schema.Struct({
  expectedRevision: Revision,
  configuration: OnboardingConfiguration,
});

export const AttachOnboardingSource = Schema.Struct({
  occurrenceId: A.Identifier,
  category: SourceCategory,
});

export const OnboardingCase = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  revision: Revision,
  path: OnboardingPath,
  recordClass: Profiles.RecordClass,
  configuration: OnboardingConfiguration,
  recordedBy: A.Identifier,
  recordedAt: Schema.String,
  digest: A.Digest,
});

export const OnboardingSource = Schema.Struct({
  id: A.Identifier,
  caseId: A.Identifier,
  scope: A.Scope,
  category: SourceCategory,
  occurrence: Intake.SourceOccurrence,
  linkedBy: A.Identifier,
  linkedAt: Schema.String,
});

export const OnboardingQualification = Schema.Struct({
  family: Profiles.Family,
  state: Schema.Literals([
    "supported",
    "supported_with_handoff",
    "needs_information",
    "not_supported",
  ]),
  scope: Schema.Literal("dated_profile_witness_only"),
  witness: Schema.NullOr(Profiles.ProfileWitness),
  gaps: Schema.Array(Profiles.ProfileGap),
  reason: Schema.String,
});

export const OnboardingTask = Schema.Struct({
  id: Schema.Literals([
    "company",
    "compatibility",
    "sources",
    "import",
    "opening",
    "reconciliation",
    "responsibilities",
    "final_delta",
    "cutover",
    "go_live",
    "proving_period",
  ]),
  state: Schema.Literals(["needs_information", "in_progress", "blocked", "complete"]),
  owner: Schema.String,
  blockers: Schema.Array(Schema.String),
});

export const ImportProgress = Schema.Struct({
  sourceRunId: A.Identifier,
  sourcePlanId: A.Identifier,
  sourceKind: Schema.Literals(["synthetic", "reviewed_sie4"]),
  sourceState: Schema.Literals(["running", "paused", "staged"]),
  nextSourceOrdinal: Schema.Int,
  financialRunId: Schema.NullOr(A.Identifier),
  financialState: Schema.NullOr(Schema.Literals(["running", "paused", "posted"])),
  nextFinancialOrdinal: Schema.NullOr(Schema.Int),
});

export const OnboardingWorkspace = Schema.Struct({
  case: OnboardingCase,
  checkedAt: Schema.String,
  profile: Profiles.CompanyProfile,
  qualification: Schema.Array(OnboardingQualification),
  sources: Schema.Array(OnboardingSource),
  nextSourceCursor: Schema.NullOr(A.Identifier),
  sourceCount: A.AggregateMinorUnits,
  sourceCoverage: Schema.Literal("not_established"),
  imports: Schema.Array(ImportProgress),
  nextImportCursor: Schema.NullOr(A.Identifier),
  tasks: Schema.Array(OnboardingTask),
  cutover: Schema.Struct({
    ready: Schema.Literal(false),
    authority: Schema.Literal("not_established"),
    candidateLiveOn: DateOrUnknown,
    blockers: Schema.Array(Schema.String),
  }),
});

export const OnboardingHistory = Schema.Struct({
  scope: A.Scope,
  items: Schema.Array(OnboardingCase),
  nextBeforeRevision: Schema.NullOr(Revision),
});

const base = "/v1/entities/:entityId/books/:bookId/onboarding";

const scoped = { params: A.Scope, error: accountingErrors };

const mutation = { ...scoped, headers: A.IdempotencyHeaders };

export const OnboardingApi = HttpApiGroup.make("onboarding")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.get("getOnboarding", base, {
      ...scoped,
      query: Schema.Struct({
        sourceAfter: Schema.optional(A.Identifier),
        importAfter: Schema.optional(A.Identifier),
      }),
      success: OnboardingWorkspace,
    }),
    HttpApiEndpoint.post("startOnboarding", base, {
      ...mutation,
      payload: StartOnboarding,
      success: OnboardingCase,
    }),
    HttpApiEndpoint.post("saveOnboarding", `${base}/revisions`, {
      ...mutation,
      payload: SaveOnboarding,
      success: OnboardingCase,
    }),
    HttpApiEndpoint.get("getOnboardingHistory", `${base}/revisions`, {
      ...scoped,
      query: Schema.Struct({
        before: Schema.optional(
          Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)),
        ),
      }),
      success: OnboardingHistory,
    }),
    HttpApiEndpoint.post("attachOnboardingSource", `${base}/sources`, {
      ...mutation,
      payload: AttachOnboardingSource,
      success: OnboardingSource,
    }),
  );
