import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

export const supplierExpiryAccounts = [
  { id: "expiry_consulting", code: "6550", name: "Konsultarvoden" },
  { id: "expiry_payable", code: "2440", name: "Leverantörsskulder" },
];

export async function seedSupplierExpiry(config) {
  const { fixture, apiUrl, accessToken, adminUrl } = config;

  const artifacts = config.artifacts;
  const origin = new URL(apiUrl);
  const database = new URL(adminUrl);

  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    database.hostname !== "127.0.0.1"
  )
    throw new Error("Supplier expiry fixture requires the disposable loopback runtime");

  const scope = { entityId: fixture.entity.id, bookId: fixture.book.id };
  const prefix = `/api/v1/entities/${encodeURIComponent(scope.entityId)}/books/${encodeURIComponent(scope.bookId)}`;

  async function request(path, input) {
    const headers = { authorization: `Bearer ${accessToken}` };

    if (input !== undefined) {
      headers["content-type"] = "application/json";
      headers["idempotency-key"] = randomUUID();
    }

    const response = await fetch(`${origin.origin}${prefix}${path}`, {
      method: input === undefined ? "GET" : "POST",
      headers,
      body: input === undefined ? undefined : JSON.stringify(input),
      signal: AbortSignal.timeout(15000),
    });

    const result = await response.json();

    if (!response.ok) throw new Error(`Supplier expiry ${path} refused with ${response.status}`);

    if (
      result.scope &&
      (result.scope.entityId !== scope.entityId || result.scope.bookId !== scope.bookId)
    )
      throw new Error("Supplier expiry fixture scope mismatch");

    return result;
  }

  const { Client } = createRequire(join(import.meta.dirname, "../../apps/api/package.json"))("pg");
  const admin = new Client({ connectionString: adminUrl });
  const approvalId = "supplier_approval_paper_expired";
  const createdAt = "2026-10-03T12:05:00.000Z";
  const expiresAt = "2026-10-03T13:05:00.000Z";

  await admin.connect();

  try {
    const admission = await admin.query(
      `select clock_timestamp() > $1::timestamptz as expired,
        exists(select 1 from openerp.supplier_acceptance_approvals where book_id=$2 and id=$3) as present`,
      [expiresAt, scope.bookId, approvalId],
    );

    if (!admission.rows[0]?.expired || admission.rows[0].present)
      throw new Error(
        "Historical expiry fixture requires a fresh scratch book and elapsed fixed approval time",
      );

    const precedingSource = await request("/evidence", {
      title: "Tryckhuset Norr AB, faktura 5521",
      content:
        "Synthetic supplier example 5521. SEK 3150.00. Retained only for the real queue layout.",
      mediaType: "text/plain",
      origin: "L28 disposable preceding journal source",
    });

    const precedingJournal = await request("/change-sets", {
      kind: "manual_journal",
      evidenceId: precedingSource.id,
      eventKey: "paper_expiry_tryckhuset_5521",
      accountingPeriodId: fixture.periods[0].id,
      postingDate: "2026-10-03",
      series: "A",
      description: "Tryckhuset Norr AB, faktura 5521",
      rationale: "Synthetic queue reference, no approval or posting",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "expiry_consulting",
          debitMinor: "315000",
          creditMinor: "0",
          description: "Synthetic source cost",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "315000",
          description: "Synthetic source control",
        },
      ],
    });

    const evidence = await request("/evidence", {
      title: "Vinter & Co AB, faktura 882",
      content:
        "Synthetic supplier invoice 882. SEK 2490.00 gross cost. No company data or provider calls.",
      mediaType: "text/plain",
      origin: "L28 disposable synthetic approval expiry",
    });

    const party = await request("/commerce/counterparties", {
      kind: "synthetic_counterparty_v1",
      externalKey: "paper_expiry_vinter",
      role: "supplier",
      displayName: "Vinter & Co AB",
      evidenceId: evidence.id,
      reason: "L28 disposable synthetic supplier",
    });

    const identity = {
      legalName: "Fjällby Konsult AB",
      registrationId: "SYNTHETIC-ONLY",
      taxId: null,
      address: "Synthetic address",
      countryCode: "SE",
      evidenceId: evidence.id,
    };

    const draft = await request("/commerce/supplier-invoice-drafts", {
      draftKey: "paper_expiry_vinter_882",
      content: {
        title: "Vinter & Co AB, faktura 882",
        counterpartyId: party.id,
        counterpartyRevision: party.revision,
        supplier: { ...identity, legalName: party.displayName },
        buyer: identity,
        sourceEvidenceId: evidence.id,
        supplierDocumentNumber: "882",
        currency: "SEK",
        currencyScale: 2,
        documentDate: "2026-10-03",
        supplyDate: "2026-10-03",
        dueDate: "2026-10-14",
        paymentTerms: "Synthetic terms",
        sourceTotalMinor: "249000",
        lines: [
          {
            id: "line_paper_expiry_vinter",
            description: "Synthetic consulting service",
            quantity: "1",
            unitPriceMinor: "249000",
            baseMinor: "249000",
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: "0",
            taxDescription: "Synthetic gross cost",
            taxEvidenceId: evidence.id,
            sourceGrossMinor: "249000",
          },
        ],
      },
    });

    const review = await request("/commerce/supplier-acceptance-reviews", {
      profile: "synthetic-gross-cost-supplier-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      debitAccountId: "expiry_consulting",
      controlAccountId: "expiry_payable",
      accountingPeriodId: fixture.periods[0].id,
      series: "A",
      reason: "L28 disposable unchanged approval expiry proposal",
      acknowledgeSyntheticOnly: true,
    });

    if (
      review.draftSnapshot.id !== draft.id ||
      review.draftSnapshot.totals.grossMinor !== "249000" ||
      review.scope.entityId !== scope.entityId ||
      review.scope.bookId !== scope.bookId
    )
      throw new Error("Supplier expiry native proposal differs from the independent fixture basis");

    const approval = {
      id: approvalId,
      scope,
      reviewId: review.id,
      digest: review.digest,
      version: 1,
      actorId: fixture.actor.id,
      ordinal: 1,
      createdAt,
      expiresAt,
      receipt: {
        key: randomUUID(),
        operation: "approve_supplier_acceptance",
        actorId: fixture.actor.id,
      },
    };

    await admin.query(
      `insert into openerp.supplier_acceptance_approvals(book_id,id,review_id,ordinal,actor_id,digest,expires_at,body)
       values($1,$2,$3,1,$4,$5,$6::timestamptz,$7::jsonb)`,
      [
        scope.bookId,
        approval.id,
        review.id,
        fixture.actor.id,
        review.digest,
        expiresAt,
        JSON.stringify(approval),
      ],
    );

    const view = await request(
      `/commerce/supplier-acceptance-reviews/${encodeURIComponent(review.id)}`,
    );

    if (
      view.plan.id !== review.id ||
      view.plan.digest !== review.digest ||
      view.approval?.id !== approval.id ||
      view.approvalObservation?.state !== "expired" ||
      view.approvalObservation.actorName !== fixture.actor.name ||
      !view.approvalObservation.proposalMatches ||
      !view.approvalObservation.callerMatches ||
      !view.dependenciesCurrent ||
      view.approvalUsable ||
      view.acceptance !== null
    )
      throw new Error(
        "Native supplier review did not observe the exact unconsumed expired fixture",
      );

    const original = await request("/source-occurrences", {
      destination: "supplier_inbox",
      sourceSystem: "manual-upload",
      sourceAccountId: scope.bookId,
      occurrenceKey: "paper_expiry_unclassified_original",
      sourceRevision: "1",
      filename: "Skannad_bild_0931.jpg",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(
        "Synthetic unclassified original. Filename retained as uploaded. No interpreted facts.",
      ).toString("base64"),
    });

    const attention = await request("/attention?status=open&sort=oldest");
    const proposal = attention.items.find((item) => item.supplierReview?.reviewId === review.id);

    if (
      !proposal ||
      proposal.supplierReview.digest !== review.digest ||
      proposal.supplierReview.approvalObservation.state !== "expired" ||
      proposal.supplierReview.approvalExpiresAt !== expiresAt ||
      !proposal.supplierReview.dependenciesCurrent ||
      !attention.items.some((item) => item.id === precedingJournal.id) ||
      !attention.items.some((item) => item.id === original.id)
    )
      throw new Error(
        "Native queue did not retain the exact expiry owner and actual adjacent fixture rows",
      );

    const receipt = {
      synthetic: true,
      scope,
      draftId: draft.id,
      reviewId: review.id,
      postingPlanId: review.postingPlan.id,
      precedingPostingPlanId: precedingJournal.id,
      unclassifiedOccurrenceId: original.id,
      approvalId: approval.id,
      digest: review.digest,
      expectedGrossMinor: "249000",
      expectedDebitMinor: "249000",
      expectedCreditMinor: "249000",
      historicalApprovalFixture: true,
      approvalCreatedAt: createdAt,
      approvalExpiresAt: expiresAt,
      expectedWindowMs: 3600000,
      observedAt: view.approvalObservation.observedAt,
      state: view.approvalObservation.state,
      posted: false,
      route: `/entities/${scope.entityId}/books/${scope.bookId}/`,
      purchaseRoute: `/entities/${scope.entityId}/books/${scope.bookId}/purchases?view=supplier-drafts&record=${draft.id}&review=${review.id}`,
      limitation:
        "Historical immutable approval inserted only in the disposable admin fixture. Proposal, observation and renewal use real native owners.",
      adjacentRowsLimitation:
        "Tryckhuset is a real prepared journal without a fabricated changed-source observation. The named uploaded original retains octet-stream bytes without accounting classification. Their native labels may differ from Paper.",
    };

    const artifact = join(artifacts, "supplier-expiry-seed.json");
    await writeFile(artifact, JSON.stringify(receipt, null, 2));

    return { seeded: true, artifact, reviewId: review.id, draftId: draft.id };
  } finally {
    await admin.end();
  }
}
