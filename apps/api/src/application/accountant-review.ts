import * as Accounting from "@open-erp/contracts/accounting";
import * as Review from "@open-erp/contracts/accountant-review";
import * as Reports from "@open-erp/contracts/reports";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "./identity";
import { digest, isoNow, newId, replay, saveCommand, sha256Hex } from "./posting";
import * as Db from "../db/accountant-review";
import { databaseFailure, type Transaction } from "../db/transaction";
import { readBasisDependencies, readCaptureProviders } from "./accountant-review-providers";

type Scope = typeof Accounting.Scope.Type;

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

type Principal = VerifiedPrincipal;

type PrepareCommand = {
  readonly scope: Scope;
  readonly idempotencyKey: string;
  readonly input: typeof Review.PrepareReviewPack.Type;
};

type ListCommand = { readonly scope: Scope; readonly after?: string };

type GetCommand = { readonly scope: Scope; readonly packId: string };

type RowsCommand = {
  readonly scope: Scope;
  readonly packId: string;
  readonly section: typeof Review.ReviewSection.Type;
  readonly after?: string;
};

type ArtifactCommand = {
  readonly scope: Scope;
  readonly packId: string;
  readonly format: typeof Review.ReviewFormat.Type;
};

type Section =
  | "balances"
  | "journal"
  | "evidence"
  | "coverage"
  | "owner_sources"
  | "owner_controls"
  | "expense_tax";

type CoverageStatus = "observed" | "missing" | "unavailable" | "unverified" | "excluded";

type StoredRow = { readonly section: Section; readonly ordinal: string; readonly body: JsonObject };

type Counts = (typeof Review.ReviewPack.Type)["counts"];

type CsvFields = Readonly<Record<string, ReadonlyArray<string>>>;

type CsvRows = {
  readonly balances: ReadonlyArray<JsonObject>;
  readonly journal: ReadonlyArray<JsonObject>;
  readonly evidence: ReadonlyArray<JsonObject>;
  readonly coverage: ReadonlyArray<JsonObject>;
  readonly owner_sources: ReadonlyArray<JsonObject>;
  readonly owner_controls: ReadonlyArray<JsonObject>;
  readonly expense_tax: ReadonlyArray<JsonObject>;
};

const PackSchema = Review.ReviewPack;

const PackViewSchema = Review.ReviewPackView;

const PackListSchema = Review.ReviewPackList;

const PageSchema = Review.ReviewPage;

const ArtifactSchema = Review.ReviewArtifact;

const RowSchema = Review.ReviewRow;

const DescriptorSchema = Review.ReviewArtifactDescriptor;

const ReportSchema = Reports.ReportSnapshot;

function decode<A>(schema: Schema.Decoder<A>, value: unknown) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

