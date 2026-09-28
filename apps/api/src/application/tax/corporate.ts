import * as Accounting from "@open-erp/contracts/accounting";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Statements from "@open-erp/contracts/report-statements";
import * as Tax from "@open-erp/contracts/corporate-tax";
import { AccountingError } from "@open-erp/domain/errors";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import {
  executeChangeInTransaction,
  isoNow,
  newId,
  readExecutionApprovalInTransaction,
  replay,
  saveCommand,
  sealActionInTransaction,
  validatePlan,
  versionedDigest,
  digest as digestJson,
} from "../posting";
import { resolveCompanyProfileInTransaction } from "../company-profiles";
import { base64, sha256HexOf } from "../bytes";
import {
  commandReceipt,
  decode,
  requireRetainedEvidence,
  toJsonObject,
  withBook,
  type JsonObject,
  type Principal,
  type Scope,
} from "../commerce/support";
import { readTableAccess } from "../../db/commerce/access";
import * as Ledger from "../../db/posting";
import * as ProfileDb from "../../db/company-profiles";
import * as StatementDb from "../../db/report-statements";
import * as Db from "../../db/tax/corporate";
import type { Transaction } from "../../db/transaction";
import {
  calculateCorporateTax,
  prepareIncomeTaxFields,
  renderSru,
  reparseSru,
  taxAddbackSource,
} from "./corporate-basis";

// NEXT-22: the pre-close corporate income-tax bridge, the one approved current-tax
// effect and the INK2/SRU declaration lineage.
//
// Three deliverables, three records, three separate transactions:
//
//   prepareBridge      seals a proposal over one immutable statement snapshot and
//                      the reviewed admission witness. It posts nothing, adopts no
//                      loss right and has no financial effect. It seals a plan so the
//                      exact year target and the exact delta can be approved like
//                      any other proposal.
//   executeEffect      re-resolves the whole basis inside its own transaction,
//                      validates the exact approval, posts only the remaining delta
//                      through the shared journal primitive, and commits the sealed
//                      target, the journal, the approval use, the receipt and the
//                      counter together. A zero delta commits an approved no-effect
//                      receipt and no voucher.
//   prepareDeclaration derives the reviewed fields and renders and re-parses the
//                      reviewed files, then retains the exact bytes. It is a report
//                      artifact and never a financial effect.
//
// Lock order: requester credential and membership, then the book writer row, then
// the accounting period, then the bridge and its retained references, then the
// approval. The statement snapshot, its rows and its contributions are immutable,
// so they are read rather than locked and later activity cannot change them.

const bridgeOperation = "prepare_corporate_tax_bridge";

const effectOperation = "execute_corporate_tax_effect";

const declarationOperation = "prepare_corporate_tax_declaration";

const SnapshotSchema = Statements.StatementSnapshot;

const StatementRowSchema = Statements.StatementModelRow;

const BridgeViewSchema = Tax.TaxBridgeView;

const BridgeSchema = Tax.TaxBridge;

const EffectPageSchema = Tax.CorporateTaxEffectPage;

const EffectSchema = Tax.CorporateTaxEffect;

const DeclarationSchema = Tax.CorporateTaxDeclaration;

const BridgePageSchema = Tax.CorporateTaxBridgePage;

const DeclarationPageSchema = Tax.CorporateTaxDeclarationPage;

const maximumIncomeTaxComponents = 2000;

// One access check for both directions. A write path must be able to read every
// table the operation derives its plan from, and to insert into every table it
// retains a record in. A read path only has to read.
function requireTableGrants(transaction: Transaction, write: boolean) {
  const tables = [...Db.corporateTaxReadTables];
  const inserts: ReadonlyArray<string> = Db.corporateTaxWriteTables;

  return readTableAccess(transaction, tables).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== tables.length) return failure("UnsupportedProfile");

      if (rows.some((row) => !row.canSelect)) return failure("UnsupportedProfile");

      return write && rows.some((row) => inserts.includes(row.tableName) && !row.canInsert)
        ? failure("UnsupportedProfile")
        : Effect.void;
    }),
  );
}

// A refusal keeps its reviewed reason in the message and is reported through the
// existing public error family. No refusal is a partial success and none produces a
// fabricated figure, a default rate or a partial form. The refusal code travels in
// the message so the operator sees which reviewed condition stopped the request.
function refusal(reason: typeof Tax.TaxRefusal.Type) {
  return new AccountingError({
    code: "UnsupportedProfile",
    message: `${reason.code}: ${reason.message}`,
  });
}

function profileDates(taxPeriodOn: string): typeof Profiles.ProfileDates.Type {
  return { postingOn: null, taxPointOn: null, paymentOn: null, reportOn: null, taxPeriodOn };
}

function evidenceReference(reference: { readonly evidenceId: string; readonly sha256: string }) {
  return { evidenceId: reference.evidenceId, sha256: reference.sha256 };
}

function equalLists(left: ReadonlyArray<string>, right: ReadonlyArray<string>) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

// The reviewed income-tax exclusion set, resolved through the company admission
// owner. The accounts are never named by a request payload and never inferred from
// an account number: the witness already established that exactly one binding of
// each required role is live and current, so this only reads the accounts and the
// evidence those reviewed bindings carry.
const incomeTaxAccounts = Effect.fn("corporateTax.incomeTaxAccounts")(function* (
  bindings: ReadonlyArray<ProfileDb.RoleBindingRow>,
  roleBindingIds: ReadonlyArray<string>,
) {
  const wanted = new Set(roleBindingIds);
  const found = new Map<string, ProfileDb.RoleBindingRow>();

  for (const binding of bindings) {
    if (!wanted.has(binding.id)) continue;

    if (found.has(binding.roleKind)) return null;

    found.set(binding.roleKind, binding);
  }

  const expense = found.get("corporate_tax_expense");
  const liability = found.get("corporate_tax_liability");
  const other = found.get("corporate_tax_other_expense");

  if (expense === undefined || liability === undefined) return null;

  const selected: Array<
    [Tax.IncomeTaxRoleKind, typeof Tax.IncomeTaxRole.Type, ProfileDb.RoleBindingRow]
  > = [
    ["corporate_tax_expense", "current_expense", expense],
    ["corporate_tax_liability", "current_liability", liability],
  ];

  if (other !== undefined) {
    selected.push(["corporate_tax_other_expense", "other_income_tax_expense", other]);
  }

  const accounts: Array<typeof Tax.IncomeTaxAccount.Type> = [];
  const evidence: Array<JsonObject> = [];

  for (const [roleKind, role, binding] of selected) {
    const body = yield* decode(Profiles.RoleBinding, binding.body);

    for (const reference of body.evidence) evidence.push(evidenceReference(reference));

    accounts.push({
      accountId: binding.accountId,
      role,
      roleKind,
      roleBindingId: binding.id,
      accountVersion: binding.accountVersion.toString(),
      evidence: body.evidence,
      note: body.note,
    });
  }

  return { accounts, evidence };
});

function accountFor(overlay: typeof Tax.PreTaxOverlay.Type, role: typeof Tax.IncomeTaxRole.Type) {
  const found = overlay.incomeTaxAccounts.find((entry) => entry.role === role);

  return found === undefined ? null : found.accountId;
}

