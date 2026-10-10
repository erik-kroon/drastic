import { assertEvaluationRefused } from "./support/decision-examples";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Settlement from "@open-erp/contracts/settlements";
import * as Candidates from "@open-erp/contracts/bank-match-candidates";
import * as Examples from "@open-erp/contracts/decision-examples";
import { createDraft, supplierFixture, purchaseEvidence } from "./support/supplier-review";
import {
  createSession,
  database,
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";

import { provenanceRows } from "./support/decision-provenance";

async function bankFixture(rowCount = 1) {
  const book = await fixture();

  const source = await evidence(book);

  for (let index = 0; index < 2; index++)
    await execute(
      book,

      await post(book, "/change-sets", journal(source.id, "100"), Accounting.ChangeSet),
    );

  const content = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: String(100 * rowCount),
    completeness: { declaredComplete: false, basis: "Synthetic provenance journey" },
    rows: Array.from({ length: rowCount }, (_, index) => ({
      rowOrdinal: index + 1,
      providerId: null,
      date: "2026-09-22",
      description: "Synthetic ranking exposure",
      amountMinor: "100",
    })),
  };

  const original = await post(
    book,
    "/evidence",
    {
      title: "Synthetic statement",
      mediaType: "application/json",
      content: JSON.stringify(content),
      origin: "DRA-219 E2E",
    },
    Accounting.Evidence,
  );

  const imported = await post(
    book,
    "/bank-statements",
    { ...content, evidenceId: original.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  return { book, statementId: imported.statement.id };
}

test("bank exposure derives unchanged, corrected and cross-session unknown with atomic recovery", async () => {
  const artifact: {
    bookId: string;
    suggestionRecordId: string;
    rows: Awaited<ReturnType<typeof provenanceRows>>;
  }[] = [];

  for (const expected of ["accepted_unchanged", "corrected", "unknown_exposure"] as const) {
    const setup = await bankFixture();

    const firstSession = await createSession(setup.book);

    const book = { ...setup.book, token: firstSession.token };

    const before = await persisted(book);

    const found = await post(
      book,
      "/bank-match-candidates",
      { statementId: setup.statementId, rowOrdinal: 1 },
      Candidates.BankMatchCandidates,
    );

    expect(await persisted(book)).toEqual(before);

    if (expected === "accepted_unchanged") {
      const foreign = await bankFixture();

      const foreignRanking = await post(
        foreign.book,
        "/bank-match-candidates",
        { statementId: foreign.statementId, rowOrdinal: 1 },
        Candidates.BankMatchCandidates,
      );

      const candidate = found.candidates[0];

      if (!candidate) throw new Error("An exact candidate is required.");

      const input = {
        statementId: setup.statementId,
        rowOrdinal: 1,
        voucherId: candidate.voucherId,
        lineId: candidate.lineId,
      };

      await failure(
        await request(book, "/bank-matches", {
          method: "POST",
          body: JSON.stringify({
            ...input,
            presentedSuggestionIds: [foreignRanking.suggestionRecordId],
          }),
        }),
        403,
        "Forbidden",
      );
      const admin = await database();

      try {
        await admin.query(
          "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
          [book.bookId, foreign.book.actorId],
        );
      } finally {
        await admin.end();
      }

      const differentActor = {
        ...book,
        token: (await createSession({ ...book, actorId: foreign.book.actorId })).token,
      };

      await failure(
        await request(differentActor, "/bank-matches", {
          method: "POST",
          body: JSON.stringify({ ...input, presentedSuggestionIds: [found.suggestionRecordId] }),
        }),
        403,
        "Forbidden",
      );
      expect(await provenanceRows(book)).toEqual([]);
    }

    const candidate = found.candidates[expected === "corrected" ? 1 : 0];

    if (!candidate) throw new Error("Two exact candidates are required.");

    const chosenBook =
      expected === "unknown_exposure"
        ? { ...book, token: (await createSession(book)).token }
        : book;

    const input = {
      statementId: setup.statementId,
      rowOrdinal: 1,
      voucherId: candidate.voucherId,
      lineId: candidate.lineId,
      presentedSuggestionIds: expected === "unknown_exposure" ? [] : [found.suggestionRecordId],
    };

    if (expected === "unknown_exposure") {
      await failure(
        await request(chosenBook, "/bank-matches", {
          method: "POST",
          body: JSON.stringify({ ...input, presentedSuggestionIds: [found.suggestionRecordId] }),
        }),
        403,
        "Forbidden",
      );

      expect(await provenanceRows(book)).toEqual([]);
    }

    const idempotency = key();

    const options = {
      method: "POST",
      headers: { "idempotency-key": idempotency },
      body: JSON.stringify(input),
    };

    const receipt = await decoded(
      await request(chosenBook, "/bank-matches", options),
      Bank.BankMatchReceipt,
    );

    expect(
      await decoded(await request(chosenBook, "/bank-matches", options), Bank.BankMatchReceipt),
    ).toEqual(receipt);

    await failure(
      await request(chosenBook, "/bank-matches", {
        ...options,
        body: JSON.stringify({ ...input, presentedSuggestionIds: ["suggestion_wrong"] }),
      }),
      409,
      "IdempotencyConflict",
    );
    await post(
      chosenBook,
      "/bank-matches",
      { ...input, presentedSuggestionIds: [] },
      Bank.BankMatchReceipt,
    );

    const rows = await provenanceRows(book);

    expect(rows).toHaveLength(1);

    expect(rows[0]?.classification).toBe(expected);

    if (expected === "unknown_exposure") {
      await assertEvaluationRefused(book, rows[0]!.decision_id);

      const exported = await post(
        book,
        "/automation/decision-examples",
        { purpose: "training", selectedDecisionIds: [rows[0]!.decision_id] },
        Examples.DecisionExampleExport,
      );

      expect(exported.examples).toHaveLength(1);
      expect(exported.examples[0]!.options.capture).toBe("uncited_exposure");
      expect(exported.examples[0]!.missingFacts).toContain("uncited_option_records_not_bound");
      await writeFile(
        join(environment().artifacts, "decision-examples-uncited.json"),
        JSON.stringify(exported, null, 2),
      );
    }

    artifact.push({ bookId: book.bookId, suggestionRecordId: found.suggestionRecordId, rows });
  }

  await writeFile(
    join(environment().artifacts, "decision-provenance-bank.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        counts: Object.fromEntries(
          ["accepted_unchanged", "corrected", "unknown_exposure"].map((classification) => [
            classification,
            artifact
              .flatMap((journey) => journey.rows)
              .filter((row) => row.classification === classification).length,
          ]),
        ),
        journeys: artifact,
      },
      null,
      2,
    ),
  );
});

