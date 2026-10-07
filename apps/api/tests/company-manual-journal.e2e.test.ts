import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import { expect, test } from "vitest";
import {
  approve,
  database,
  decoded,
  emptyPosting,
  environment,
  evidence,
  execute,
  execution,
  failure,
  fixture,
  journal,
  key,
  ledger,
  onePosting,
  persisted,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

const dates = {
  postingOn: "2026-09-22",
  taxPointOn: null,
  paymentOn: null,
  reportOn: null,
  taxPeriodOn: null,
};

const releaseChecksum = `sha256:${"c".repeat(64)}`;

const activatedEmptyPosting = { ...emptyPosting, consumed: 1 };

const activatedOnePosting = { ...onePosting, consumed: 2 };

const artifact = { artifactId: "synthetic_manual_rule_artifact", sha256: releaseChecksum };

const release = {
  id: "synthetic_actual_manual_journal_v1",
  jurisdiction: "QJ",
  family: "posting_eligibility",
  version: 1,
  checksum: releaseChecksum,
  applicability: {
    legalForms: [],
    accountingMethods: ["cash"],
    vatRegistrations: [],
    payrollRegistrations: [],
    baseCurrencies: ["SEK"],
  },
  requiredFactKinds: ["accounting_method", "base_currency"],
  requiredRoleKinds: ["bank", "commerce"],
  calculatorVersion: "manual-journal-v1",
  rounding: { mode: "half_up", scale: 2 },
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  sourceManifest: "Synthetic QJ manual admission fixture. No normative or company qualification.",
  qualificationStatus: "reviewed",
  recordClasses: ["actual_company"],
  qualification: {
    releaseChecksum,
    primarySources: [
      {
        publisherUrl: "https://example.invalid/synthetic-manual-rule",
        version: "synthetic-v1",
        sha256: releaseChecksum,
        retrievedAt: "2026-10-01T10:00:00.000Z",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
      },
    ],
    reviewer: "Synthetic rule reviewer",
    reviewedAt: "2026-10-02T10:00:00.000Z",
    reviewArtifact: artifact,
    examples: [{ ...artifact, releaseChecksum }],
    counterexamples: [{ ...artifact, releaseChecksum }],
  },
} satisfies typeof Profiles.RuleRelease.Type;

type PreparationGap =
  | "activation"
  | "unreviewed_method"
  | "unknown_method"
  | "unqualified_rule"
  | "unsupported_calculator";

async function actualBook(gap?: PreparationGap) {
  const book = await fixture();
  const independent = await fixture();
  const reviewer = { ...book, actorId: independent.actorId, token: independent.token };
  const source = await evidence(book);
  const admin = await database();

  const fixtureRelease =
    gap === "unsupported_calculator"
      ? {
          ...release,
          id: "synthetic_nonmanual_owner_v1",
          jurisdiction: "QL",
          calculatorVersion: "synthetic-nonmanual-owner-v1",
        }
      : release;

  Schema.decodeSync(Profiles.RuleRelease)(fixtureRelease);

  try {
    await admin.query("update openerp.books set profile='company-setup-v1' where id=$1", [
      book.bookId,
    ]);
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
    await admin.query(
      "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,$2,'posting_eligibility',1,$3,$4) on conflict(id) do nothing",
      [fixtureRelease.id, fixtureRelease.jurisdiction, fixtureRelease.checksum, fixtureRelease],
    );
  } finally {
    await admin.end();
  }

  const facts: Array<typeof Profiles.FactRevision.Type> = [];

  for (const [factKind, value] of [
    ["jurisdiction", gap === "unqualified_rule" ? "QK" : fixtureRelease.jurisdiction],
    ["accounting_method", "cash"],
    ["base_currency", "SEK"],
  ] as const) {
    const fact = await post(
      book,
      "/company-facts",
      {
        factKind,
        value:
          factKind === "accounting_method" && gap === "unknown_method"
            ? { state: "unknown" }
            : { state: "known", value },
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        note: "Synthetic actual-class manual admission fact",
      },
      Profiles.FactRevision,
    );

    if (factKind !== "accounting_method" || gap !== "unreviewed_method") {
      await post(
        reviewer,
        `/company-facts/${fact.id}/reviews`,
        {
          factRevisionId: fact.id,
          expectedDigest: fact.digest,
          result: "confirmed",
          rationale: "Synthetic independent fact review",
        },
        Profiles.FactReview,
      );
    }

    facts.push(fact);
  }

  for (const [roleKind, accountId] of [
    ["bank", "account_bank"],
    ["commerce", "account_clearing"],
  ] as const) {
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
        evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        note: "Synthetic reviewed manual account role",
      },
      Profiles.RoleBinding,
    );
  }

  if (gap === undefined || gap === "unsupported_calculator") {
    const activation = await post(
      book,
      "/company-activation-plans",
      {
        family: "posting_eligibility",
        recordClass: "actual_company",
        dates,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        reason: "Synthetic actual-class internal manual admission",
      },
      Profiles.CompanyActivationPlan,
    );

    const approval = await post(
      reviewer,
      `/company-activation-plans/${activation.id}/approvals`,
      { planDigest: activation.digest },
      Profiles.CompanyActivationApproval,
    );

    await post(
      book,
      `/company-activation-plans/${activation.id}/executions`,
      { planDigest: activation.digest, approvalId: approval.id },
      Profiles.CompanyActivationReceipt,
    );
  }

  return { book, reviewer, source, facts };
}

