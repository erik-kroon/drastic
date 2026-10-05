import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

export const assetAccounts = [
  { id: "account_ar", code: "1510", name: "Kundfordringar" },
  { id: "account_revenue", code: "3001", name: "Försäljning" },
  { id: "account_vat", code: "2611", name: "Utgående moms" },
  { id: "asset_gross", code: "1220", name: "Inventarier" },
  { id: "asset_ordinary", code: "1229", name: "Ackumulerade avskrivningar" },
  { id: "asset_expense", code: "7830", name: "Avskrivningar" },
  { id: "asset_loss", code: "7973", name: "Förlust vid avyttring" },
  { id: "asset_income", code: "3973", name: "Vinst vid avyttring" },
];

export async function assetClients(config) {
  const { apiUrl, adminUrl, fixture, accessToken } = config;

  if (
    new URL(apiUrl).hostname !== "127.0.0.1" ||
    new URL(adminUrl).hostname !== "127.0.0.1" ||
    fixture.book.id !== "book_synthetic" ||
    fixture.entity.id !== "entity_synthetic"
  )
    throw new Error("Asset fixture requires the disposable loopback runtime");

  const { Client } = createRequire(
    join(resolve(import.meta.dirname, "../../apps/api"), "package.json"),
  )("pg");

  const admin = new Client({ connectionString: adminUrl });

  await admin.connect();

  async function human(actorId) {
    const token = randomBytes(32).toString("hex");

    await admin.query(
      `insert into openerp.actors(id,name) values ($1,'Synthetic asset reviewer') on conflict do nothing`,
      [actorId],
    );
    await admin.query(
      `insert into openerp.memberships(book_id,actor_id,role) values ($1,$2,'operator') on conflict do nothing`,
      [fixture.book.id, actorId],
    );
    await admin.query(
      `insert into openerp_auth."user"(id,name,email) values ($1,'Synthetic asset reviewer',$2) on conflict do nothing`,
      [actorId, `${actorId}@example.test`],
    );
    await admin.query(
      `insert into openerp.identity_admissions(actor_id,provider_id,subject,enabled) values ($1,'e2e-current-session',$1,true) on conflict (actor_id) do update set enabled=true`,
      [actorId],
    );
    await admin.query(
      `insert into openerp_auth.session(id,token,user_id,expires_at) values ($1,$2,$3,now()+interval '1 hour')`,
      [randomUUID(), token, actorId],
    );

    return { token };
  }

  try {
    const author = await human(fixture.actor.id);

    const reviewer = await human("paper_asset_reviewer");

    const activator = await human("paper_asset_activator");

    const date = await admin.query(
      "select (clock_timestamp() at time zone 'UTC')::date::text as today",
    );

    async function post(actor, path, input) {
      const response = await fetch(
        `${apiUrl}/api/v1/entities/${fixture.entity.id}/books/${fixture.book.id}${path}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${actor.token}`,
            "content-type": "application/json",
            "idempotency-key": randomUUID(),
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(120000),
        },
      );

      const result = await response.json();

      if (!response.ok)
        throw new Error(`Asset fixture ${path} refused ${response.status} ${result.code}`);

      return result;
    }

    const book = { token: accessToken };

    const source = await post(book, "/evidence", {
      title: "Synthetic asset source",
      mediaType: "text/plain",
      content: "Disposable asset fixture, no real company",
      origin: "Q34 synthetic browser fixture",
    });

    const reviewSource = await post(book, "/evidence", {
      title: "Synthetic independent asset review",
      mediaType: "text/plain",
      content: "Independent synthetic review of retained opening and invoice",
      origin: "Q34 synthetic reviewer",
    });

    return {
      book,
      author,
      reviewer,
      activator,
      today: date.rows[0].today,
      source,
      reviewSource,
      post,
    };
  } finally {
    await admin.end();
  }
}

const key = () => randomUUID();