test("supplier approval refuses foreign citations and provenance failure rolls back its owner", async () => {
  const setup = await supplierFixture();

  const book = { ...setup.book, token: (await createSession(setup.book)).token };

  const draft = await createDraft(book, setup.content);

  const otherDraft = await createDraft(book, {
    ...setup.content,
    supplierDocumentNumber: "OTHER-SUBJECT",
  });

  const suggestionPath = `/commerce/supplier-account-suggestions/${setup.supplier.id}?draftId=${draft.id}&draftRevision=${draft.revision}`;

  const shown = await decoded(
    await request(book, suggestionPath),
    Drafts.SupplierAccountSuggestions,
  );

  const review = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "synthetic-manual-supplier-v1",
      draftId: otherDraft.id,
      expectedRevision: otherDraft.revision,
      expectedDigest: otherDraft.digest,
      controlAccountId: "account_clearing",
      debitAccountId: "account_bank",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Synthetic provenance approval",
      acknowledgeSyntheticOnly: true,
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const path = `/commerce/supplier-acceptance-reviews/${review.id}/approvals`;

  const input = { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true };

  await failure(
    await request(book, path, {
      method: "POST",
      body: JSON.stringify({ ...input, presentedSuggestionIds: [shown.suggestionRecordId] }),
    }),
    403,
    "Forbidden",
  );

  const foreign = await fixture();

  await failure(
    await request(foreign, path, {
      method: "POST",
      body: JSON.stringify({ ...input, presentedSuggestionIds: [shown.suggestionRecordId] }),
    }),
    404,
    "NotFound",
  );

  const admin = await database();

  try {
    await admin.query(
      "create function openerp.e2e_provenance_fault() returns trigger language plpgsql as $$ begin raise exception 'synthetic provenance failure'; end $$",
    );

    await admin.query(
      "create trigger e2e_provenance_fault before insert on openerp.decision_provenance for each row execute function openerp.e2e_provenance_fault()",
    );

    await failure(
      await request(book, path, { method: "POST", body: JSON.stringify(input) }),
      500,
      "InternalError",
    );

    expect(
      (
        await admin.query("select id from openerp.supplier_acceptance_approvals where book_id=$1", [
          book.bookId,
        ])
      ).rows,
    ).toEqual([]);

    expect(await provenanceRows(book)).toEqual([]);
  } finally {
    await admin.query("drop trigger if exists e2e_provenance_fault on openerp.decision_provenance");

    await admin.query("drop function if exists openerp.e2e_provenance_fault()");

    await admin.end();
  }

  await post(book, path, input, Acceptance.SupplierAcceptanceApproval);

  const rows = await provenanceRows(book);

  expect(rows[0]?.classification).toBe("independent");

  await expect(async () => {
    const observation = await database();

    try {
      await observation.query(
        "update openerp.decision_provenance set classification='corrected' where book_id=$1",
        [book.bookId],
      );
    } finally {
      await observation.end();
    }
  }).rejects.toThrow();

  await writeFile(
    join(environment().artifacts, "decision-provenance-supplier.json"),
    JSON.stringify(
      { syntheticOnly: true, rows, rollbackObserved: true, immutableObserved: true },
      null,
      2,
    ),
  );
});