async function save(name: string, observed: unknown) {
  await writeFile(
    join(environment().artifacts, `company-manual-${name}.json`),
    JSON.stringify(observed, null, 2),
  );
}

async function bumpEpoch(book: BookFixture) {
  const admin = await database();

  try {
    await admin.query(
      "update openerp.company_family_memberships set membership_epoch=membership_epoch+1 where book_id=$1 and family='posting_eligibility'",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }
}

async function refuse(
  book: BookFixture,
  path: string,
  input: RequestInit,
  status: number,
  code: typeof Accounting.FailureCode.Type,
) {
  const response = await request(book, path, input);
  const body = await response.clone().text();

  await save(`refusal-${path.replaceAll("/", "_")}`, {
    path,
    expectedStatus: status,
    expectedCode: code,
    status: response.status,
    body,
  });
  await failure(response, status, code);

  const error = Schema.decodeSync(Schema.fromJsonString(Accounting.AccountingError))(body);

  return { status: response.status, error };
}

async function effects(book: BookFixture) {
  const admin = await database();

  try {
    const rows = await admin.query<{ approvals: number; consumptions: number }>(
      "select (select count(*)::int from openerp.approvals where book_id=$1) as approvals, (select count(*)::int from openerp.approval_consumptions where book_id=$1) as consumptions",
      [book.bookId],
    );

    return { financial: await persisted(book), authority: rows.rows[0] };
  } finally {
    await admin.end();
  }
}

test.each<PreparationGap>([
  "activation",
  "unreviewed_method",
  "unknown_method",
  "unqualified_rule",
  "unsupported_calculator",
])("actual manual preparation refuses %s without financial effects", async (gap) => {
  const { book, source } = await actualBook(gap);
  const before = await persisted(book);

  const refusal = await refuse(
    book,
    "/change-sets",
    {
      method: "POST",
      body: JSON.stringify(journal(source.id)),
    },
    422,
    "UnsupportedProfile",
  );

  expect(await persisted(book)).toEqual(before);
  expect(before).toEqual(gap === "unsupported_calculator" ? activatedEmptyPosting : emptyPosting);
  await save(gap, { refusal, before, after: await effects(book) });
});

test("actual manual admission retains activated witness and epoch, posts exact money and recovers the same receipt", async () => {
  const { book, source } = await actualBook();

  const profile = await decoded(
    await request(
      book,
      "/company-profile?recordClass=actual_company&postingOn=2026-09-22&taxPointOn=2026-09-22&paymentOn=2026-09-22&reportOn=2026-09-22",
    ),
    Profiles.CompanyProfile,
  );

  const resolvedWitness = profile.families.find(
    (family) => family.family === "posting_eligibility",
  )?.witness;

  if (!resolvedWitness) throw new Error("Synthetic activated fixture lacks its witness");

  const witness = { ...resolvedWitness, dates };

  const plan = await post(
    book,
    "/change-sets",
    journal(source.id, "9007199254740993"),
    Accounting.ChangeSet,
  );

  const admin = await database();
  let membershipEpoch: string;

  try {
    const rows = await admin.query<{ epoch: string }>(
      "select membership_epoch::text as epoch from openerp.company_family_memberships where book_id=$1 and family='posting_eligibility'",
      [book.bookId],
    );

    expect(rows.rows).toHaveLength(1);
    membershipEpoch = rows.rows[0]!.epoch;
  } finally {
    await admin.end();
  }

  expect(witness?.activationId).toEqual(expect.any(String));
  expect(plan.groups[0]?.actions[0]).toMatchObject({
    manualCompanyAdmission: { witness, membershipEpoch },
  });

  const action = plan.groups[0]?.actions[0];

  if (action === undefined) throw new Error("Synthetic manual fixture lacks its action");

  const nonmanualAttachments = [
    {
      ...action,
      postingPurpose: "legal_ar_recognition",
      occurrenceKey: `legal_ar_invoice_draft_${"a".repeat(32)}`,
      taxAssessment: "se-domestic-standard-25-v1",
      lines: [...action.lines, action.lines[0]],
      legalIssue: {
        profile: "se-domestic-b2b-sek-25-accrual-v1",
        number: "A-1",
        policyId: "policy_synthetic",
        reviewId: "review_synthetic",
        reviewDigest: releaseChecksum,
        netMinor: "100",
        taxMinor: "25",
      },
    },
    {
      ...action,
      postingPurpose: "legal_customer_credit_v1",
      occurrenceKey: `legal_credit_review_${"a".repeat(32)}`,
      taxAssessment: "se-domestic-standard-25-v1",
      legalCredit: {
        profile: "se-domestic-b2b-sek-25-accrual-credit-v1",
        policyId: "policy_synthetic",
        reviewId: "review_synthetic",
        originalIssueId: "issue_synthetic",
        originalDocumentNumber: "A-1",
        creditedLineCount: 1,
        netMinor: "100",
        taxMinor: "25",
      },
    },
    {
      ...action,
      postingPurpose: "result_transfer_v1",
      occurrenceKey: `result_transfer_${"a".repeat(32)}`,
      resultTransfer: {
        proposalId: "proposal_synthetic",
        fiscalYearId: "fy_2026",
        deltaMinor: "100",
      },
    },
    {
      ...action,
      postingPurpose: "asset_proceeds_disposal_v1",
      assetProceeds: {
        reviewId: "review_synthetic",
        mode: "unposted_cash_sale",
        netMinor: "100",
        vatMinor: "0",
        correctionOf: null,
      },
    },
    { ...action, postingPurpose: "reversal", correctsVoucherId: "voucher_synthetic" },
    {
      ...action,
      vatReclassification: {
        reviewId: "review_synthetic",
        obligationId: "obligation_synthetic",
        draftId: "draft_synthetic",
      },
    },
  ];

  for (const nonmanual of nonmanualAttachments) {
    expect(Schema.is(Accounting.VoucherPostingAction)(nonmanual)).toBe(false);
  }

  expect(await persisted(book)).toEqual(activatedEmptyPosting);
  await post(book, `/change-sets/${plan.id}/validate`, undefined, Accounting.ValidationReport);

  const approval = await approve(book, plan);
  const commandKey = key();

  const command = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify(execution(plan, approval)),
  };

  const receipt = await decoded(
    await request(book, `/change-sets/${plan.id}/execute`, command),
    Accounting.ExecutionReceipt,
  );

  await bumpEpoch(book);
  expect(
    await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, command),
      Accounting.ExecutionReceipt,
    ),
  ).toEqual(receipt);
  expect(await persisted(book)).toEqual(activatedOnePosting);
  expect((await ledger(book)).accounts.map((account) => account.balanceMinor)).toEqual([
    "9007199254740993",
    "-9007199254740993",
  ]);

  const voucher = await decoded(
    await request(book, `/vouchers/${receipt.voucherId}`),
    Accounting.Voucher,
  );

  expect(voucher.action).toMatchObject({ manualCompanyAdmission: { witness, membershipEpoch } });
  await save("success", {
    profile,
    plan,
    approval,
    receipt,
    voucher,
    nonmanualAttachments,
    persisted: await persisted(book),
  });
});