export async function issueAssetInvoice(clients, fixture) {
  const { author, reviewer, activator, post } = clients;

  const { source, today } = clients;

  const invoice = {
    sourceTotalMinor: "962500",
    lines: [
      {
        id: "paper_laptop_line",
        description: "Laptop Pro 14",
        quantity: "1",
        unitPriceMinor: "650000",
        baseMinor: "650000",
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "162500",
        taxDescription: "se-domestic-standard-25-v1",
        sourceGrossMinor: "812500",
      },
      {
        id: "paper_monitor_line",
        description: "Bildskärm 27 tum",
        quantity: "1",
        unitPriceMinor: "120000",
        baseMinor: "120000",
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "30000",
        taxDescription: "se-domestic-standard-25-v1",
        sourceGrossMinor: "150000",
      },
    ],
  };

  const ref = { evidenceId: source.id, sha256: source.sha256 };

  const seller = {
    legalName: "FWD-05 Synthetic Seller",
    registrationNumber: "556677-8899",
    vatRegistrationNumber: "SE556677889901",
    postalAddress: "Synthetic address, not a real company",
    countryCode: "SE",
  };

  const candidate = await post(author, "/commerce/invoice-policies", {
    profileKey: "fwd05_synthetic",
    sellerIdentity: seller,
    sellerEvidence: ref,
    legalNumbering: "sequential-per-series-v1",
    numberingEvidence: ref,
    vatTreatment: "se-domestic-standard-25-v1",
    vatEvidence: ref,
    roundingMethod: "line-tax-half-up-minor-v1",
    roundingEvidence: ref,
    creditNotePolicy: "Link the original and retain exact credit capacity; no refund.",
    correctionPolicy: "Preserve the original and issue a linked correction.",
    correctionEvidence: ref,
    effectiveFrom: today,
    reason: "Isolated synthetic qualification only",
    acknowledgeUnactivated: true,
  });

  const review = await post(reviewer, `/commerce/invoice-policies/${candidate.id}/review`, {
    candidateDigest: candidate.digest,
    reviewEvidence: ref,
    findings: "Synthetic fixture for the existing bounded profile, not company qualification.",
    acknowledgeNoLegalActivation: true,
  });

  const policy = await post(activator, "/commerce/legal-sales-policies", {
    candidateId: candidate.id,
    candidateDigest: candidate.digest,
    reviewId: review.id,
    reviewDigest: review.digest,
    series: "F-2026",
    ruleVersion: "se-domestic-standard-25-2023-200-v1",
    sourceEvidence: ref,
    activationEvidence: ref,
    reason: "Synthetic native workflow exercise",
    acceptReviewedPolicy: true,
    acknowledgeIssueBlocked: true,
  });

  const profile = await post(author, "/commerce/ar-legal-accounting-profiles", {
    policyId: policy.id,
    policyDigest: policy.digest,
    profile: "se-domestic-b2b-sek-25-accrual-v1",
    accountingMethod: "accrual",
    ruleVersion: "se-domestic-standard-25-2023-200-v1",
    effectiveFrom: today,
    controlAccountId: "account_ar",
    revenueAccountId: "account_revenue",
    outputVatAccountId: "account_vat",
    accountRoleEvidence: ref,
    reason: "Synthetic role mapping",
    acceptLegalAccounting: true,
  });

  const customer = await post(author, "/commerce/counterparties", {
    kind: "synthetic_counterparty_v1",
    externalKey: key(),
    role: "customer",
    displayName: "FWD-05 Synthetic Customer",
    evidenceId: source.id,
    reason: "Synthetic fixture",
  });

  const draft = await post(author, "/commerce/invoice-drafts", {
    draftKey: `credit_fixture_${key()}`,
    content: {
      title: "Synthetic credit document journey",
      counterpartyId: customer.id,
      counterpartyRevision: customer.revision,
      seller: {
        legalName: seller.legalName,
        registrationId: seller.registrationNumber,
        taxId: seller.vatRegistrationNumber,
        address: seller.postalAddress,
        countryCode: "SE",
        evidenceId: source.id,
      },
      customer: {
        legalName: customer.displayName,
        registrationId: "556677-8808",
        taxId: null,
        address: "Synthetic customer address",
        countryCode: "SE",
        evidenceId: source.id,
      },
      currency: "SEK",
      currencyScale: 2,
      plannedIssueDate: today,
      supplyDate: today,
      dueDate: today,
      paymentTerms: "Synthetic only; no payment requested",
      sourceTotalMinor: invoice?.sourceTotalMinor ?? "12500",
      lines: invoice
        ? invoice.lines.map((line) => ({ ...line, taxEvidenceId: source.id }))
        : [
            {
              id: "line_1",
              description: "Synthetic service",
              quantity: "1",
              unitPriceMinor: "10000",
              baseMinor: "10000",
              discountMinor: "0",
              chargeMinor: "0",
              taxMinor: "2500",
              taxDescription: "se-domestic-standard-25-v1",
              taxEvidenceId: source.id,
              sourceGrossMinor: "12500",
            },
          ],
    },
  });

  const issueReview = await post(author, "/commerce/ar-legal-issue-reviews", {
    profile: "se-domestic-b2b-sek-25-accrual-v1",
    draftId: draft.id,
    expectedRevision: draft.revision,
    expectedDigest: draft.digest,
    policyId: policy.id,
    policyDigest: policy.digest,
    accountingProfileId: profile.id,
    accountingProfileDigest: profile.digest,
    controlAccountId: "account_ar",
    revenueAccountId: "account_revenue",
    outputVatAccountId: "account_vat",
    accountingPeriodId: fixture.periods[0].id,
    voucherSeries: "A",
    reason: "Synthetic original issue",
    acknowledgeLimitedProfile: true,
  });

  const approvalInput = { version: 1, digest: issueReview.digest, acknowledgeLimitedProfile: true };

  const issueApproval = await post(
    reviewer,
    `/commerce/ar-legal-issue-reviews/${issueReview.id}/approvals`,
    approvalInput,
  );

  const original = await post(
    reviewer,
    `/commerce/ar-legal-issue-reviews/${issueReview.id}/execute`,
    { ...approvalInput, approvalId: issueApproval.id },
  );

  return original;
}
