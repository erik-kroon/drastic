import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assetClients } from "./asset-fixture-clients.mjs";

export const historicalAdoptionAccounts = [
  { id: "historical_ar", code: "1510", name: "Kundfordringar" },
];

export async function seedHistoricalAdoption(config) {
  const { book, author, reviewer, post } = await assetClients(config);

  const content =
    [
      "#FLAGGA 0",
      "#FORMAT PC8",
      "#SIETYP 4",
      "#RAR 0 20260101 20261231",
      "#IB 0 1510 42500.00",
      "#IB 0 2999 -42500.00",
      "#UB 0 1510 42600.00",
      "#UB 0 2999 -42600.00",
      "#VER A 1 20261001",
      "{",
      "#TRANS 1510 {} 100.00",
      "#TRANS 2999 {} -100.00",
      "}",
    ].join("\r\n") + "\r\n";

  async function retain(revised) {
    const source = await post(book, "/source-occurrences", {
      sourceSystem: "synthetic_Q36_source",
      sourceAccountId: "Synthetic historical ledger",
      occurrenceKey: randomUUID(),
      sourceRevision: revised ? "2" : "1",
      filename: "Historik.se",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(content).toString("base64"),
    });

    const preview = await post(book, `/source-occurrences/${source.id}/sie-previews`, {
      encoding: "ibm437",
    });

    if (!preview.ready) throw new Error("Q36 synthetic source not ready");
    const residuals = ["2000000", "1250000", revised ? "900000" : "1000000"];

    const plan = await post(book, `/sie-previews/${preview.id}/plans`, {
      digest: preview.digest,
      mappings: [
        { sourceAccount: "1510", accountId: "historical_ar" },
        { sourceAccount: "2999", accountId: "account_clearing" },
      ],
      openingControls: [
        {
          sourceAccount: "1510",
          year: "0",
          independentOpeningMinor: "4250000",
          independentClosingMinor: "4260000",
          basis: "Independent synthetic GL",
        },
        {
          sourceAccount: "2999",
          year: "0",
          independentOpeningMinor: "-4250000",
          independentClosingMinor: "-4260000",
          basis: "Independent synthetic GL",
        },
      ],
      openItems: residuals.map((outstandingMinor, index) => ({
        sourceIdentity: ["Kundfaktura 2025-0114", "Kundfaktura 2025-0121", "Kundfaktura 2025-0127"][
          index
        ],
        sourceAccount: "1510",
        currency: "SEK",
        originalMinor: ["2000000", "1250000", "1000000"][index],
        outstandingMinor,
        asOf: "2026-09-30",
        assertedState: index === 2 && revised ? "partly_paid" : "unpaid",
        detailAvailability: "unreconstructable",
        basis: "Reviewed synthetic source residual; original tax and payment detail unavailable",
      })),
      openItemControls: [
        {
          sourceAccount: "1510",
          currency: "SEK",
          independentOutstandingMinor: revised ? "4150000" : "4250000",
          basis: "Independent synthetic residual inventory",
        },
      ],
      rationale: "Retain synthetic source and reviewed interpretation",
      openingPolicy: "unreconstructable_detail",
      sourceKind: "synthetic",
    });

    const run = await post(book, `/sie-plans/${plan.id}/runs`, { digest: plan.digest });
    await post(book, `/sie-runs/${run.id}/chunks`, {
      fence: run.fence,
      planDigest: plan.digest,
      firstOrdinal: 1,
    });

    const admission = await post(book, `/sie-plans/${plan.id}/historical-items`, {
      planDigest: plan.digest,
      payments: [],
      matches: [],
      paymentControls: [],
      matchControls: [],
      chronology: "unknown",
      rationale: "Retained synthetic review, no financial effect",
    });

    return { source, preview, plan, admission };
  }

  const original = await retain(false);

  const opening = await post(book, "/historical-openings", {
    fiscalYearId: config.fixture.fiscalYear.id,
    cutoverOn: "2026-09-30",
    sourcePlanId: original.plan.id,
    sourceDigest: original.plan.digest,
    controls: [
      {
        accountId: "historical_ar",
        signedMinor: "4250000",
        basis: "Independent synthetic opening",
      },
      {
        accountId: "account_clearing",
        signedMinor: "-4250000",
        basis: "Independent synthetic opening",
      },
    ],
    rationale: "Synthetic Q36 opening",
    accountingPeriodId: config.fixture.periods[0].id,
    series: "A",
  });

  const openingApproval = await post(author, `/change-sets/${opening.proposal.id}/approvals`, {
    planDigest: opening.proposal.planDigest,
    version: opening.proposal.version,
  });

  await post(author, `/historical-bases/${config.fixture.fiscalYear.id}/post`, {
    planDigest: opening.proposal.planDigest,
    approvalId: openingApproval.id,
  });

  const pool = await post(book, "/historical-pools", {
    admissionId: original.admission.id,
    admissionDigest: original.admission.digest,
    basisFiscalYearId: config.fixture.fiscalYear.id,
    cutoverOn: "2026-09-30",
    sourceAccount: "1510",
    direction: "AR",
    rationale: "Reviewed original synthetic pool",
  });

  const plan = await post(author, "/historical-adoption-plans", {
    poolId: pool.id,
    poolDigest: pool.digest,
    sourceIdentity: "Kundfaktura 2025-0127",
    rationale: "Adopt the exact reviewed source residual",
  });

  const approval = await post(author, `/historical-adoption-plans/${plan.id}/approvals`, {
    digest: plan.digest,
  });

  const changed = await retain(true);

  if (changed.source.sha256 !== original.source.sha256)
    throw new Error("Q36 changed original bytes");

  const revision = await post(reviewer, `/historical-pools/${pool.id}/revisions`, {
    expectedPoolDigest: pool.digest,
    admissionId: changed.admission.id,
    admissionDigest: changed.admission.digest,
    rationale: "beloppet på Kundfaktura 2025-0127 rättades enligt SIE-filens rad.",
  });

  const response = await fetch(
    `${config.apiUrl}/api/v1/entities/${config.fixture.entity.id}/books/${config.fixture.book.id}/historical-adoption-plans/${plan.id}/execute`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${author.token}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({ digest: plan.digest, approvalId: approval.id }),
    },
  );

  const refusal = await response.json();

  if (response.status !== 409 || refusal.code !== "StaleDependency")
    throw new Error("Q36 stale adoption did not refuse");

  const result = {
    frame: "Q36",
    planId: plan.id,
    poolId: pool.id,
    revisionId: revision.id,
    sourceHash: original.source.sha256,
    refusal: { status: response.status, code: refusal.code },
  };

  await writeFile(
    join(config.artifacts, "historical-adoption-fixture.json"),
    JSON.stringify(result, null, 2),
  );

  return result;
}