// One immutable statement snapshot, read through the statement owner's own paging
// read. The exact retained bytes are what a bridge and a declaration bind to, so a
// changed pre-tax population refuses instead of quietly re-deriving an amount.
const readRetainedStatement = Effect.fn("corporateTax.retainedStatement")(function* (
  transaction: Transaction,
  scope: Scope,
  snapshotId: string,
) {
  const header = (yield* StatementDb.readStatementSnapshot(
    transaction,
    scope.bookId,
    snapshotId,
  ))[0];

  if (header === undefined) return yield* failure("NotFound");

  const bodies: Array<JsonObject> = [];
  const amounts = new Map<string, bigint>();
  let cursor = 0;

  for (;;) {
    const page = (yield* StatementDb.readStatementRowPage(
      transaction,
      scope.bookId,
      snapshotId,
      null,
      cursor,
      StatementDb.statementSnapshotPageSize,
    ))[0];

    if (page === undefined) return yield* failure("InternalError");

    const items = Option.getOrNull(
      Schema.decodeOption(Schema.Array(Schema.JsonObject))(page.items),
    );

    if (items === null) return yield* failure("InternalError");

    for (const item of items) {
      const row = yield* decode(StatementRowSchema, item);

      bodies.push(item);
      amounts.set(row.rowId, BigInt(row.amountMinor));
    }

    if (page.nextOrdinal === null) break;

    cursor = Number(page.nextOrdinal);
  }

  const snapshot = yield* decode(SnapshotSchema, header.body);

  return {
    snapshot,
    amounts,
    digest: yield* digestJson(
      yield* toJsonObject({ snapshot: header.body, rows: bodies }),
      "StaleDependency",
    ),
  };
});

// The statement owner already publishes what "this snapshot still describes the
// current ledger" means: a reopen covering the reported as-of date, and vouchers
// committed after the snapshot's cutoff. Reusing that read is what keeps the tax
// bridge from holding a second, weaker idea of currentness.
//
// The exact conservative boundary, stated once and applied identically at capture
// and at execution:
//
//   reopenedAfterCapture                                       -> refuse
//   postingsAfterCutoff - ownEffectPostingsAfter > 0            -> refuse
//
// That is deliberately stricter than strictly necessary. It refuses a bridge
// whenever *any* voucher committed after the cutoff other than this owner's own
// committed current-tax effect for the reported year exists, even one that
// provably cannot touch the reported population. Refusing a proposal costs a fresh
// snapshot; posting a current-tax accrual derived from a population that has since
// moved is not recoverable by any later operation, so the boundary errs toward
// refusal.
//
// The own-effect exclusion is what keeps the boundary from being self-defeating:
// recognising a tax effect is itself a voucher after the cutoff, and without the
// exclusion the first effect would make every later bridge over the same snapshot
// refuse. It is deliberately narrow. It counts a voucher only when a committed
// corporate_tax_effect row for this book and the reported fiscal year points at it,
// that effect actually posted a journal, and the voucher's own change set is that
// effect's change set. An event-key prefix is deliberately not used: a key is a
// naming convention any posting path can choose, so a manual posting that merely
// named itself like tax would then escape the guard.
//
// A reopened period is refused even if the only later posting is this owner's,
// because a reopen means the reviewed population itself was re-opened for
// correction, not merely appended to.
//
// It reports current rather than raising, because capture turns a stale population
// into a refusal while execution turns the same condition into "this basis no
// longer matches" and lets its caller decide.
const statementIsCurrent = Effect.fn("corporateTax.statementIsCurrent")(function* (
  transaction: Transaction,
  bookId: string,
  snapshot: typeof SnapshotSchema.Type,
) {
  const live = (yield* StatementDb.readStatementLiveStatus(
    transaction,
    bookId,
    snapshot.ledgerBoundary,
    snapshot.asOf,
    snapshot.createdAt,
  ))[0];

  if (live === undefined) return yield* failure("InternalError");

  if (live.reopenedAfterCapture) return false;

  const own = (yield* Db.readOwnEffectPostingsAfter(
    transaction,
    bookId,
    snapshot.fiscalYear.id,
    snapshot.ledgerBoundary,
  ))[0];

  if (own === undefined) return yield* failure("InternalError");

  // Both reads use the identical cutoff, so the difference is exactly the number of
  // later postings that are not this owner's own committed tax effect for the reported
  // year. A negative result would mean the two reads disagree about the same
  // boundary, which is a defect rather than a stale population.
  const foreign = BigInt(live.postingsAfterCutoff) - BigInt(own.count);

  if (foreign < 0n) return yield* failure("InternalError");

  return foreign === 0n;
});

function statementYearProfit(snapshot: typeof SnapshotSchema.Type) {
  return snapshot.fiscalYtdProfitMinor ?? snapshot.balance.virtualUntransferredResultMinor;
}