test.each(["membership", "method", "account"] as const)(
  "changed %s refuses actual manual validation, approval and execution without consuming approval",
  async (change) => {
    const { book, source, facts } = await actualBook();
    const plan = await post(book, "/change-sets", journal(source.id), Accounting.ChangeSet);
    const approval = await approve(book, plan);
    const before = await persisted(book);
    const beforeEffects = await effects(book);

    if (change === "membership") {
      await bumpEpoch(book);
    } else if (change === "method") {
      const method = facts.find((fact) => fact.factKind === "accounting_method");

      expect(method).toBeDefined();
      await post(
        book,
        "/company-facts",
        {
          factKind: "accounting_method",
          value: { state: "unknown" },
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          supersedesId: method!.id,
          evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
          note: "Synthetic newly unresolved accounting method",
        },
        Profiles.FactRevision,
      );
    } else {
      const admin = await database();

      try {
        await admin.query(
          "update openerp.accounts set version=version+1 where book_id=$1 and id='account_bank'",
          [book.bookId],
        );
      } finally {
        await admin.end();
      }
    }

    const refusals = [];

    for (const [path, input] of [
      [`/change-sets/${plan.id}/validate`, undefined],
      [`/change-sets/${plan.id}/approvals`, { planDigest: plan.planDigest, version: plan.version }],
      [`/change-sets/${plan.id}/execute`, execution(plan, approval)],
    ] as const) {
      refusals.push(
        await refuse(
          book,
          path,
          {
            method: "POST",
            ...(input === undefined ? {} : { body: JSON.stringify(input) }),
          },
          409,
          "StaleDependency",
        ),
      );
    }

    expect(await persisted(book)).toEqual(before);
    expect(await effects(book)).toEqual(beforeEffects);

    const recovery = await decoded(
      await request(book, `/posting-recovery/${plan.id}`),
      Recovery.PostingRecovery,
    );

    expect(recovery.validation).toMatchObject({
      status: "blocked",
      blocker: { code: "StaleDependency" },
    });
    await save(`stale-${change}`, {
      plan,
      approval,
      refusals,
      recovery,
      before: beforeEffects,
      after: await effects(book),
    });
  },
);

