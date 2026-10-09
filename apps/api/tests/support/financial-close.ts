import * as Accounting from "@open-erp/contracts/accounting";
import * as Closing from "@open-erp/contracts/closing";
import * as Close from "@open-erp/contracts/financial-close";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Reports from "@open-erp/contracts/reports";
import * as Statements from "@open-erp/contracts/report-statements";
import * as Tax from "@open-erp/contracts/corporate-tax";
import * as Schema from "effect/Schema";
import { database, evidence, execute, fixture, journal, post, type BookFixture } from "./fixtures";
import { syntheticQualification } from "./rule-qualification";

export const closePath = "/closing/financial-years";

export const mapping: Statements.StatementMapping = {
  version: "semantic_statement_mapping_v1",
  reviewed: true,
  framework: "Declared synthetic NEXT-23 vector",
  effectiveFiscalRules: { status: "pending_company_profile", owner: "company_profile_contract" },
  accountRoleRules: [
    { accountId: "account_bank", role: "asset" },
    { accountId: "account_clearing", role: "liability" },
    { accountId: "account_income", role: "income" },
    { accountId: "account_expense", role: "expense" },
    { accountId: "account_tax", role: "expense" },
    { accountId: "account_transfer", role: "expense" },
    { accountId: "account_equity", role: "equity" },
  ],
  leafRows: [
    {
      rowId: "cash_total",
      label: "Cash",
      statement: "balance_sheet",
      side: "debit",
      contributionRoles: ["asset"],
    },
    {
      rowId: "liabilities_total",
      label: "Liabilities",
      statement: "balance_sheet",
      side: "credit",
      contributionRoles: ["liability"],
    },
    {
      rowId: "equity_total",
      label: "Equity",
      statement: "balance_sheet",
      side: "credit",
      contributionRoles: ["equity"],
    },
    {
      rowId: "income_total",
      label: "Income",
      statement: "profit_and_loss",
      side: "credit",
      contributionRoles: ["income"],
    },
    {
      rowId: "expense_total",
      label: "Expense",
      statement: "profit_and_loss",
      side: "debit",
      contributionRoles: ["expense"],
    },
  ],
  subtotalDAG: [
    { nodeId: "assets_subtotal", label: "Assets", members: [{ rowId: "cash_total", sign: 1 }] },
  ],
  mechanicalTransferRoles: ["expense"],
  comparativePolicy: "own_mapping_with_classification_change_display",
};

export function capture(book: BookFixture, year = "2026", asOf = `${year}-12-31`) {
  return post(
    book,
    "/statement-snapshots",
    {
      fiscalYearId: `fy_${year}`,
      asOf,
      plStartsOn: `${year}-01-01`,
      plEndsOn: asOf,
      mapping,
    },
    Statements.StatementSnapshot,
  );
}

export async function movement(book: BookFixture, debit: string, credit: string, minor: string) {
  const source = await evidence(book);
  const input = journal(source.id, minor);

  const plan = await post(
    book,
    "/change-sets",
    {
      ...input,
      lines: input.lines.map((line, index) => ({
        ...line,
        accountId: index === 0 ? debit : credit,
      })),
    },
    Accounting.ChangeSet,
  );

  return execute(book, plan);
}