const captureBasis = Effect.fn("corporateTax.captureBasis")(function* (
  transaction: Transaction,
  scope: Scope,
  fiscalYearId: string,
  statementSnapshotId: string,
) {
  const book = (yield* Ledger.readBook(transaction, scope))[0];

  if (book === undefined) return yield* failure("Forbidden");

  if (book.profile !== "synthetic-core-v1") return yield* failure("UnsupportedProfile");

  const fiscalYear = (yield* Ledger.readFiscalYear(transaction, scope.bookId, fiscalYearId))[0];

  if (fiscalYear === undefined) return yield* failure("NotFound");

  const statement = yield* readRetainedStatement(transaction, scope, statementSnapshotId);
  const snapshot = statement.snapshot;

  if (snapshot.scope.bookId !== scope.bookId) return yield* failure("StaleDependency");

  if (snapshot.fiscalYear.id !== fiscalYear.id) return yield* failure("StaleDependency");

  // A bridge is only sealed over a population the statement owner still calls
  // current. This runs before any figure is derived, so no stale proposal is sealed.
  if (!(yield* statementIsCurrent(transaction, scope.bookId, snapshot))) {
    return yield* failure("StaleDependency");
  }

  if (snapshot.currency !== book.currency) return yield* failure("StaleDependency");

  if (snapshot.currencyScale !== book.currencyScale) return yield* failure("StaleDependency");

  if (snapshot.asOf < fiscalYear.startsOn || snapshot.asOf > fiscalYear.endsOn) {
    return yield* failure("StaleDependency");
  }

  // The pre-close family selects its reviewed release on the fiscal period end it
  // reports on, never on today's date.
  const resolved = yield* resolveCompanyProfileInTransaction(
    transaction,
    scope,
    "actual_company",
    profileDates(fiscalYear.endsOn),
  );

  const witness =
    resolved.families.find((entry) => entry.family === "corporate_tax")?.witness ?? null;

  if (witness === null) return yield* failure("UnsupportedProfile");

  const releaseRow = (yield* ProfileDb.readRuleReleases(transaction, "corporate_tax")).find(
    (row) => row.id === witness.ruleReleaseId,
  );

  if (releaseRow === undefined) return yield* failure("UnsupportedProfile");

  const outer = Option.getOrNull(Schema.decodeUnknownOption(Profiles.RuleRelease)(releaseRow.body));

  if (outer === null || outer.corporateTax === undefined)
    return yield* failure("UnsupportedProfile");

  if (releaseRow.checksum !== outer.checksum) return yield* failure("StaleDependency");

  if (outer.corporateTax.calculatorVersion !== Tax.SupportedCalculatorVersion) {
    return yield* failure("UnsupportedProfile");
  }

  const bindings = yield* ProfileDb.readRoleBindings(
    transaction,
    scope.bookId,
    fiscalYear.startsOn,
    fiscalYear.endsOn,
  );

  const accounts = yield* incomeTaxAccounts(bindings, witness.roleBindingIds);

  if (accounts === null) return yield* failure("UnsupportedProfile");

  const contributions = yield* Db.readStatementIncomeTaxContributions(
    transaction,
    scope.bookId,
    snapshot.id,
    accounts.accounts
      .filter((entry) => entry.role !== "current_liability")
      .map((entry) => entry.accountId),
    maximumIncomeTaxComponents,
  );

  if (contributions.length > maximumIncomeTaxComponents)
    return yield* failure("UnsupportedProfile");

  const components = contributions.map((row) => ({
    componentId: row.componentId,
    voucherId: row.voucherId,
    lineId: row.lineId,
    sequence: row.sequence,
    accountId: row.accountId,
    debitMinor: row.debitMinor,
    creditMinor: row.creditMinor,
    signedMinor: row.signedMinor,
    description: row.description,
  }));

  const expenseAccount =
    accounts.accounts.find((entry) => entry.role === "current_expense")?.accountId ?? null;

  let currentExpense = 0n;

  if (expenseAccount === null) return yield* failure("UnsupportedProfile");

  for (const entry of components) {
    if (entry.accountId === expenseAccount) currentExpense += BigInt(entry.signedMinor);
  }

  const period = (yield* Db.readPeriodsForYear(transaction, scope.bookId, fiscalYear.id)).find(
    (row) => row.startsOn <= snapshot.asOf && snapshot.asOf <= row.endsOn,
  );

  if (period === undefined || period.locked) return yield* failure("UnsupportedProfile");

  const membership = yield* ProfileDb.readFamilyMembership(
    transaction,
    scope.bookId,
    "corporate_tax",
  );

  const recognizedRow = (yield* Db.readRecognizedForYear(
    transaction,
    scope.bookId,
    fiscalYear.id,
  ))[0];

  if (recognizedRow === undefined) return yield* failure("InternalError");

  const overlay = yield* decode(
    Tax.PreTaxOverlay,
    yield* toJsonObject({
      statementSnapshotId: snapshot.id,
      statementDigest: statement.digest,
      fiscalYear: { id: fiscalYear.id, startsOn: fiscalYear.startsOn, endsOn: fiscalYear.endsOn },
      asOf: snapshot.asOf,
      plInterval: snapshot.plInterval,
      ledgerBoundary: snapshot.ledgerBoundary,
      recordedCutoff: snapshot.recordedCutoff,
      currency: snapshot.currency,
      currencyScale: snapshot.currencyScale,
      retainedContributionCount: snapshot.contributionCount,
      factRevisions: snapshot.factRevisions,
      // The canonical form digests an object, never a bare array, so the retained
      // membership is enveloped under its own key. The envelope is part of the
      // digest, so this exact set cannot be re-spelled into a different value.
      incomeTaxContributionDigest: yield* digestJson(
        yield* toJsonObject({
          components: components.map((entry) => ({
            componentId: entry.componentId,
            accountId: entry.accountId,
            signedMinor: entry.signedMinor,
          })),
        }),
        "StaleDependency",
      ),
      retainedStatementResultMinor: statementYearProfit(snapshot),
      incomeTaxAccounts: accounts.accounts,
      incomeTaxComponents: components,
      incomeTaxExpenseEffectMinor: currentExpense.toString(),
      mechanicalTransferEffectsExcludedFromPL: {
        roles: snapshot.mappingRelease.mechanicalTransferRoles,
        excludedFromRetainedContributions: true,
        amountRetainedInSnapshot: false,
      },
      sourceCoverage:
        snapshot.coverage.arithmetic === "pass"
          ? "arithmetic_passing_capture"
          : "arithmetic_failing_capture",
      diagnostics: snapshot.diagnostics
        .slice(0, 40)
        .map((entry) => `${entry.code}: ${entry.detail}`),
    }),
  );

  return {
    book,
    fiscalYear,
    period,
    snapshot,
    releaseRow,
    release: outer.corporateTax,
    witness,
    membership,
    accounts,
    overlay,
    overlayDigest: yield* digestJson(yield* toJsonObject(overlay), "StaleDependency"),
    recognized: BigInt(recognizedRow.minor),
  };
});

const bridgeView = Effect.fn("corporateTax.bridgeView")(function* (
  transaction: Transaction,
  scope: Scope,
  bridge: typeof Tax.TaxBridge.Type,
  recognized: bigint,
) {
  const rows = yield* Db.readEffectsForBridges(transaction, scope.bookId, [bridge.id]);
  const effects = yield* Effect.forEach(rows, (row) => decode(EffectSchema, row.body));
  const outstanding = BigInt(bridge.currentTaxTargetMinor) - recognized;

  return yield* decode(BridgeViewSchema, {
    bridge,
    progress: {
      checkedAt: yield* isoNow(transaction),
      effectsForYear: effects.length,
      recognizedTotalMinor: recognized.toString(),
      outstandingMinor: outstanding.toString(),
      fullyRecognized: outstanding === 0n,
    },
    effects,
  });
});