test("fresh saved manual preparation seals actual admission and enables current review without effects", async () => {
  const { book, source } = await actualBook();
  const requestKey = key();
  const before = await effects(book);

  const saved = await decoded(
    await request(book, "/saved-posting-requests", {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify({ operation: "prepare_journal", input: journal(source.id) }),
    }),
    Recovery.SavedPostingRequest,
  );

  const result = await post(
    book,
    `/saved-posting-requests/${requestKey}/run`,
    {},
    Recovery.SavedPostingRequest,
  );

  expect(result.outcome?.state).toBe("committed");

  if (result.outcome?.state !== "committed")
    throw new Error("Synthetic saved manual preparation was refused");

  const plan = Schema.decodeUnknownSync(Accounting.ChangeSet)(result.outcome.result);

  expect(plan.groups[0]?.actions[0]).toMatchObject({
    manualCompanyAdmission: {
      witness: {
        family: "posting_eligibility",
        recordClass: "actual_company",
        dates,
        selectorDate: "2026-09-22",
        ruleReleaseId: release.id,
        ruleReleaseChecksum: release.checksum,
        activationId: expect.any(String),
      },
      membershipEpoch: expect.stringMatching(/^[1-9][0-9]*$/),
    },
  });

  const recovery = await decoded(
    await request(book, `/posting-recovery/${plan.id}`),
    Recovery.PostingRecovery,
  );

  expect(recovery.validation).toEqual({ status: "current", blocker: null });
  expect(await effects(book)).toEqual(before);
  await save("saved-preparation-fresh", {
    saved,
    result,
    plan,
    recovery,
    before,
    after: await effects(book),
  });
});