export async function closeFixture(revenue = "75000") {
  const book = await fixture([
    { id: "account_income", code: "3000", name: "Synthetic income" },
    { id: "account_expense", code: "6000", name: "Synthetic expense" },
    { id: "account_tax", code: "8910", name: "Synthetic tax expense" },
    { id: "account_transfer", code: "8999", name: "Result transfer" },
    { id: "account_equity", code: "2099", name: "Year result" },
  ]);

  const other = await fixture();
  const reviewer = { ...book, token: other.token, actorId: other.actorId };
  const source = await evidence(book);
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
    await admin.query(
      "insert into openerp.fiscal_years(book_id,id,starts_on,ends_on) values($1,'fy_2027','2027-01-01','2027-12-31')",
      [book.bookId],
    );
    await admin.query(
      "insert into openerp.periods(book_id,id,fiscal_year_id,starts_on,ends_on) values($1,'period_2027','fy_2027','2027-01-01','2027-12-31')",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  const ref = { evidenceId: source.id, sha256: source.sha256 };

  const fact = await post(
    book,
    "/company-facts",
    {
      factKind: "jurisdiction",
      value: { state: "known", value: "ZZ" },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: null,
      evidence: [ref],
      note: "Synthetic jurisdiction; not a company qualification",
    },
    Profiles.FactRevision,
  );

  await post(
    reviewer,
    `/company-facts/${fact.id}/reviews`,
    {
      factRevisionId: fact.id,
      expectedDigest: fact.digest,
      result: "confirmed",
      rationale: "Review declared synthetic data only",
    },
    Profiles.FactReview,
  );

  for (const [roleKind, accountId] of [
    ["corporate_tax_expense", "account_tax"],
    ["corporate_tax_liability", "account_clearing"],
  ]) {
    await post(
      book,
      "/company-role-bindings",
      {
        roleKind,
        accountId,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        reviewer: reviewer.actorId,
        evidence: [ref],
        note: "Declared synthetic tax role",
      },
      Profiles.RoleBinding,
    );
  }

  await installTaxRelease();

  if (revenue !== "0") await movement(book, "account_bank", "account_income", revenue);

  return { book, reviewer, other, source, ref };
}

async function installTaxRelease() {
  const release = Schema.decodeSync(Profiles.RuleRelease)({
    id: "release_next23_synthetic",
    jurisdiction: "ZZ",
    family: "corporate_tax",
    version: 1,
    checksum: `sha256:${"1".repeat(64)}`,
    applicability: {
      legalForms: [],
      accountingMethods: [],
      vatRegistrations: [],
      payrollRegistrations: [],
    },
    requiredFactKinds: ["jurisdiction"],
    requiredRoleKinds: ["corporate_tax_expense", "corporate_tax_liability"],
    calculatorVersion: Tax.SupportedCalculatorVersion,
    rounding: { mode: "half_up", scale: 2 },
    validFrom: "2026-01-01",
    validTo: "2027-12-31",
    sourceManifest: "Synthetic 1/5 vector; no statutory claim",
    qualificationStatus: "reviewed",
    recordClasses: ["actual_company", "synthetic"],
    qualification: syntheticQualification(`sha256:${"1".repeat(64)}`, "2026-01-01", "2027-12-31"),
    corporateTax: {
      calculatorVersion: Tax.SupportedCalculatorVersion,
      bridge: {
        rate: { numerator: "1", denominator: "5" },
        currentTaxRounding: { mode: "half_up", scale: 2 },
        taxableBaseRounding: { mode: "half_up", scale: 2 },
        lossProfile: "no_special_restrictions",
        journalSeries: "T",
        nonOverlappingAdjustments: [],
        rateSourceReference: "Synthetic exact vector",
      },
      declaration: {
        formVersion: "synthetic",
        formIds: ["SYN"],
        fieldMap: [
          {
            fieldCode: "TAX",
            label: "Tax",
            formId: "SYN",
            source: "current_tax",
            statementRowId: null,
            sign: 1,
            format: { kind: "integer_minor" },
            required: true,
          },
        ],
        requiredReconciliationSources: ["current_tax"],
        submitter: {
          submitterRole: "declarant",
          declarantId: null,
          contactName: "Synthetic",
          contactEmail: "synthetic@example.invalid",
          contactPhone: "000",
        },
        fieldMapChecksum: "1".repeat(64),
      },
      sru: {
        encoding: "utf-8",
        lineEnding: "lf",
        recordNameValueSeparator: " ",
        fieldValueSeparator: " ",
        blankLetterRecord: "FORM",
        uppgiftRecord: "FIELD",
        infoRecordPrefix: "INFO",
        infoFile: {
          filename: "INFO.SYN",
          records: [{ tag: "SYN", value: "synthetic" }],
          terminator: "END",
        },
        blanketLetterFile: {
          filename: "FORM.SYN",
          forms: [{ formId: "SYN", fieldCodes: ["TAX"], terminator: "END" }],
          fileTerminator: "EOF",
        },
        maximumFileBytes: 10000,
        maximumFieldValueLength: 100,
        sourceReference: "Synthetic unused declaration grammar",
      },
    },
  });

  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'ZZ','corporate_tax',1,$2,$3) on conflict(id) do nothing",
      [release.id, release.checksum, JSON.stringify(release)],
    );
  } finally {
    await admin.end();
  }
}