// The sealed proposal for one current-tax effect. A non-zero delta carries exactly
// one two-line journal action through the shared seal primitive, so the approved
// digest covers the exact amount. A zero delta seals a plan with no group at all,
// because an already recognised target posts nothing and consumes no voucher number.
const sealEffectPlan = Effect.fn("corporateTax.sealEffectPlan")(function* (
  transaction: Transaction,
  principal: Principal,
  scope: Scope,
  input: {
    readonly bridgeId: string;
    readonly fiscalYearId: string;
    readonly period: Db.PeriodRow;
    readonly currency: string;
    readonly asOf: string;
    readonly series: string;
    readonly delta: bigint;
    readonly expenseAccountId: string;
    readonly liabilityAccountId: string;
    readonly anchor: JsonObject;
  },
) {
  if (input.delta === 0n) {
    const book = (yield* Ledger.readBook(transaction, scope))[0];

    if (book === undefined) return yield* failure("Forbidden");

    const planWithoutDigest = {
      schemaVersion: "1" as const,
      canonicalization: "openerp-c14n-v1" as const,
      id: newId("taxchange"),
      version: 1 as const,
      scope: { entityId: scope.entityId, bookId: scope.bookId },
      createdAt: yield* isoNow(transaction),
      dependencies: [
        {
          kind: "profile" as const,
          resourceId: book.id,
          version: book.profileVersion.toString(),
          reason: "Book currency and supported profile",
        },
        {
          kind: "writer_epoch" as const,
          resourceId: book.id,
          version: book.writerEpoch.toString(),
          reason: "Single authoritative writer",
        },
        {
          kind: "period" as const,
          resourceId: input.period.id,
          version: input.period.version,
          reason: "Posting dates and lock state",
        },
        ...(yield* Ledger.readAccounts(transaction, scope.bookId, [
          input.expenseAccountId,
          input.liabilityAccountId,
        ])).map((account) => ({
          kind: "account" as const,
          resourceId: account.id,
          version: account.version.toString(),
          reason: "Exact account configuration",
        })),
      ],
      groups: [],
    };

    const planDigest = yield* versionedDigest(planWithoutDigest);

    yield* Ledger.insertPlan(transaction, {
      bookId: scope.bookId,
      id: planWithoutDigest.id,
      plan: yield* toJsonObject({ ...planWithoutDigest, planDigest }),
      digest: planDigest,
      createdBy: principal.actorId,
    });

    return yield* decode(Accounting.ChangeSet, { ...planWithoutDigest, planDigest });
  }

  const evidenceId = input.anchor["evidenceId"];
  const sha256 = input.anchor["sha256"];

  if (typeof evidenceId !== "string" || typeof sha256 !== "string") {
    return yield* failure("MissingEvidence");
  }

  // The event key is an idempotency key, not a claim of financial ownership. It makes
  // a retried recognition of the same bridge resolve to the same event. Nothing
  // infers ownership from it: the currentness guard proves ownership from a committed
  // corporate_tax_effect row, because any posting path can choose a key.
  const eventKey = `corporate_income_tax_${input.bridgeId.slice("taxbridge_".length)}`;
  const existing = (yield* Ledger.readEvent(transaction, scope.bookId, evidenceId, eventKey))[0];
  const eventId = existing?.id ?? newId("event");

  if (existing === undefined) {
    yield* Ledger.insertEvent(transaction, scope.bookId, eventId, evidenceId, eventKey);
  }

  const action = yield* decode(
    Accounting.VoucherPostingAction,
    yield* toJsonObject({
      kind: "post_voucher",
      correctsVoucherId: null,
      eventId,
      postingPurpose: "adjustment",
      occurrenceKey: eventKey,
      fiscalYearId: input.fiscalYearId,
      accountingPeriodId: input.period.id,
      postingDate: input.asOf,
      series: input.series,
      currency: input.currency,
      description: "Current corporate income tax for the pre-close bridge",
      rationale: `Remaining current income-tax delta for bridge ${input.bridgeId}`,
      taxAssessment: "not_applicable",
      lines: [
        {
          lineId: newId("line"),
          accountId: input.expenseAccountId,
          debitMinor: input.delta > 0n ? input.delta.toString() : "0",
          creditMinor: input.delta < 0n ? (-input.delta).toString() : "0",
          description: "Current corporate income tax expense",
        },
        {
          lineId: newId("line"),
          accountId: input.liabilityAccountId,
          debitMinor: input.delta < 0n ? (-input.delta).toString() : "0",
          creditMinor: input.delta > 0n ? input.delta.toString() : "0",
          description: "Current corporate income tax liability",
        },
      ],
      evidenceRefs: [{ evidenceId, sha256, locator: eventKey }],
    }),
  );

  return yield* sealActionInTransaction(transaction, principal, scope, action);
});

export const prepareBridge = Effect.fn("corporateTax.prepareBridge")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Tax.PrepareTaxBridge.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireTableGrants(transaction, true);

      const input = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        bridgeOperation,
        principal.actorId,
        input,
        BridgeViewSchema,
      );

      // A committed identical command returns before any new-work, dependency or
      // duplicate-economics work.
      if (request.previous) return request.previous;

      const prepared = yield* decode(Tax.PrepareTaxBridge, input);

      const captured = yield* captureBasis(
        transaction,
        command.scope,
        prepared.fiscalYearId,
        prepared.statementSnapshotId,
      );

      const references = [
        ...prepared.lossPosition.evidence.map(evidenceReference),
        ...prepared.otherIncomeTaxExpense.evidence.map(evidenceReference),
        ...prepared.adjustments.flatMap((entry) => entry.evidence.map(evidenceReference)),
        ...captured.accounts.evidence,
      ];

      for (const reference of references) {
        yield* requireRetainedEvidence(transaction, command.scope.bookId, reference);
      }

      // Pure. No database access, no HTTP, no provider call, no human wait and no
      // caller-supplied calculated effect.
      const calculated = calculateCorporateTax(
        captured.overlay,
        prepared.adjustments,
        prepared.lossPosition,
        prepared.otherIncomeTaxExpense,
        captured.recognized,
        captured.release,
      );

      if (Result.isFailure(calculated)) return yield* refusal(calculated.failure);

      const bridgeId = newId("taxbridge");
      const delta = calculated.success.currentTaxMinor - captured.recognized;
      const postsJournal = delta !== 0n;
      const expenseAccountId = accountFor(captured.overlay, "current_expense");
      const liabilityAccountId = accountFor(captured.overlay, "current_liability");

      if (expenseAccountId === null || liabilityAccountId === null) {
        return yield* failure("UnsupportedProfile");
      }

      const anchor = captured.accounts.evidence[0];

      if (anchor === undefined) return yield* failure("MissingEvidence");

      const plan = yield* sealEffectPlan(transaction, principal, command.scope, {
        bridgeId,
        fiscalYearId: captured.fiscalYear.id,
        period: captured.period,
        currency: captured.book.currency,
        asOf: captured.snapshot.asOf,
        series: captured.release.bridge.journalSeries,
        delta,
        expenseAccountId,
        liabilityAccountId,
        anchor,
      });

      const createdAt = yield* isoNow(transaction);

      const body = yield* toJsonObject({
        kind: "preclose_corporate_tax_bridge_v1",
        id: bridgeId,
        scope: command.scope,
        changeSetId: plan.id,
        planDigest: plan.planDigest,
        fiscalYearId: captured.fiscalYear.id,
        accountingPeriodId: captured.period.id,
        overlayDigest: captured.overlayDigest,
        overlay: captured.overlay,
        admissionWitness: captured.witness,
        adjustments: prepared.adjustments,
        adjustmentTotalMinor: calculated.success.adjustmentTotalMinor.toString(),
        lossBasis: {
          position: prepared.lossPosition,
          adopted: false,
          adoptionOwner: "financial_close_certificate",
          closingLossBasisMinor:
            calculated.success.closingLossBasisMinor === null
              ? null
              : calculated.success.closingLossBasisMinor.toString(),
          closingLossBasisAvailable: calculated.success.closingLossBasisMinor !== null,
        },
        otherSupportedIncomeTaxExpense: prepared.otherIncomeTaxExpense,
        rows: calculated.success.rows,
        formula: calculated.success.formula,
        taxableBeforeLossMinor: calculated.success.taxableBeforeLossMinor.toString(),
        allowedLossOffsetMinor: calculated.success.allowedLossOffsetMinor.toString(),
        taxableIncomeMinor: calculated.success.taxableIncomeMinor.toString(),
        currentTaxTargetMinor: calculated.success.currentTaxMinor.toString(),
        projectedAfterTaxResultMinor: calculated.success.projectedAfterTaxResultMinor.toString(),
        recognizedCurrentTaxMinor: captured.recognized.toString(),
        remainingCurrentTaxDeltaMinor: delta.toString(),
        journalSeries: captured.release.bridge.journalSeries,
        postsJournal,
        mappingRelease: {
          id: captured.releaseRow.id,
          checksum: captured.releaseRow.checksum,
          version: captured.releaseRow.version,
          calculatorVersion: captured.release.calculatorVersion,
        },
        createdBy: principal.actorId,
        createdAt,
        noFinancialEffect: true,
        receipt: commandReceipt(command.idempotencyKey, bridgeOperation, principal.actorId),
      });

      const digest = yield* digestJson(body, "StaleDependency");
      const bridge = yield* decode(BridgeSchema, { ...body, digest });

      yield* Db.insertBridge(transaction, {
        createdAt,
        bookId: command.scope.bookId,
        id: bridgeId,
        fiscalYearId: captured.fiscalYear.id,
        accountingPeriodId: captured.period.id,
        statementSnapshotId: captured.snapshot.id,
        statementDigest: captured.overlay.statementDigest,
        changeSetId: plan.id,
        planDigest: plan.planDigest,
        ruleReleaseId: captured.releaseRow.id,
        ruleReleaseChecksum: captured.releaseRow.checksum,
        ruleReleaseVersion: captured.releaseRow.version,
        overlayDigest: captured.overlayDigest,
        currentTaxTargetMinor: calculated.success.currentTaxMinor.toString(),
        recognizedMinor: captured.recognized.toString(),
        deltaMinor: delta.toString(),
        postsJournal,
        noFinancialEffect: true,
        body: yield* toJsonObject(bridge),
        digest,
        createdBy: principal.actorId,
      });

      const membershipEpoch = captured.membership[0]?.membershipEpoch.toString() ?? "0";

      const inputs = [
        {
          kind: "statement_snapshot",
          resourceId: captured.snapshot.id,
          version: captured.overlay.statementDigest,
          reason: "Exact retained statement snapshot this pre-tax population was derived from",
        },
        {
          kind: "rule_release",
          resourceId: captured.releaseRow.id,
          version: captured.releaseRow.checksum,
          reason: `Reviewed corporate-tax rule release for calculator ${captured.release.calculatorVersion}`,
        },
        ...(captured.witness.activationId === null
          ? []
          : [
              {
                kind: "company_activation",
                resourceId: captured.witness.activationId,
                version: captured.witness.activationId,
                reason:
                  "Corporate-tax family admission activation current on the fiscal period end",
              },
            ]),
        {
          kind: "company_family_membership",
          resourceId: "corporate_tax",
          version: membershipEpoch,
          reason: "Corporate-tax family admission epoch current at sealing",
        },
        ...captured.witness.factRevisionIds.map((id) => ({
          kind: "company_fact_revision",
          resourceId: id,
          version: id,
          reason: "Exact reviewed company fact revision",
        })),
        ...captured.witness.factReviewIds.map((id) => ({
          kind: "company_fact_review",
          resourceId: id,
          version: id,
          reason: "Independent review of that fact revision",
        })),
        ...captured.accounts.accounts.map((entry) => ({
          kind: "company_role_binding",
          resourceId: entry.roleBindingId,
          version: entry.accountVersion,
          reason: `Reviewed ${entry.roleKind} binding supplying the income-tax account`,
        })),
        {
          kind: "accounting_period",
          resourceId: captured.period.id,
          version: captured.period.version,
          reason: "Period holding the retained as-of date for the current-tax accrual",
        },
        {
          kind: "book",
          resourceId: captured.book.id,
          version: captured.book.profileVersion.toString(),
          reason: "Book currency, scale and supported profile",
        },
        ...prepared.adjustments.map((entry) => ({
          kind: "tax_adjustment",
          resourceId: entry.id,
          version: entry.ruleRelease,
          reason: `Reviewed ${entry.kind} adjustment over ${entry.economicComponentIdentity}`,
        })),
        {
          kind: "loss_position",
          resourceId: "reviewed_loss_position",
          version: prepared.lossPosition.state,
          reason:
            "Reviewed loss position supplying the available offset; a draft adopts none of it",
        },
        {
          kind: "other_income_tax_support",
          resourceId: prepared.otherIncomeTaxExpense.state,
          version: prepared.otherIncomeTaxExpense.state,
          reason: "Reviewed support for the other income-tax expense",
        },
      ];

      yield* Db.insertBridgeInputs(
        transaction,
        inputs.map((reference, index) => ({
          bookId: command.scope.bookId,
          bridgeId,
          ordinal: index + 1,
          kind: reference.kind,
          resourceId: reference.resourceId,
          version: reference.version,
          reason: reference.reason,
        })),
      );

      const view = yield* bridgeView(transaction, command.scope, bridge, captured.recognized);

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        bridgeOperation,
        principal.actorId,
        yield* toJsonObject(view),
      );

      return view;
    },
    "update",
  );
});

