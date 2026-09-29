import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import { decoded, environment, fixture, key, request } from "../support/fixtures";

// Six-books Book A prefix skeleton: isolation, fixture staging and byte
// retention are real. No oracle journal is imported. Financial intents stay
// BLOCKED until their owning application slice exists.
//
// Design input (challenge only, never oracle effects):
// - A-CAP share_capital 2500000 + shareholder_loan 10000000, TEST-ONLY-A.
// - Corpus primary_hash for sources/A-CAP.json pins the retained bytes.
// - A001 capital_paid needs NEXT-119 share subscriptions (no owner).
// - A002 owner_loan_received maps to owner_loan (NEXT-06 owner exists in
//   source, runtime proof open). Fixture year is 2026 while corpus date is
//   2025-05-18, so this slice records boundary reachability, not corpus proof.

const A_CAP_JSON = JSON.stringify({
  source_id: "A-CAP",
  synthetic: true,
  not_for_real_submission: true,
  kind: "formation",
  document_date: "2025-05-17",
  title: "Capital and owner funding",
  company: "Atlas Konsult AB [SYNTHETIC]",
  company_id: "TEST-ONLY-A",
  currency: "SEK",
  facts: {
    share_capital_minor: "2500000",
    shareholder_loan_minor: "10000000",
    loan_currency: "SEK",
    repayment_principal_minor: "2000000",
    fixed_contract_finance_cost_minor: "480000",
    finance_cost_months: ["2026-01", "2026-02", "2026-03", "2026-04"],
  },
});

const A_CAP_PRIMARY_HASH = createHash("sha256").update(A_CAP_JSON, "utf8").digest("hex");

function isLoopback(url: string): boolean {
  const parsed = new URL(url);

  return (
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "[::1]"
  );
}

test("six-books A prefix: isolation, source retention and honest BLOCKED inventory", async () => {
  const env = environment();

  expect(isLoopback(env.baseUrl), `baseUrl must stay loopback, saw ${env.baseUrl}`).toBe(true);

  expect(isLoopback(env.adminUrl), `adminUrl must stay loopback, saw ${env.adminUrl}`).toBe(true);

  const book = await fixture([
    { id: "account_owner_control", code: "2890", name: "Owner control synthetic" },
    { id: "account_equity", code: "2081", name: "Share capital synthetic" },
  ]);

  const retained = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "A-CAP formation synthetic",
        content: A_CAP_JSON,
        mediaType: "application/json",
        origin: "six-books challenge A-CAP TEST-ONLY",
      }),
    }),
    Accounting.Evidence,
  );

  expect(retained.id.length).toBeGreaterThan(0);

  const readBack = await decoded(
    await request(book, `/evidence/${retained.id}`, { method: "GET" }),
    Accounting.EvidenceContent,
  );

  expect(readBack.content).toBe(A_CAP_JSON);

  // Corpus reference (challenge/A/sources/A-CAP.json primary_hash):
  // 100f91a0eaaf54870714336584b3348ef4e8d3e64550c5d0a9cf9a45b21da759.
  // This test pins retention roundtrip of the bytes it sent, not a
  // byte-identical reprint of the corpus file. Exact file-byte verification
  // lives in fixture-adapter retainOriginals against expectedTransportHash.
  expect(createHash("sha256").update(readBack.content, "utf8").digest("hex")).toBe(
    A_CAP_PRIMARY_HASH,
  );

  const ownerResponse = await request(book, "/owner-register/owners", {
    method: "POST",
    body: JSON.stringify({
      sourceKey: `sixbooks-owner-${key()}`,
      displayName: "Six-books synthetic owner",
      dataNature: "synthetic_example",
      evidenceId: retained.id,
      reason: "Stage Book A owner identity for A002 reachability probe only.",
    }),
  });

  const ownerBody = await ownerResponse.text();

  let ownerId: string | null = null;

  let ownerOutcome = `http-${ownerResponse.status}`;

  if (ownerResponse.status === 200) {
    const created = JSON.parse(ownerBody) as { id: string };

    ownerId = created.id;

    ownerOutcome = `created:${created.id}`;
  }

  let a002Outcome = "NOT_ATTEMPTED:owner-missing";

  if (ownerId) {
    const prepareResponse = await request(book, "/owner-operations/reviews", {
      method: "POST",
      body: JSON.stringify({
        ownerId,
        controlAccountId: "account_owner_control",
        accountingPeriodId: "period_2026",
        postingDate: "2025-05-18",
        series: "A",
        reason:
          "Six-books A002 shareholder loan reachability probe; corpus date outside fixture year.",
        mode: "owner_loan",
        cashAccountId: "account_bank",
        amountMinor: "10000000",
        evidence: {
          fundingEvidenceId: retained.id,
          legalForm: "shareholder_loan",
          reason: "A-CAP shareholder loan 10000000 SEK synthetic.",
        },
      }),
    });

    const prepareBody = await prepareResponse.text();

    if (prepareResponse.status === 200) {
      a002Outcome = `prepared:${prepareBody.length}-bytes`;
    } else {
      try {
        const failure = JSON.parse(prepareBody) as { code?: string };

        a002Outcome = `refused:http-${prepareResponse.status}:${failure.code ?? "unknown-code"}`;
      } catch {
        a002Outcome = `refused:http-${prepareResponse.status}:unparsed`;
      }
    }

    expect(prepareResponse.status).not.toBe(500);
  }

  const report = {
    schema: "six-books-runtime-report/v1",
    dataset: "openerp-six-books/v2",
    scope: "A-prefix-skeleton",
    isolation: {
      baseUrlLoopback: true,
      adminUrlLoopback: true,
      externalEgress: "disabled-by-harness",
      noProductionData: true,
    },
    corpusSelfChecks:
      "see checks/validate_corpus.py 3679/3679 in integration handoff, not rerun here",
    sourceRetention: {
      sourceId: "A-CAP",
      retainedEvidenceId: retained.id,
      transportHash: A_CAP_PRIMARY_HASH,
      roundTrip: readBack.content === A_CAP_JSON,
    },
    cases: [
      {
        case_id: "A/A001/capital_paid",
        status: "BLOCKED_UNSUPPORTED",
        reason:
          "NEXT-119 cash share subscriptions have no application owner; owner_loan/owner_contribution must not stand in for share capital.",
      },
      {
        case_id: "A/A002/owner_loan_received",
        status:
          ownerId && a002Outcome.startsWith("prepared") ? "INCONCLUSIVE" : "BLOCKED_UNSUPPORTED",
        reason:
          "NEXT-06 owner exists in source without runtime proof; fixture year 2026 vs corpus date 2025-05-18; boundary outcome recorded verbatim.",
        ownerOutcome,
        prepareOutcome: a002Outcome,
      },
    ],
    canonicalApplication: "NOT_RUN",
    comparison: "NOT_RUN",
    finalVerdict: "NOT_RUN",
    noImplicitPass: true,
  };

  await writeFile(
    join(env.artifacts, "six-books-a-prefix.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  expect(report.sourceRetention.roundTrip).toBe(true);
});