test("empty supplier hints preserve independent labels and actual posted account/VAT hints remain partial", async () => {
  const setup = await supplierFixture([
    { id: "account_payable", code: "2440", name: "Supplier payable" },
    { id: "account_input_vat", code: "2641", name: "Input VAT" },
    { id: "account_expense", code: "6000", name: "Synthetic expense" },
  ]);

  const book = { ...setup.book, token: (await createSession(setup.book)).token };

  const treatment = {
    basis: "full_deduction",
    rate: { numerator: "25", denominator: "100" },
    deduction: { numerator: "1", denominator: "1" },
    invoiceTaxRounding: "half_up",
    deductionRounding: "half_up",
    acceptancePolicy: "exact_match",
    toleranceMinor: "0",
  } as const;

  const content = {
    ...setup.content,
    sourceTotalMinor: "12500",
    lines: setup.content.lines.map((line) => ({
      ...line,
      taxMinor: "2500",
      sourceGrossMinor: "12500",
    })),
  };

  const initial = await createDraft(book, content);

  const hintPath = (draft: typeof Drafts.SupplierInvoiceDraftRevision.Type) =>
    `/commerce/supplier-account-suggestions/${setup.supplier.id}?draftId=${draft.id}&draftRevision=${draft.revision}`;

  const empty = await decoded(
    await request(book, hintPath(initial)),
    Drafts.SupplierAccountSuggestions,
  );

  expect(empty.items).toEqual([]);

  const prepareReview = (draft: typeof Drafts.SupplierInvoiceDraftRevision.Type) =>
    post(
      book,
      "/commerce/supplier-acceptance-reviews",
      {
        profile: "swedish-purchase-v1",
        draftId: draft.id,
        expectedRevision: draft.revision,
        expectedDigest: draft.digest,
        controlAccountId: "account_payable",
        accountingPeriodId: "period_2026",
        series: "A",
        reason: "Synthetic partial hint comparison",
        acknowledgeSyntheticOnly: true,
        taxPoint: { taxPointOn: "2026-09-22", basis: "document_date" },
        lineAssignments: draft.content.lines.map((line) => ({
          lineId: line.id,
          expenseAccountId: "account_expense",
          treatment,
        })),
      },
      Acceptance.SupplierAcceptanceReview,
    );

  const initialReview = await prepareReview(initial);

  const approvalInput = {
    version: 1,
    digest: initialReview.digest,
    acknowledgeSyntheticOnly: true,
  } as const;

  const initialApproval = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${initialReview.id}/approvals`,
    approvalInput,
    Acceptance.SupplierAcceptanceApproval,
  );

  expect((await provenanceRows(book))[0]?.classification).toBe("independent");
  await post(
    book,
    `/commerce/supplier-acceptance-reviews/${initialReview.id}/execute`,
    { ...approvalInput, approvalId: initialApproval.id },
    Acceptance.SupplierAcceptanceReceipt,
  );

  for (const cite of [false, true]) {
    const source = await purchaseEvidence(book, cite ? 2 : 1);

    const draft = await createDraft(book, {
      ...content,
      sourceEvidenceId: source.id,
      supplierDocumentNumber: cite ? "PARTIAL-CITED" : "PARTIAL-OMITTED",
      lines: content.lines.map((line) => ({ ...line, taxEvidenceId: source.id })),
    });

    const shown = await decoded(
      await request(book, hintPath(draft)),
      Drafts.SupplierAccountSuggestions,
    );

    expect(shown.items).toMatchObject([
      { expenseAccountId: "account_expense", vatRatePercent: 25 },
    ]);
    const review = await prepareReview(draft);

    const approval = await post(
      book,
      `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
      {
        version: 1,
        digest: review.digest,
        acknowledgeSyntheticOnly: true,
        presentedSuggestionIds: cite ? [shown.suggestionRecordId] : [],
      },
      Acceptance.SupplierAcceptanceApproval,
    );

    const rows = await provenanceRows(book);
    const provenance = rows.find((row) => row.decision_id === approval.id);
    expect(provenance?.classification).toBe("unknown_exposure");

    if (cite)
      expect(provenance?.body).toMatchObject({
        comparisons: [
          { coverage: "partial", dimensions: { account: "unchanged", vatRate: "unchanged" } },
        ],
      });

    if (cite) {
      const operator = await fixture();
      const admin = await database();

      try {
        await admin.query(
          "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
          [book.bookId, operator.actorId],
        );
      } finally {
        await admin.end();
      }

      const other = {
        ...book,
        actorId: operator.actorId,
        token: (await createSession({ ...book, actorId: operator.actorId })).token,
      };

      const preparedWithCitations = await post(
        book,
        "/commerce/supplier-acceptance-reviews",
        {
          ...review.input,
          presentedSuggestionIds: [shown.suggestionRecordId],
          reason: "Preserve current preparer's hint provenance",
        },
        Acceptance.SupplierAcceptanceReview,
      );

      const approval = await post(
        other,
        `/commerce/supplier-acceptance-reviews/${preparedWithCitations.id}/approvals`,
        { version: 1, digest: preparedWithCitations.digest, acknowledgeSyntheticOnly: true },
        Acceptance.SupplierAcceptanceApproval,
      );

      expect(
        (await provenanceRows(book)).find((row) => row.decision_id === approval.id)?.classification,
      ).toBe("independent");
    }
  }

  const rows = await provenanceRows(book);
  await writeFile(
    join(environment().artifacts, "decision-provenance-partial-hints.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        rows,
        counts: Object.fromEntries(
          ["independent", "unknown_exposure"].map((classification) => [
            classification,
            rows.filter((row) => row.classification === classification).length,
          ]),
        ),
      },
      null,
      2,
    ),
  );
});