export const getBridge = Effect.fn("corporateTax.getBridge")(function* (
  token: string,
  command: { scope: Scope; bridgeId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableGrants(transaction, false);

    const row = (yield* Db.readBridge(transaction, command.scope.bookId, command.bridgeId))[0];

    if (row === undefined) return yield* failure("NotFound");

    const bridge = yield* decode(BridgeSchema, row.body);

    const recognizedRow = (yield* Db.readRecognizedForYear(
      transaction,
      command.scope.bookId,
      row.fiscalYearId,
    ))[0];

    if (recognizedRow === undefined) return yield* failure("InternalError");

    return yield* bridgeView(transaction, command.scope, bridge, BigInt(recognizedRow.minor));
  });
});

export const listBridges = Effect.fn("corporateTax.listBridges")(function* (
  token: string,
  command: { scope: Scope; fiscalYearId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableGrants(transaction, false);

    const rows = yield* Db.readBridgesAfter(
      transaction,
      command.scope.bookId,
      command.fiscalYearId,
      command.after ?? "",
    );

    const page = rows.slice(0, 25);
    const items = yield* Effect.forEach(page, (row) => decode(BridgeSchema, row.body));

    return yield* decode(BridgePageSchema, {
      scope: command.scope,
      fiscalYearId: command.fiscalYearId,
      items,
      next: rows.length > page.length ? (page.at(-1)?.id ?? null) : null,
    });
  });
});