test("saved manual preparation recovers the exact public actual manual proposal", async () => {
  const { book, source } = await actualBook();
  const input = journal(source.id);
  const requestKey = key();

  const saved = await decoded(
    await request(book, "/saved-posting-requests", {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify({ operation: "prepare_journal", input }),
    }),
    Recovery.SavedPostingRequest,
  );

  const plan = await decoded(
    await request(book, "/change-sets", {
      method: "POST",
      headers: { "idempotency-key": saved.request.commandKey },
      body: JSON.stringify(input),
    }),
    Accounting.ChangeSet,
  );

  const result = await post(
    book,
    `/saved-posting-requests/${requestKey}/run`,
    {},
    Recovery.SavedPostingRequest,
  );

  expect(result.outcome?.state).toBe("committed");
  expect(result.outcome?.result).toEqual(plan);

  const recovery = await decoded(
    await request(book, `/posting-recovery/${plan.id}`),
    Recovery.PostingRecovery,
  );

  expect(recovery.validation).toEqual({ status: "current", blocker: null });
  expect(await persisted(book)).toEqual(activatedEmptyPosting);
  await save("saved-preparation-replay", {
    saved,
    plan,
    result,
    recovery,
    persisted: await persisted(book),
  });
});

test("client cannot supply manual admission and actual corrections remain refused", async () => {
  const { book, source } = await actualBook();
  const plan = await post(book, "/change-sets", journal(source.id), Accounting.ChangeSet);

  const injected = await request(book, "/change-sets", {
    method: "POST",
    body: JSON.stringify({
      ...journal(source.id),
      manualCompanyAdmission: { membershipEpoch: "1" },
    }),
  });

  expect(injected.status).toBe(400);

  const injectionBody = await injected.text();

  const receipt = await execute(book, plan);
  const before = await persisted(book);

  const correctionRefusal = await refuse(
    book,
    `/vouchers/${receipt.voucherId}/correction-proposals`,
    {
      method: "POST",
      body: JSON.stringify({
        accountingPeriodId: "period_2026",
        postingDate: "2026-09-23",
        rationale: "Unsupported actual correction",
      }),
    },
    422,
    "UnsupportedProfile",
  );

  expect(await persisted(book)).toEqual(before);
  await save("client-and-correction", {
    injectionStatus: injected.status,
    injectionBody,
    correctionRefusal,
    plan,
    receipt,
    before,
    after: await persisted(book),
  });
});

test("synthetic plans stay attachment-free and historical correction recovery cannot authorize actual posting", async () => {
  const book = await fixture();
  const source = await evidence(book);
  const journalInput = journal(source.id);
  const savedKey = key();

  const saved = await decoded(
    await request(book, "/saved-posting-requests", {
      method: "POST",
      headers: { "idempotency-key": savedKey },
      body: JSON.stringify({ operation: "prepare_journal", input: journalInput }),
    }),
    Recovery.SavedPostingRequest,
  );

  const plan = await decoded(
    await request(book, "/change-sets", {
      method: "POST",
      headers: { "idempotency-key": saved.request.commandKey },
      body: JSON.stringify(journalInput),
    }),
    Accounting.ChangeSet,
  );

  expect(plan.groups[0]?.actions[0]).not.toHaveProperty("manualCompanyAdmission");

  const receipt = await execute(book, plan);

  const input = {
    accountingPeriodId: "period_2026",
    postingDate: "2026-09-23",
    rationale: "Synthetic correction replay fence",
  };

  const commandKey = key();

  const command = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify(input),
  };

  const correction = await decoded(
    await request(book, `/vouchers/${receipt.voucherId}/correction-proposals`, command),
    Accounting.ChangeSet,
  );

  const admin = await database();

  try {
    await admin.query("update openerp.books set profile='company-setup-v1' where id=$1", [
      book.bookId,
    ]);
  } finally {
    await admin.end();
  }

  const before = await persisted(book);

  const recovered = await post(
    book,
    `/saved-posting-requests/${savedKey}/run`,
    {},
    Recovery.SavedPostingRequest,
  );

  expect(recovered.outcome?.state).toBe("committed");
  expect(recovered.outcome?.result).toEqual(plan);
  expect(await persisted(book)).toEqual(before);

  expect(
    await decoded(
      await request(book, `/vouchers/${receipt.voucherId}/correction-proposals`, command),
      Accounting.ChangeSet,
    ),
  ).toEqual(correction);

  const refusal = await refuse(
    book,
    `/change-sets/${correction.id}/approvals`,
    {
      method: "POST",
      body: JSON.stringify({ planDigest: correction.planDigest, version: correction.version }),
    },
    409,
    "StaleDependency",
  );

  expect(await persisted(book)).toEqual(before);
  await save("synthetic-correction-replay", {
    plan,
    saved,
    recovered,
    receipt,
    correction,
    refusal,
    before,
    after: await persisted(book),
  });
});