test("same bank subject stale citation returns StaleDependency after another row matches", async () => {
  const setup = await bankFixture(2);

  const first = await post(
    setup.book,
    "/bank-match-candidates",
    { statementId: setup.statementId, rowOrdinal: 1 },
    Candidates.BankMatchCandidates,
  );

  const second = await post(
    setup.book,
    "/bank-match-candidates",
    { statementId: setup.statementId, rowOrdinal: 2 },
    Candidates.BankMatchCandidates,
  );

  const selectedA = first.candidates.find((candidate) => candidate.eligible)!;

  const selectedB = second.candidates.find(
    (candidate) => candidate.eligible && candidate.voucherId !== selectedA.voucherId,
  )!;

  expect(selectedB).toBeDefined();
  await post(
    setup.book,
    "/bank-matches",
    {
      statementId: setup.statementId,
      rowOrdinal: 1,
      voucherId: selectedA.voucherId,
      lineId: selectedA.lineId,
      presentedSuggestionIds: [first.suggestionRecordId],
    },
    Bank.BankMatchReceipt,
  );

  const localInput = {
    statementId: setup.statementId,
    rowOrdinal: 2,
    voucherId: selectedB.voucherId,
    lineId: selectedB.lineId,
  };

  await failure(
    await request(setup.book, "/bank-matches", {
      method: "POST",
      body: JSON.stringify({ ...localInput, presentedSuggestionIds: [first.suggestionRecordId] }),
    }),
    403,
    "Forbidden",
  );
  const differentSession = { ...setup.book, token: (await createSession(setup.book)).token };
  await failure(
    await request(differentSession, "/bank-matches", {
      method: "POST",
      body: JSON.stringify({ ...localInput, presentedSuggestionIds: [second.suggestionRecordId] }),
    }),
    403,
    "Forbidden",
  );

  const response = await request(setup.book, "/bank-matches", {
    method: "POST",
    body: JSON.stringify({
      statementId: setup.statementId,
      rowOrdinal: 2,
      voucherId: selectedB.voucherId,
      lineId: selectedB.lineId,
      presentedSuggestionIds: [second.suggestionRecordId],
    }),
  });

  await writeFile(
    join(environment().artifacts, "bank-citation-freshness.json"),
    JSON.stringify(
      { first, second, status: response.status, body: await response.clone().json() },
      null,
      2,
    ),
  );
  await failure(response, 409, "StaleDependency");
});