// The whole basis is re-resolved inside the executing transaction. A sealed bridge,
// a selected book, a cached permission or a job payload is not authority for a
// changed pre-tax population, a changed release or a changed role binding. The
// recognised total and the sealed target are returned together so the delta is only
// ever recomputed from facts that still match the approved basis.
const revalidateBasis = Effect.fn("corporateTax.revalidateBasis")(function* (
  transaction: Transaction,
  scope: Scope,
  bridge: typeof Tax.TaxBridge.Type,
  sealed: Db.BridgeRow,
  executed = false,
) {
  const fiscalYear = (yield* Ledger.readFiscalYear(
    transaction,
    scope.bookId,
    sealed.fiscalYearId,
  ))[0];

  if (fiscalYear === undefined) return yield* failure("NotFound");

  const resolved = yield* resolveCompanyProfileInTransaction(
    transaction,
    scope,
    "actual_company",
    profileDates(fiscalYear.endsOn),
  );

  const witness =
    resolved.families.find((entry) => entry.family === "corporate_tax")?.witness ?? null;

  const admission = bridge.admissionWitness;

  if (
    witness === null ||
    witness.jurisdiction !== admission.jurisdiction ||
    witness.selectorDate !== admission.selectorDate ||
    witness.ruleReleaseId !== sealed.ruleReleaseId ||
    witness.ruleReleaseChecksum !== sealed.ruleReleaseChecksum ||
    witness.activationId !== admission.activationId ||
    !equalLists(witness.factRevisionIds, admission.factRevisionIds) ||
    !equalLists(witness.factReviewIds, admission.factReviewIds) ||
    !equalLists(witness.roleBindingIds, admission.roleBindingIds)
  ) {
    return null;
  }

  const releaseRow = (yield* ProfileDb.readRuleReleases(transaction, "corporate_tax")).find(
    (row) => row.id === sealed.ruleReleaseId,
  );

  if (releaseRow === undefined || releaseRow.checksum !== sealed.ruleReleaseChecksum) return null;

  const statement = yield* readRetainedStatement(transaction, scope, sealed.statementSnapshotId);

  if (statement.digest !== sealed.statementDigest) return null;

  // The same currentness boundary as capture, re-evaluated inside the executing
  // transaction. An immutable snapshot proves the bytes did not change; it cannot
  // prove the population behind them did not.
  if (!(yield* statementIsCurrent(transaction, scope.bookId, statement.snapshot))) return null;

  const bindings = yield* ProfileDb.readRoleBindings(
    transaction,
    scope.bookId,
    fiscalYear.startsOn,
    fiscalYear.endsOn,
  );

  const accounts = yield* incomeTaxAccounts(bindings, witness.roleBindingIds);

  if (accounts === null || accounts.accounts.length !== bridge.overlay.incomeTaxAccounts.length) {
    return null;
  }

  for (const entry of accounts.accounts) {
    const sealedAccount = bridge.overlay.incomeTaxAccounts.find(
      (candidate) => candidate.roleKind === entry.roleKind,
    );

    if (
      sealedAccount === undefined ||
      sealedAccount.roleBindingId !== entry.roleBindingId ||
      sealedAccount.accountId !== entry.accountId
    ) {
      return null;
    }
  }

  const recognizedRow = (yield* Db.readRecognizedForYear(
    transaction,
    scope.bookId,
    sealed.fiscalYearId,
  ))[0];

  if (recognizedRow === undefined) return yield* failure("InternalError");

  const recognized = BigInt(recognizedRow.minor);
  const target = BigInt(sealed.currentTaxTargetMinor);
  const delta = target - recognized;

  if (
    executed
      ? recognized !== target
      : recognized !== BigInt(sealed.recognizedMinor) || delta !== BigInt(sealed.deltaMinor)
  )
    return null;

  return { recognized, target, delta };
});

// Consumed by financial close through the same transaction. The already executed
// target still needs its current reviewed facts, roles, release and population.
export const executedBridgeIsCurrent = Effect.fn("corporateTax.executedBridgeIsCurrent")(function* (
  transaction: Transaction,
  scope: Scope,
  bridge: typeof Tax.TaxBridge.Type,
  sealed: Db.BridgeRow,
) {
  return (yield* revalidateBasis(transaction, scope, bridge, sealed, true)) !== null;
});

export const executeEffect = Effect.fn("corporateTax.executeEffect")(function* (
  token: string,
  command: {
    scope: Scope;
    bridgeId: string;
    idempotencyKey: string;
    input: typeof Tax.ExecuteTaxEffect.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireTableGrants(transaction, true);

      const input = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        effectOperation,
        principal.actorId,
        { id: command.bridgeId, input },
        EffectSchema,
      );

      if (request.previous) return request.previous;

      // Lock order. withBook already admitted the credential and took the book row
      // for update, so the book is held before anything else here. Then the period
      // and the two income-tax accounts, then this bridge, then the approval, then
      // the counters. The bridge is read unlocked first only to learn which period
      // and accounts to lock; the locked row is re-decoded and its digest compared,
      // so the read-then-lock window cannot slip a different bridge through.
      const read = (yield* Db.readBridge(transaction, command.scope.bookId, command.bridgeId))[0];

      if (read === undefined) return yield* failure("NotFound");

      const preview = yield* decode(BridgeSchema, read.body);

      if (preview.digest !== command.input.bridgeDigest) return yield* failure("StaleDependency");

      const period = (yield* Ledger.readPeriod(
        transaction,
        command.scope.bookId,
        preview.accountingPeriodId,
      ))[0];

      if (period === undefined || period.locked) return yield* failure("PeriodLocked");

      const expenseAccountId = accountFor(preview.overlay, "current_expense");
      const liabilityAccountId = accountFor(preview.overlay, "current_liability");

      if (expenseAccountId === null || liabilityAccountId === null) {
        return yield* failure("UnsupportedProfile");
      }

      const accounts = yield* Ledger.readAccounts(transaction, command.scope.bookId, [
        expenseAccountId,
        liabilityAccountId,
      ]);

      if (accounts.length !== 2) return yield* failure("UnsupportedProfile");

      const sealed = (yield* Db.lockBridge(transaction, command.scope.bookId, command.bridgeId))[0];

      if (sealed === undefined) return yield* failure("NotFound");

      const bridge = yield* decode(BridgeSchema, sealed.body);

      if (bridge.digest !== command.input.bridgeDigest) return yield* failure("StaleDependency");

      // A committed effect owns this year target. A different key cannot authorize a
      // second posting of the same economic event.
      if (
        (yield* Db.readEffectByBridge(transaction, command.scope.bookId, command.bridgeId)).length >
        0
      ) {
        return yield* failure("AlreadyPosted");
      }

      // The effective prior tax effects, the year target and the whole admission
      // witness must still match the approved basis. A changed recognition since
      // sealing refuses; it never re-derives a different amount against the same
      // approval.
      const current = yield* revalidateBasis(transaction, command.scope, bridge, sealed);

      if (current === null) return yield* failure("StaleDependency");

      const { recognized, target, delta } = current;

      // The approval is validated, never created here. A second operator approved
      // this exact sealed plan digest through the shared approval endpoint, so the
      // current-tax effect keeps its four-eyes separation and an agent credential
      // cannot authorize its own accrual.
      //
      // This read is a shared lock and takes only the approver. Locking the approval
      // for update here would invert domain-resources-before-approval, because the
      // shared journal primitive has not yet taken the plan. Nothing mutable is read
      // outside the lock: `approvals` is only ever updated for `consumedAt`, so
      // `actorId` is immutable, and each branch below performs the one authoritative
      // validation and write lock in the reviewed order.
      const approver = (yield* Ledger.readApproval(
        transaction,
        command.scope.bookId,
        command.input.approvalId,
      ))[0];

      if (approver === undefined || approver.changeSetId !== sealed.changeSetId) {
        return yield* failure("ApprovalRequired");
      }

      if (approver.digest !== sealed.planDigest) return yield* failure("ApprovalRequired");

      if (approver.actorId === principal.actorId) return yield* failure("ApprovalRequired");

      const posting = sealed.postsJournal
        ? yield* executeChangeInTransaction(transaction, principal, {
            scope: command.scope,
            changeSetId: sealed.changeSetId,
            idempotencyKey: newId("taxpost"),
            input: {
              version: 1,
              planDigest: sealed.planDigest,
              approvalId: command.input.approvalId,
            },
            owner: { kind: "corporate_income_tax", id: bridge.id },
          })
        : null;

      const committedAt = posting === null ? yield* isoNow(transaction) : posting.committedAt;

      // The retained receipt identity is the one that was actually written, never a
      // freshly minted one. A nonzero recognition reads back the group receipt the
      // shared primitive committed; a zero-delta recognition writes its own
      // approved no-effect receipt and retains that.
      let groupReceiptId: string;

      if (posting === null) {
        // A genuinely zero plan still proves its own dependencies. It bypasses the
        // shared journal primitive, so it validates the same sealed plan itself
        // rather than trusting a plan nothing checked.
        const planRow = (yield* Db.readPlan(
          transaction,
          command.scope.bookId,
          sealed.changeSetId,
        ))[0];

        if (planRow === undefined) return yield* failure("StaleDependency");

        const plan = yield* decode(Accounting.ChangeSet, planRow.plan);

        if (plan.id !== sealed.changeSetId || plan.planDigest !== sealed.planDigest) {
          return yield* failure("StaleDependency");
        }

        if (plan.groups.length !== 0) return yield* failure("StaleDependency");

        yield* validatePlan(transaction, command.scope, plan);

        const approval = yield* readExecutionApprovalInTransaction(
          transaction,
          command.scope,
          { id: sealed.changeSetId, planDigest: sealed.planDigest },
          command.input.approvalId,
        );

        const receipt = newId("taxreceipt");
        const groupId = newId("taxgroup");

        yield* Ledger.insertGroupReceipt(transaction, {
          bookId: command.scope.bookId,
          id: receipt,
          changeSetId: sealed.changeSetId,
          groupId,
          planDigest: sealed.planDigest,
          body: yield* toJsonObject({
            id: receipt,
            changeSetId: sealed.changeSetId,
            groupId,
            planDigest: sealed.planDigest,
            noFinancialEffect: true,
            bridgeId: bridge.id,
            approvalId: approval.id,
            journalIds: [],
            committedAt,
          }),
          committedAt,
        });

        yield* Ledger.insertApprovalConsumption(transaction, {
          bookId: command.scope.bookId,
          approvalId: approval.id,
          changeSetId: sealed.changeSetId,
          groupId,
          planDigest: sealed.planDigest,
          receiptId: receipt,
          approverId: approval.actorId,
          consumedById: principal.actorId,
          consumedAt: committedAt,
        });

        if (
          (yield* Ledger.consumeApproval(
            transaction,
            command.scope.bookId,
            approval.id,
            committedAt,
          )).length !== 1
        ) {
          return yield* failure("InternalError");
        }

        groupReceiptId = receipt;
      } else {
        const receipts = yield* Db.readGroupReceiptsForChangeSet(
          transaction,
          command.scope.bookId,
          sealed.changeSetId,
        );

        if (receipts.length !== 1) return yield* failure("InternalError");

        const written = receipts[0];

        if (written === undefined || written.planDigest !== sealed.planDigest) {
          return yield* failure("InternalError");
        }

        groupReceiptId = written.id;
      }

      const body = yield* toJsonObject({
        kind: "current_income_tax_effect_v1",
        id: newId("taxeffect"),
        scope: command.scope,
        bridgeId: bridge.id,
        bridgeDigest: bridge.digest,
        changeSetId: sealed.changeSetId,
        fiscalYearId: sealed.fiscalYearId,
        statementSnapshotId: sealed.statementSnapshotId,
        statementDigest: sealed.statementDigest,
        mappingReleaseId: sealed.ruleReleaseId,
        mappingReleaseChecksum: sealed.ruleReleaseChecksum,
        yearTaxTargetMinor: target.toString(),
        recognizedBeforeMinor: recognized.toString(),
        deltaMinor: delta.toString(),
        recognizedAfterMinor: (recognized + delta).toString(),
        voucherId: posting === null ? null : posting.voucherId,
        postingReceipt: posting === null ? null : yield* toJsonObject(posting),
        approvalId: command.input.approvalId,
        groupReceiptId,
        noFinancialEffect: posting === null,
        economicIdentity: `corporate_income_tax:${sealed.fiscalYearId}`,
        committedAt,
        createdBy: principal.actorId,
        receipt: commandReceipt(command.idempotencyKey, effectOperation, principal.actorId),
      });

      const digest = yield* digestJson(body, "StaleDependency");
      const effect = yield* decode(EffectSchema, { ...body, digest });

      yield* Db.insertEffect(transaction, {
        bookId: command.scope.bookId,
        id: effect.id,
        bridgeId: bridge.id,
        changeSetId: sealed.changeSetId,
        fiscalYearId: sealed.fiscalYearId,
        voucherId: effect.voucherId,
        approvalId: command.input.approvalId,
        yearTaxTargetMinor: target.toString(),
        recognizedBeforeMinor: recognized.toString(),
        deltaMinor: delta.toString(),
        recognizedAfterMinor: (recognized + delta).toString(),
        noFinancialEffect: effect.noFinancialEffect,
        body: yield* toJsonObject(effect),
        digest,
        createdBy: principal.actorId,
        committedAt,
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        effectOperation,
        principal.actorId,
        yield* toJsonObject(effect),
      );

      return effect;
    },
    "update",
  );
});