export async function taxBridge(
  context: Awaited<ReturnType<typeof closeFixture>>,
  retained?: typeof Statements.StatementSnapshot.Type,
) {
  const snapshot = retained ?? (await capture(context.book));

  const support = {
    state: "evidenced_zero",
    evidence: [context.ref],
    note: "Explicit synthetic zero other tax and losses",
  };

  const view = await post(
    context.book,
    "/corporate-tax/bridges",
    {
      fiscalYearId: "fy_2026",
      statementSnapshotId: snapshot.id,
      adjustments: [],
      lossPosition: {
        ...support,
        openingLossAvailableMinor: "0",
        consumedBeforeMinor: "0",
        ownershipOrRestrictionChangeObserved: false,
      },
      otherIncomeTaxExpense: support,
      explanation: "Declared synthetic tax vector",
    },
    Tax.TaxBridgeView,
  );

  return { snapshot, bridge: view.bridge };
}

export async function recognizeTax(
  context: Awaited<ReturnType<typeof closeFixture>>,
  bridge: typeof Tax.TaxBridge.Type,
) {
  const approval = await post(
    context.reviewer,
    `/change-sets/${bridge.changeSetId}/approvals`,
    { version: 1, planDigest: bridge.planDigest },
    Accounting.Approval,
  );

  return post(
    context.book,
    `/corporate-tax/bridges/${bridge.id}/effects`,
    { bridgeDigest: bridge.digest, approvalId: approval.id },
    Tax.CorporateTaxEffect,
  );
}

export async function controls(
  context: Awaited<ReturnType<typeof closeFixture>>,
  status = "not_applicable",
) {
  await post(
    context.book,
    "/periods/period_2026/closing-source-inventories",
    {
      evidenceId: context.source.id,
      bankAccountIds: [],
      families: [
        "bank_sources",
        "invoices",
        "tax",
        "payroll",
        "assets_deferrals",
        "foreign_currency",
        "owner_balances",
        "other_balances",
        "external_schedules",
        "disclosures",
      ].map((family) => ({
        family,
        status,
        reviewedOn: "2026-09-28",
        evidenceId: context.source.id,
        rationale: "Explicit synthetic inventory; corporate income tax handled by NEXT-22",
      })),
    },
    Closing.ClosingInventory,
  );
  await post(
    context.book,
    "/report-snapshots",
    { kind: "trial_balance_v1", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    Reports.ReportSnapshot,
  );
}

export async function finalProposal(
  context: Awaited<ReturnType<typeof closeFixture>>,
  basis: Awaited<ReturnType<typeof taxBridge>>,
) {
  const preparation = await post(
    context.book,
    `${closePath}/preparations`,
    {
      fiscalYearId: "fy_2026",
      statementSnapshotId: basis.snapshot.id,
      bridgeId: basis.bridge.id,
      nominalAccountId: "account_transfer",
      equityAccountId: "account_equity",
      evidenceId: context.source.id,
      reason: "Reviewed synthetic close vector",
      proposedAdjustmentRefs: [],
      otherFamilies: [],
    },
    Close.ClosePreparation,
  );

  return post(
    context.book,
    `${closePath}/preparations/${preparation.id}/final-proposal`,
    {
      version: 1,
      preparationDigest: preparation.digest,
      accountingPeriodId: "period_2026",
      postingDate: "2026-12-31",
      series: "C",
    },
    Close.FinalCloseProposal,
  );
}

export async function closeApproval(
  context: Awaited<ReturnType<typeof closeFixture>>,
  proposal: typeof Close.FinalCloseProposal.Type,
) {
  return post(
    context.reviewer,
    `${closePath}/proposals/${proposal.id}/approvals`,
    { version: 1, digest: proposal.digest },
    Close.FinalProposalApproval,
  );
}