async function advanceBankSource(book: Awaited<ReturnType<typeof fixture>>) {
  const content = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: "1",
    completeness: { declaredComplete: false, basis: "Unrelated synthetic source revision" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-09-22",
        description: "Unrelated source observation",
        amountMinor: "1",
      },
    ],
  };

  const source = await post(
    book,
    "/evidence",
    {
      title: "Unrelated synthetic statement",
      mediaType: "application/json",
      content: JSON.stringify(content),
      origin: "Bug6 source revision fixture",
    },
    Accounting.Evidence,
  );

  return post(
    book,
    "/bank-statements",
    { ...content, evidenceId: source.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );
}

test("bank request driver refreshes equal options once and refuses changed options or repeated staleness", async () => {
  const { submitBankWithCitationRefresh } = await import("../../web/src/lib/bank-citation-request");
  const outcomes = [];

  for (const mode of ["unchanged", "changed", "twice_stale"] as const) {
    const setup = await bankFixture(2);
    const discovery = { statementId: setup.statementId, rowOrdinal: 2 };

    const found = await post(
      setup.book,
      "/bank-match-candidates",
      discovery,
      Candidates.BankMatchCandidates,
    );

    const captureDb = await database();

    try {
      const capture = (
        await captureDb.query(
          "SELECT body->>'optionSetDigest' AS digest FROM openerp.suggestion_records WHERE book_id=$1 AND id=$2",
          [setup.book.bookId, found.suggestionRecordId],
        )
      ).rows[0];

      expect(found.optionSetDigest).toBe(capture.digest);
      expect(found.optionSetDigest).not.toBe(found.digest);
    } finally {
      await captureDb.end();
    }

    const selected = found.candidates[1]!;

    if (mode === "changed") {
      const first = await post(
        setup.book,
        "/bank-match-candidates",
        { ...discovery, rowOrdinal: 1 },
        Candidates.BankMatchCandidates,
      );

      const other = first.candidates.find(
        (candidate) => candidate.voucherId !== selected.voucherId,
      )!;

      await post(
        setup.book,
        "/bank-matches",
        {
          statementId: setup.statementId,
          rowOrdinal: 1,
          voucherId: other.voucherId,
          lineId: other.lineId,
          presentedSuggestionIds: [first.suggestionRecordId],
        },
        Bank.BankMatchReceipt,
      );
    } else await advanceBankSource(setup.book);
    const initialKey = key();
    const retained: { key: string; input: typeof Settlement.PrepareBankAllocation.Type }[] = [];
    let refreshes = 0;

    const input: typeof Settlement.PrepareBankAllocation.Type = {
      presentedSuggestionIds: [found.suggestionRecordId],
      accountId: "account_bank",
      reason: "Independent synthetic bank choice",
      ambiguityAcknowledged: true,
      legs: [
        {
          ...discovery,
          voucherId: selected.voucherId,
          lineId: selected.lineId,
          amountMinor: "100",
        },
      ],
    };

    let fresh: typeof Candidates.BankMatchCandidates.Type | undefined;
    let plan: typeof Settlement.BankAllocationPlan.Type | undefined;
    let error: unknown;

    try {
      plan = await submitBankWithCitationRefresh({
        path: `${environment().baseUrl}${setup.book.path}/bank-allocation-plans`,
        output: Settlement.BankAllocationPlan,
        request: { key: initialKey, input },
        optionSetDigest: found.optionSetDigest,
        options: { headers: { authorization: `Bearer ${setup.book.token}` } },
        retain: (value) => retained.push(value),
        refresh: async () => {
          refreshes++;
          fresh = await post(
            setup.book,
            "/bank-match-candidates",
            discovery,
            Candidates.BankMatchCandidates,
          );

          if (mode === "twice_stale") await advanceBankSource(setup.book);

          return fresh;
        },
      });
    } catch (failure) {
      error = failure;
    }

    outcomes.push({
      mode,
      found,
      fresh,
      retained,
      refreshes,
      plan: plan ?? null,
      error:
        error instanceof Accounting.AccountingError
          ? error.code
          : error instanceof Error
            ? error.message
            : null,
    });
    await writeFile(
      join(environment().artifacts, "bank-request-refresh.json"),
      JSON.stringify(outcomes, null, 2),
    );
    expect(refreshes, mode).toBe(1);
    expect(fresh).toBeDefined();

    if (mode === "unchanged") {
      expect(error).toBeUndefined();
      expect(plan).toBeDefined();
      expect(fresh!.optionSetDigest).toBe(found.optionSetDigest);
      expect(retained).toHaveLength(2);
      expect(retained[1]!.key).not.toBe(initialKey);
      expect(retained[1]!.input.presentedSuggestionIds).toEqual([fresh!.suggestionRecordId]);

      const approval = await post(
        setup.book,
        `/bank-allocation-plans/${plan!.id}/approve`,
        {
          digest: plan!.digest,
          version: plan!.version,
          presentedSuggestionIds: [fresh!.suggestionRecordId],
        },
        Settlement.BankAllocationApproval,
      );

      expect(approval.planId).toBe(plan!.id);
    } else {
      expect(error).toBeInstanceOf(Accounting.AccountingError);
      expect((error as Accounting.AccountingError).code).toBe("StaleDependency");
      expect(plan).toBeUndefined();
      expect(retained).toHaveLength(mode === "changed" ? 1 : 2);

      if (mode === "changed") expect(fresh!.optionSetDigest).not.toBe(found.optionSetDigest);
    }
  }
}, 60_000);