export const listEffects = Effect.fn("corporateTax.listEffects")(function* (
  token: string,
  command: { scope: Scope; fiscalYearId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableGrants(transaction, false);

    const rows = yield* Db.readEffectsAfter(
      transaction,
      command.scope.bookId,
      command.fiscalYearId,
      command.after ?? "",
    );

    const page = rows.slice(0, 200);
    const items = yield* Effect.forEach(page, (row) => decode(EffectSchema, row.body));

    const recognizedRow = (yield* Db.readRecognizedForYear(
      transaction,
      command.scope.bookId,
      command.fiscalYearId,
    ))[0];

    if (recognizedRow === undefined) return yield* failure("InternalError");

    return yield* decode(EffectPageSchema, {
      scope: command.scope,
      fiscalYearId: command.fiscalYearId,
      recognizedTotalMinor: recognizedRow.minor,
      items,
    });
  });
});

// The five reconciling fields a declaration must carry, each named by the reviewed
// mapping, so the independent re-parse can recompute the form's own total from the
// produced bytes instead of from the renderer's memory.
const reconciliationField = (
  fields: ReadonlyArray<typeof Tax.PreparedIncomeTaxField.Type>,
  source: typeof Tax.FieldSource.Type,
) => fields.find((field) => field.source === source && field.required);