function withBook<A>(
  token: string,
  scope: Scope,
  lockMode: AuthorityLockMode,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly: false },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectArray(value: Json) {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function objectField(value: JsonObject, field: string) {
  const candidate = value[field];

  return isJsonObject(candidate) ? candidate : undefined;
}

function arrayField(value: JsonObject, field: string) {
  const candidate = value[field];

  return Array.isArray(candidate) ? candidate.filter(isJsonObject) : [];
}

function stringArrayField(value: JsonObject, field: string) {
  const candidate = value[field];

  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string")
    : [];
}

function stringField(value: JsonObject, field: string) {
  const candidate = value[field];

  return typeof candidate === "string" ? candidate : "";
}

function countField(value: JsonObject | undefined, field: string) {
  if (!value) return 0;
  const candidate = value[field];

  if (typeof candidate === "number") return candidate;

  if (typeof candidate !== "string") return 0;
  const parsed = Number(candidate);

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function hasUnexplainedDifference(value: JsonObject) {
  const candidate = value.unexplainedMinor;

  if (typeof candidate !== "string") return false;

  try {
    return BigInt(candidate) !== 0n;
  } catch {
    return false;
  }
}

function sameMinor(left: string, right: string) {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

function sectionRows(section: Section, rows: ReadonlyArray<JsonObject>, start = 1): StoredRow[] {
  return rows.map((body, index) => ({
    section,
    ordinal: String(start + index),
    body,
  }));
}

function validateRows(rows: ReadonlyArray<JsonObject>) {
  return Effect.forEach(rows, (row) => decode(RowSchema, row).pipe(Effect.asVoid));
}

function rowCount(rows: ReadonlyArray<JsonObject>) {
  return rows.length;
}

function csvCell(value: JsonObject, field: string) {
  const candidate = value[field];

  if (candidate === undefined || candidate === null) return "";

  if (typeof candidate === "string") return candidate;

  return JSON.stringify(candidate) ?? "";
}

function quoteCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function csvArtifact(
  context: JsonObject,
  fields: ReadonlyArray<string>,
  rows: ReadonlyArray<JsonObject>,
) {
  const headers = [
    "recordType",
    "packId",
    "packDigest",
    "reportId",
    "recordedThroughSequence",
    "currency",
    "currencyScale",
    "openingBasis",
    "companyCompleteness",
    "statutoryReady",
    "coverage",
    "providerBasis",
    "generatorVersion",
    ...fields,
  ];

  const manifest = Object.assign({}, context, { recordType: "manifest" });

  const body = [
    manifest,
    ...rows.map((row) => Object.assign({}, row, { recordType: stringField(row, "section") })),
  ];

  const lines = [
    headers.map(quoteCsv).join(","),
    ...body.map((row) => headers.map((field) => quoteCsv(`'${csvCell(row, field)}`)).join(",")),
  ];

  return `${lines.join("\r\n")}\r\n`;
}

function toJsonObject<A>(value: A) {
  return Schema.encodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function canonicalJson(value: JsonObject) {
  const result = canonicalizeJson(value);

  return Result.isFailure(result)
    ? Effect.fail(failure("InternalError"))
    : Effect.succeed(result.success.json);
}

function descriptorValue(
  packId: string,
  format: string,
  sha256: string,
  byteLength: number,
): JsonObject {
  return {
    format,
    filename: `${packId}__${format}${format === "json" ? ".json" : ".csv"}`,
    mediaType: format === "json" ? "application/json" : "text/csv",
    encoding: "UTF-8",
    byteLength,
    sha256,
    cellEncoding: format === "json" ? "json_exact" : "apostrophe_prefixed_text_v1",
  };
}

function artifactRow(packId: string, format: string, content: string, sha256: string): JsonObject {
  return {
    format,
    descriptor: descriptorValue(
      packId,
      format,
      sha256,
      new TextEncoder().encode(content).byteLength,
    ),
    content,
  };
}

function coverageRow(code: string, status: CoverageStatus, detail: string): JsonObject {
  return { section: "coverage", code, status, detail };
}

function buildCoverage(
  basis: JsonObject,
  capture: Db.CaptureRows,
  excludedSources: ReadonlyArray<{ readonly name: string; readonly reason: string }>,
  excludedVoucherCount: number,
) {
  const coverage: JsonObject[] = [];
  const owners = objectField(basis, "owners");
  const expenseTax = objectField(basis, "expenseTax");
  const vatReturns = objectField(basis, "vatReturns");
  const subledger = objectField(basis, "subledgerControls");
  const bank = objectField(basis, "bank");
  const unresolved = countField(owners, "unresolvedReviewCount");
  const unlinked = countField(owners, "unlinkedRecordCount");
  const expenseSources = countField(expenseTax, "sourceCount");
  const staleReviews = countField(expenseTax, "missingOrStaleReviewCount");
  const missingBases = countField(subledger, "missingBasisCount");
  const basisCount = countField(subledger, "basisCount");
  const snapshotCount = countField(subledger, "snapshotCount");

  const noPosting = objectArray(capture.evidence).filter(
    (row) => stringField(row, "disposition") === "no_included_posting",
  ).length;

  coverage.push(
    coverageRow(
      "opening_basis",
      "unverified",
      "Only recorded pre-interval postings form the numeric opening. Supplied explanation and evidence are not an approved opening basis.",
    ),
    coverageRow(
      "company_profile",
      "missing",
      "Legal entity type, fiscal facts, accounting method, VAT registration and complete obligations have not been verified for this book.",
    ),
    coverageRow(
      "required_source_inventory",
      "unverified",
      "The retained inventory cannot establish all company records. Every expected account and external register needs independent review.",
    ),
    coverageRow(
      "bank_controls",
      bank?.allRepresentedReady === true ? "observed" : "missing",
      "Captured bank state describes represented sources only. Empty sources are not a not-applicable conclusion.",
    ),
    coverageRow(
      "commerce_controls",
      "unverified",
      "Registered invoice and allocation counts are captured, but unregistered sources and company completeness remain unknown.",
    ),
    coverageRow(
      "schedule_controls",
      "unverified",
      "Captured schedule occurrences do not establish a complete asset or deferral inventory.",
    ),
    coverageRow(
      "schedule_carrying_basis",
      missingBases > 0 ? "missing" : "unverified",
      `Represented schedules without a retained carrying basis: ${missingBases}; retained bases: ${basisCount}.`,
    ),
    coverageRow(
      "subledger_control_coverage",
      "unavailable",
      `Saved declared-account control snapshots: ${snapshotCount}. The complete dependency retains bounded inventory and false coverage flags.`,
    ),
    coverageRow(
      "owner_funding",
      unresolved > 0 || unlinked > 0 ? "missing" : "unverified",
      `Unresolved owner reviews: ${unresolved}; sources without posted coverage: ${unlinked}. Opening and company completeness remain unknown.`,
    ),
    coverageRow(
      "vat_tax",
      expenseSources > 0 ? "missing" : "unverified",
      `Missing or stale expense reviews: ${staleReviews}; known expense sources: ${expenseSources}. No tax contribution or filing readiness is established.`,
    ),
    coverageRow(
      "vat_return_controls",
      "unavailable",
      `Captured VAT fact components: ${countField(vatReturns, "sourceCount")}; saved VAT drafts: ${countField(vatReturns, "draftCount")}.`,
    ),
    coverageRow(
      "other_obligations",
      "unverified",
      "Payroll, foreign exchange, statutory disclosures and other obligations require applicability evidence.",
    ),
    coverageRow(
      "unlinked_evidence",
      "unverified",
      `${noPosting} retained evidence records have no included posting or opening-explanation use. Review their disposition.`,
    ),
    coverageRow(
      "later_dated_vouchers",
      "excluded",
      `${excludedVoucherCount} vouchers at the captured sequence are dated after the interval and remain visible but excluded from totals.`,
    ),
    coverageRow(
      "statutory_outputs",
      "unavailable",
      "This accountant review pack is not a financial close, annual report, SIE, iXBRL, tax filing or external acceptance format.",
    ),
  );

  appendProviderCoverage(coverage, basis, capture, excludedSources);

  return coverage;
}

function appendProviderCoverage(
  coverage: JsonObject[],
  basis: JsonObject,
  capture: Db.CaptureRows,
  excludedSources: ReadonlyArray<{ readonly name: string; readonly reason: string }>,
) {
  const bank = objectField(basis, "bank");
  const declared = arrayField(basis, "declaredBankInventories");

  if (declared.length === 0) {
    coverage.push(
      coverageRow(
        "period_inventory_unavailable",
        "missing",
        "No configured period inventory overlaps this report interval. Required source coverage is not established.",
      ),
    );
  }

  for (const inventory of declared) {
    const periodId = stringField(inventory, "periodId");
    const inventoryId = stringField(inventory, "inventoryId");

    if (inventoryId.length === 0) {
      coverage.push(
        coverageRow(
          `bank_inventory_${periodId}`,
          "missing",
          `No explicit expected bank-source declaration is retained for period ${periodId}.`,
        ),
      );
      continue;
    }

    const expected = inventory.expectedAccountIds;

    if (!Array.isArray(expected)) continue;

    for (const accountId of expected) {
      if (typeof accountId !== "string") continue;

      const source = arrayField(bank ?? {}, "sources").find(
        (candidate) => stringField(candidate, "accountId") === accountId,
      );

      coverage.push(
        coverageRow(
          `expected_bank_${periodId}_${accountId}`,
          source && stringField(source, "reconciliationId").length > 0 ? "observed" : "missing",
          `Expected account ${accountId} declared for period ${periodId}: ${
            source
              ? stringField(source, "reconciliationId") || "no fresh complete reconciliation"
              : "no retained bank source is represented"
          }.`,
        ),
      );
    }
  }

  for (const source of objectArray(capture.owner_sources)) {
    if (stringField(source, "disposition") !== "excluded_after_end") continue;
    const sourceId = stringField(objectField(source, "source") ?? {}, "id");
    coverage.push(
      coverageRow(
        `owner_after_end_${sourceId}`,
        "excluded",
        `Owner source ${sourceId} is dated after the period end and is not in period owner controls.`,
      ),
    );
  }

  for (const control of objectArray(capture.owner_controls)) {
    const owner = objectField(control, "owner") ?? {};

    for (const accountControl of arrayField(control, "accountControls")) {
      if (!hasUnexplainedDifference(accountControl)) continue;
      coverage.push(
        coverageRow(
          `owner_control_${stringField(owner, "id")}_${stringField(accountControl, "accountId")}`,
          "missing",
          `Owner provider reports an unexplained whole-account difference for ${stringField(accountControl, "accountId")}.`,
        ),
      );
    }
  }

  for (const expense of objectArray(capture.expense_tax)) {
    const source = objectField(expense, "source") ?? {};
    const assessment = objectField(expense, "assessment") ?? {};

    for (const blocker of stringArrayField(assessment, "blockers")) {
      const code = blocker;
      coverage.push(
        coverageRow(
          `expense_${stringField(source, "sourceId")}_${code}`,
          "excluded",
          `Expense source ${stringField(source, "sourceId")} has an actual-review exclusion. No contribution is emitted.`,
        ),
      );
    }
  }

  for (const source of excludedSources) {
    coverage.push(
      coverageRow(
        `declared_exclusion_${coverage.length}`,
        "excluded",
        `Preparer declaration, not a not-applicable conclusion: ${source.name} — ${source.reason}`,
      ),
    );
  }
}

function rowsForFormat(rowsBySection: CsvRows, format: string) {
  switch (format) {
    case "balances_csv":
      return rowsBySection.balances;
    case "journal_csv":
      return rowsBySection.journal;
    case "evidence_csv":
      return rowsBySection.evidence;
    case "coverage_csv":
      return rowsBySection.coverage;
    case "owner_sources_csv":
      return rowsBySection.owner_sources;
    case "owner_controls_csv":
      return rowsBySection.owner_controls;
    case "expense_tax_csv":
      return rowsBySection.expense_tax;
    default:
      return [];
  }
}

function providerBasis(basis: JsonObject) {
  const owners = objectField(basis, "owners") ?? {};
  const expenseTax = objectField(basis, "expenseTax") ?? {};

  const base = {
    ownerSourceDigest: stringField(owners, "sourceDigest"),
    expenseTaxBasisDigest: stringField(expenseTax, "basisDigest"),
    ownerInventoryDigest: stringField(basis, "ownerInventoryDigest"),
  } satisfies JsonObject;

  const withVat =
    basis.vatReturns === undefined
      ? base
      : Object.assign({}, base, { vatReturns: basis.vatReturns });

  if (basis.subledgerControls === undefined) return withVat;

  return Object.assign({}, withVat, { subledgerControls: basis.subledgerControls });
}

function currentBasis(transaction: Transaction, scope: Scope, pack: typeof Review.ReviewPack.Type) {
  return Effect.gen(function* () {
    const bounds = yield* Db.readProviderBounds(transaction, scope.bookId);

    if (bounds[0]?.bounded !== true) return false;

    const basis = yield* Db.readBasis(
      transaction,
      scope.bookId,
      pack.report.startsOn,
      pack.report.endsOn,
      yield* readBasisDependencies(transaction, scope, pack.report.startsOn, pack.report.endsOn),
    );

    const row = basis[0];

    if (!row) return false;

    return (yield* digest(row.basis)) === pack.basisDigest;
  });
}

function packView(
  transaction: Transaction,
  scope: Scope,
  pack: typeof Review.ReviewPack.Type,
  dependenciesCurrent: boolean,
) {
  return Effect.gen(function* () {
    const rows = yield* Db.readArtifactDescriptors(transaction, scope.bookId, pack.id);
    const descriptors: JsonObject[] = [];

    for (const row of rows) descriptors.push(yield* decode(DescriptorSchema, row.descriptor));

    return yield* decode(PackViewSchema, {
      pack,
      artifacts: descriptors,
      dependenciesCurrent,
    });
  });
}

function readPack(transaction: Transaction, scope: Scope, packId: string) {
  return Effect.gen(function* () {
    const rows = yield* Db.readPack(transaction, scope.bookId, packId);
    const row = rows[0];

    if (!row) return yield* failure("NotFound");

    return { row, pack: yield* decode(PackSchema, row.body) };
  });
}

function captureSections(capture: Db.CaptureRows) {
  const emptyCoverage: JsonObject[] = [];

  return {
    balances: capture.balances,
    journal: capture.journal,
    evidence: capture.evidence,
    coverage: emptyCoverage,
    owner_sources: capture.owner_sources,
    owner_controls: capture.owner_controls,
    expense_tax: capture.expense_tax,
  };
}

function buildRows(capture: Db.CaptureRows, coverage: ReadonlyArray<JsonObject>) {
  const sections = captureSections(capture);
  sections.coverage = [...coverage];

  const stored: StoredRow[] = [
    ...sectionRows("balances", objectArray(capture.balances)),
    ...sectionRows("journal", objectArray(capture.journal)),
    ...sectionRows("evidence", objectArray(capture.evidence)),
    ...sectionRows("coverage", coverage),
    ...sectionRows("owner_sources", objectArray(capture.owner_sources)),
    ...sectionRows("owner_controls", objectArray(capture.owner_controls)),
    ...sectionRows("expense_tax", objectArray(capture.expense_tax)),
  ];

  return { sections, stored };
}

function parseRowCursor(after: string | undefined, packId: string, section: Section) {
  if (after === undefined) return Effect.succeed("0");

  const match =
    /^([a-z][a-z0-9_-]{2,127}):(balances|journal|evidence|coverage|owner_sources|owner_controls|expense_tax):([1-9][0-9]{0,18})$/.exec(
      after,
    );

  if (!match || match[1] !== packId || match[2] !== section) {
    return Effect.fail(failure("InvalidJournal"));
  }

  const positionText = match[3];

  if (positionText === undefined) return Effect.fail(failure("InvalidJournal"));
  let position: bigint;

  try {
    position = BigInt(positionText);
  } catch {
    return Effect.fail(failure("InvalidJournal"));
  }

  if (position > 9223372036854775807n) return Effect.fail(failure("InvalidJournal"));

  return Effect.succeed(position.toString());
}

function buildPackBody(
  scope: Scope,
  actorId: string,
  createdAt: string,
  report: Db.ReportRow,
  input: typeof Review.PrepareReviewPack.Type,
  basis: JsonObject,
  earlierVoucherCount: number,
  counts: Counts,
  rowsDigestValue: string,
): JsonObject {
  return {
    id: "",
    kind: "accountant_review_pack_v1",
    scope,
    report: report.body,
    openingBasis: {
      status: "not_verified",
      method: "recorded_pre_interval_postings_only",
      explanation: input.openingExplanation,
      evidenceIds: input.openingEvidenceIds,
      earlierVoucherCount,
    },
    accountantNotes: input.accountantNotes,
    basis,
    basisDigest: "",
    rowsDigest: rowsDigestValue,
    counts,
    companyCompleteness: "not_established",
    statutoryReady: false,
    generatorVersion: "accountant-review-v3",
    createdBy: actorId,
    createdAt,
  };
}

function loadCaptureContext(
  transaction: Transaction,
  scope: Scope,
  input: typeof Review.PrepareReviewPack.Type,
) {
  return Effect.gen(function* () {
    const bookRows = yield* Db.readBookState(transaction, scope.bookId);
    const book = bookRows[0];

    if (!book) return yield* failure("Forbidden");
    const reportRows = yield* Db.readReport(transaction, scope.bookId, input.reportId);
    const report = reportRows[0];

    if (!report) return yield* failure("NotFound");
    const reportSnapshot = yield* decode(ReportSchema, report.body);

    if (
      report.invalidated ||
      report.sequence !== book.committedSequence ||
      reportSnapshot.currency !== book.currency
    ) {
      return yield* failure("StaleDependency");
    }

    const bounds = yield* Db.readProviderBounds(transaction, scope.bookId);

    if (bounds[0]?.bounded !== true) return yield* failure("InvalidJournal");
    const summaryRows = yield* Db.readCaptureSummary(transaction, scope.bookId, report);
    const summary = summaryRows[0];

    if (!summary) return yield* failure("InternalError");

    if (
      BigInt(summary.voucherCount) > 1000n ||
      BigInt(summary.journalLineCount) > 5000n ||
      BigInt(summary.accountCount) > 1000n ||
      BigInt(summary.evidenceCount) > 1000n ||
      BigInt(summary.evidenceBytes) > 2097152n
    ) {
      return yield* failure("InvalidJournal");
    }

    const evidenceRows = yield* Db.readEvidencePresence(
      transaction,
      scope.bookId,
      input.openingEvidenceIds,
    );

    if (evidenceRows.length !== input.openingEvidenceIds.length) {
      return yield* failure("MissingEvidence");
    }

    const accounts = yield* Db.readAccounts(transaction, scope.bookId);

    const captureRows = yield* Db.readCaptureRows(
      transaction,
      scope.bookId,
      report,
      input.openingEvidenceIds,
      yield* readCaptureProviders(transaction, scope, report.startsOn, report.endsOn),
    );

    const capture = captureRows[0];

    if (!capture) return yield* failure("InternalError");
    const balances = objectArray(capture.balances);
    const journal = objectArray(capture.journal);

    if (balances.length !== accounts.length) return yield* failure("StaleDependency");
    const accountById = new Map(accounts.map((account) => [account.id, account]));

    for (const balance of balances) {
      const account = accountById.get(stringField(balance, "accountId"));

      if (
        !account ||
        account.code !== stringField(balance, "code") ||
        account.name !== stringField(balance, "name")
      ) {
        return yield* failure("StaleDependency");
      }
    }

    if (BigInt(summary.journalLineCount) !== BigInt(journal.length)) {
      return yield* failure("InvalidJournal");
    }

    const totals = yield* Db.readBalanceTotals(transaction, scope.bookId, report);
    const totalById = new Map(totals.map((total) => [total.accountId, total]));

    for (const balance of balances) {
      const total = totalById.get(stringField(balance, "accountId"));

      if (
        !total ||
        !sameMinor(stringField(balance, "recordedOpeningMinor"), total.openingMinor) ||
        !sameMinor(stringField(balance, "movementDebitMinor"), total.debitMinor) ||
        !sameMinor(stringField(balance, "movementCreditMinor"), total.creditMinor) ||
        !sameMinor(stringField(balance, "recordedClosingMinor"), total.closingMinor)
      ) {
        return yield* failure("InvalidJournal");
      }
    }

    const basisRows = yield* Db.readBasis(
      transaction,
      scope.bookId,
      report.startsOn,
      report.endsOn,
      yield* readBasisDependencies(transaction, scope, report.startsOn, report.endsOn),
    );

    const basis = basisRows[0]?.basis;

    if (!basis) return yield* failure("InternalError");

    return { book, report, reportSnapshot, summary, capture, basis };
  });
}

export const prepareReviewPack = Effect.fn("accountantReview.prepare")(function* (
  token: string,
  command: PrepareCommand,
) {
  return yield* withBook(token, command.scope, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const input = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_accountant_review",
        principal.actorId,
        input,
        PackViewSchema,
      );

      if (request.previous) return request.previous;

      const captureContext = yield* loadCaptureContext(transaction, command.scope, command.input);
      const { capture, basis, report, summary } = captureContext;
      const book = captureContext.book;
      const reportSnapshot = captureContext.reportSnapshot;

      const coverage = buildCoverage(
        basis,
        capture,
        command.input.excludedSources,
        Number(summary.excludedVoucherCount),
      );

      const { sections, stored } = buildRows(capture, coverage);
      yield* validateRows(stored.map((row) => row.body));

      const packId = newId("review_pack");
      const createdAt = yield* isoNow(transaction);
      const basisDigestValue = yield* digest(basis);
      const rowsDigestValue = yield* digest(sections);

      const counts = {
        balances: rowCount(objectArray(capture.balances)),
        journal: rowCount(objectArray(capture.journal)),
        evidence: rowCount(objectArray(capture.evidence)),
        coverage: coverage.length,
        owner_sources: rowCount(objectArray(capture.owner_sources)),
        owner_controls: rowCount(objectArray(capture.owner_controls)),
        expense_tax: rowCount(objectArray(capture.expense_tax)),
      } satisfies Counts;

      const bodyWithoutId = buildPackBody(
        command.scope,
        principal.actorId,
        createdAt,
        report,
        command.input,
        basis,
        Number(summary.earlierVoucherCount),
        counts,
        rowsDigestValue,
      );

      const bodyWithoutDigest = Object.assign({}, bodyWithoutId, {
        id: packId,
        basisDigest: basisDigestValue,
      });

      const packBody = Object.assign({}, bodyWithoutDigest, {
        digest: yield* digest(bodyWithoutDigest),
      }) satisfies JsonObject;

      yield* Db.insertPack(transaction, {
        bookId: command.scope.bookId,
        id: packId,
        ordinal:
          (yield* Db.readNextPackOrdinal(transaction, command.scope.bookId))[0]?.ordinal ?? "1",
        reportId: report.id,
        body: packBody,
      });
      yield* Db.insertRows(transaction, command.scope.bookId, packId, stored);

      const jsonContent = yield* canonicalJson({ pack: packBody, sections });

      const context: JsonObject = {
        packId,
        packDigest: stringField(packBody, "digest"),
        reportId: report.id,
        recordedThroughSequence: report.sequence,
        currency: book.currency,
        currencyScale: reportSnapshot.currencyScale ?? 0,
        openingBasis: objectField(packBody, "openingBasis") ?? {},
        companyCompleteness: "not_established",
        statutoryReady: false,
        coverage,
        providerBasis: providerBasis(basis),
        generatorVersion: "accountant-review-v3",
      };

      const csvFields = {
        balances_csv: [
          "accountId",
          "code",
          "name",
          "recordedOpeningMinor",
          "movementDebitMinor",
          "movementCreditMinor",
          "recordedClosingMinor",
        ],
        journal_csv: [
          "part",
          "sequence",
          "postingDate",
          "series",
          "voucherNumber",
          "voucherId",
          "lineId",
          "ordinal",
          "accountCode",
          "accountId",
          "description",
          "debitMinor",
          "creditMinor",
          "fiscalYearId",
          "periodId",
          "eventId",
          "postingPurpose",
          "correctsVoucherId",
          "changeSetId",
          "planDigest",
          "receiptId",
          "approvalId",
          "approvedBy",
          "committedAt",
          "evidenceRefs",
        ],
        evidence_csv: [
          "id",
          "title",
          "origin",
          "mediaType",
          "sha256",
          "createdAt",
          "disposition",
          "usedForOpeningExplanation",
          "includedVoucherIds",
          "excludedVoucherIds",
          "content",
        ],
        coverage_csv: ["code", "status", "detail"],
        owner_sources_csv: ["disposition", "source", "revision", "review"],
        owner_controls_csv: [
          "owner",
          "startsOn",
          "endsOn",
          "sourceCoverage",
          "openingBalanceMinor",
          "unlinkedRecordCount",
          "records",
          "effects",
          "allocations",
          "ownerBalances",
          "movements",
          "accountControls",
          "blockers",
        ],
        expense_tax_csv: ["assessmentMode", "source", "review", "assessment"],
      } satisfies CsvFields;

      const rowsBySection = {
        balances: objectArray(capture.balances),
        journal: objectArray(capture.journal),
        evidence: objectArray(capture.evidence),
        coverage,
        owner_sources: objectArray(capture.owner_sources),
        owner_controls: objectArray(capture.owner_controls),
        expense_tax: objectArray(capture.expense_tax),
      } satisfies CsvRows;

      const artifacts: JsonObject[] = [
        artifactRow(packId, "json", jsonContent, yield* sha256Hex(jsonContent)),
      ];

      for (const [format, fields] of Object.entries(csvFields)) {
        const content = csvArtifact(context, fields, rowsForFormat(rowsBySection, format));
        artifacts.push(artifactRow(packId, format, content, yield* sha256Hex(content)));
      }

      yield* Db.insertArtifacts(transaction, command.scope.bookId, packId, artifacts);

      const view = yield* packView(
        transaction,
        command.scope,
        yield* decode(PackSchema, packBody),
        true,
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_accountant_review",
        principal.actorId,
        yield* toJsonObject(view),
      );

      return view;
    }),
  );
});

export const listReviewPacks = Effect.fn("accountantReview.list")(function* (
  token: string,
  command: ListCommand,
) {
  return yield* withBook(token, command.scope, "share", (transaction) =>
    Effect.gen(function* () {
      const rows = yield* Db.readPackSummaries(
        transaction,
        command.scope.bookId,
        command.after ?? "0",
        26,
      );

      const items = rows.slice(0, 25).map((row) => ({
        id: row.id,
        digest: row.digest,
        reportId: row.reportId,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        sequence: row.sequence,
        createdAt: row.createdAt,
      }));

      const next = rows.length > 25 ? (rows[24]?.ordinal ?? null) : null;

      return yield* decode(PackListSchema, { items, next });
    }),
  );
});

export const getReviewPack = Effect.fn("accountantReview.get")(function* (
  token: string,
  command: GetCommand,
) {
  return yield* withBook(token, command.scope, "share", (transaction) =>
    Effect.gen(function* () {
      const { pack } = yield* readPack(transaction, command.scope, command.packId);
      const dependenciesCurrent = yield* currentBasis(transaction, command.scope, pack);

      return yield* packView(transaction, command.scope, pack, dependenciesCurrent);
    }),
  );
});

export const reviewPackRows = Effect.fn("accountantReview.rows")(function* (
  token: string,
  command: RowsCommand,
) {
  return yield* withBook(token, command.scope, "share", (transaction) =>
    Effect.gen(function* () {
      const { pack } = yield* readPack(transaction, command.scope, command.packId);
      const after = yield* parseRowCursor(command.after, command.packId, command.section);

      if (command.after !== undefined) {
        const anchor = yield* Db.readRowAnchor(
          transaction,
          command.scope.bookId,
          command.packId,
          command.section,
          after,
        );

        if (anchor[0]?.present !== true) return yield* failure("InvalidJournal");
      }

      const rows = yield* Db.readStoredRows(
        transaction,
        command.scope.bookId,
        command.packId,
        command.section,
        after,
        26,
      );

      const items = [];

      for (const row of rows.slice(0, 25)) items.push(yield* decode(RowSchema, row.body));

      const next =
        rows.length > 25 ? `${command.packId}:${command.section}:${rows[24]?.ordinal ?? ""}` : null;

      return yield* decode(PageSchema, {
        packId: command.packId,
        packDigest: pack.digest,
        section: command.section,
        total: pack.counts[command.section],
        items,
        next,
      });
    }),
  );
});

export const reviewPackArtifact = Effect.fn("accountantReview.artifact")(function* (
  token: string,
  command: ArtifactCommand,
) {
  return yield* withBook(token, command.scope, "share", (transaction) =>
    Effect.gen(function* () {
      const { pack } = yield* readPack(transaction, command.scope, command.packId);

      const rows = yield* Db.readArtifact(
        transaction,
        command.scope.bookId,
        command.packId,
        command.format,
      );

      const row = rows[0];

      if (!row) return yield* failure("NotFound");

      return yield* decode(ArtifactSchema, {
        packId: command.packId,
        packDigest: pack.digest,
        descriptor: yield* decode(DescriptorSchema, row.descriptor),
        content: row.content,
      });
    }),
  );
});