export const prepareDeclaration = Effect.fn("corporateTax.prepareDeclaration")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Tax.PrepareTaxDeclaration.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireTableGrants(transaction, true);

      const input = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        declarationOperation,
        principal.actorId,
        input,
        DeclarationSchema,
      );

      if (request.previous) return request.previous;

      const prepared = yield* decode(Tax.PrepareTaxDeclaration, input);

      const sealed = (yield* Db.readBridge(
        transaction,
        command.scope.bookId,
        prepared.bridgeId,
      ))[0];

      if (sealed === undefined) return yield* failure("NotFound");

      const bridge = yield* decode(BridgeSchema, sealed.body);

      const releaseRow = (yield* ProfileDb.readRuleReleases(transaction, "corporate_tax")).find(
        (row) => row.id === sealed.ruleReleaseId,
      );

      if (releaseRow === undefined || releaseRow.checksum !== sealed.ruleReleaseChecksum) {
        return yield* failure("StaleDependency");
      }

      const outer = Option.getOrNull(
        Schema.decodeUnknownOption(Profiles.RuleRelease)(releaseRow.body),
      );

      if (outer === null || outer.corporateTax === undefined)
        return yield* failure("StaleDependency");

      const release = outer.corporateTax;

      if (release.calculatorVersion !== Tax.SupportedCalculatorVersion) {
        return yield* failure("UnsupportedProfile");
      }

      // The lineage derives from the exact retained statement this bridge bound to,
      // so the engine and the exported form start from one result instead of two.
      const statement = yield* readRetainedStatement(
        transaction,
        command.scope,
        sealed.statementSnapshotId,
      );

      if (statement.digest !== sealed.statementDigest) return yield* failure("StaleDependency");

      // The engine and the exported form start from one result. A ledger declaration
      // uses the retained statement's own result; a projected declaration uses the
      // bridge's projected after-tax result, and the mapping says which one it is.
      const declaredResult =
        prepared.declaredResultSource === "ledger_statement_result"
          ? BigInt(bridge.overlay.retainedStatementResultMinor)
          : null;

      const preparedFields = prepareIncomeTaxFields(
        bridge,
        prepared.declaredResultSource,
        declaredResult,
        statement.amounts,
        release,
      );

      if (Result.isFailure(preparedFields)) return yield* refusal(preparedFields.failure);

      const blocked = preparedFields.success.blockReasons.length > 0;

      const highest = (yield* Db.readHighestDeclarationOrdinal(
        transaction,
        command.scope.bookId,
      ))[0];

      const ordinal = BigInt(highest?.ordinal ?? "0") + 1n;

      if (ordinal > 9223372036854775807n) return yield* failure("UnsupportedProfile");

      // A blocked lineage renders no file at all. The bytes are produced and
      // independently re-parsed, and only the exact verified bytes are retained.
      const files: Array<typeof Tax.SruFileManifest.Type> = [];

      if (!blocked) {
        const rendered = renderSru(preparedFields.success.fields, release.sru);

        if (Result.isFailure(rendered)) return yield* refusal(rendered.failure);

        const addback = reconciliationField(
          preparedFields.success.fields,
          taxAddbackSource(prepared.declaredResultSource),
        );

        const adjustment = reconciliationField(preparedFields.success.fields, "adjustment_total");

        const beforeLoss = reconciliationField(
          preparedFields.success.fields,
          "taxable_before_loss",
        );

        const offset = reconciliationField(preparedFields.success.fields, "allowed_loss_offset");
        const taxable = reconciliationField(preparedFields.success.fields, "taxable_income");

        if (
          addback === undefined ||
          adjustment === undefined ||
          beforeLoss === undefined ||
          offset === undefined ||
          taxable === undefined
        ) {
          return yield* failure("UnsupportedProfile");
        }

        const expected = {
          declaredResultMinor: BigInt(preparedFields.success.reconciliation.declaredResultMinor),
          addbackKey: `${addback.formId}/${addback.fieldCode}`,
          adjustmentKey: `${adjustment.formId}/${adjustment.fieldCode}`,
          beforeLossKey: `${beforeLoss.formId}/${beforeLoss.fieldCode}`,
          offsetKey: `${offset.formId}/${offset.fieldCode}`,
          taxableKey: `${taxable.formId}/${taxable.fieldCode}`,
          fields: preparedFields.success.fields.map((field) => ({
            key: `${field.formId}/${field.fieldCode}`,
            valueMinor: BigInt(field.valueMinor),
          })),
        };

        const sealedAt = yield* isoNow(transaction);

        for (const file of rendered.success.files) {
          const reparse = reparseSru(file, release.sru, expected);

          if (!reparse.lexicallyValid) {
            return yield* refusal({
              code: "UnreconciledDeclaration",
              message: "The rendered SRU bytes failed an independent re-parse.",
            });
          }

          files.push({
            kind: file.kind,
            filename: file.filename,
            encoding: file.encoding,
            mediaType: "application/octet-stream",
            byteLength: file.byteLength,
            sha256: yield* sha256HexOf(file.bytes),
            recordCount: file.recordCount,
            fieldCount: file.fieldCount,
            contentBase64: base64(file.bytes),
            sealedAt,
            validation: {
              checkedBy: "independent_sru_reparse_v1",
              lexicallyValid: reparse.lexicallyValid,
              recordsReparsed: reparse.records,
              fieldsReparsed: reparse.fields,
              crossFieldTotalsCompared: reparse.crossFieldTotals,
              fieldTypesCompared: reparse.types,
              destinationAcceptance: "not_established",
            },
          });
        }
      }

      const createdAt = yield* isoNow(transaction);

      const body = yield* toJsonObject({
        kind: "income_tax_declaration_v1",
        id: newId("taxdecl"),
        ordinal: ordinal.toString(),
        scope: command.scope,
        bridgeId: bridge.id,
        bridgeDigest: bridge.digest,
        statementSnapshotId: sealed.statementSnapshotId,
        statementDigest: sealed.statementDigest,
        fiscalYear: bridge.overlay.fiscalYear,
        asOf: bridge.overlay.asOf,
        mappingRelease: {
          id: sealed.ruleReleaseId,
          checksum: sealed.ruleReleaseChecksum,
          version: sealed.ruleReleaseVersion,
          calculatorVersion: release.calculatorVersion,
        },
        formRelease: {
          formVersion: release.declaration.formVersion,
          formIds: release.declaration.formIds,
          fieldMapChecksum: release.declaration.fieldMapChecksum,
        },
        declaredResultSource: prepared.declaredResultSource,
        fields: preparedFields.success.fields,
        reconciliation: preparedFields.success.reconciliation,
        blocked,
        blockReasons: preparedFields.success.blockReasons,
        files,
        noFinancialEffect: true,
        createdBy: principal.actorId,
        createdAt,
        receipt: commandReceipt(command.idempotencyKey, declarationOperation, principal.actorId),
      });

      const digest = yield* versionedDigest(body, "StaleDependency");
      const declaration = yield* decode(DeclarationSchema, { ...body, digest });

      yield* Db.insertDeclaration(transaction, {
        bookId: command.scope.bookId,
        id: declaration.id,
        ordinal,
        bridgeId: bridge.id,
        fiscalYearId: bridge.overlay.fiscalYear.id,
        statementSnapshotId: sealed.statementSnapshotId,
        fieldCount: declaration.fields.length,
        fileCount: files.length,
        blocked,
        noFinancialEffect: true,
        body: yield* toJsonObject(declaration),
        digest,
        createdBy: principal.actorId,
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        declarationOperation,
        principal.actorId,
        yield* toJsonObject(declaration),
      );

      return declaration;
    },
    "update",
  );
});

export const getDeclaration = Effect.fn("corporateTax.getDeclaration")(function* (
  token: string,
  command: { scope: Scope; declarationId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableGrants(transaction, false);

    const row = (yield* Db.readDeclaration(
      transaction,
      command.scope.bookId,
      command.declarationId,
    ))[0];

    if (row === undefined) return yield* failure("NotFound");

    return yield* decode(DeclarationSchema, row.body);
  });
});

export const listDeclarations = Effect.fn("corporateTax.listDeclarations")(function* (
  token: string,
  command: { scope: Scope; fiscalYearId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableGrants(transaction, false);

    const rows = yield* Db.readDeclarationsAfter(
      transaction,
      command.scope.bookId,
      command.fiscalYearId,
      command.after ?? "",
    );

    const page = rows.slice(0, 25);
    const items = yield* Effect.forEach(page, (row) => decode(DeclarationSchema, row.body));

    return yield* decode(DeclarationPageSchema, {
      scope: command.scope,
      fiscalYearId: command.fiscalYearId,
      items,
      next: rows.length > page.length ? (page.at(-1)?.id ?? null) : null,
    });
  });
});
