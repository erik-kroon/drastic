import { randomUUID } from "node:crypto";

export const workGroupAccounts = [
  { id: "group_expense", code: "6110", name: "Kontorsmaterial" },
  { id: "group_payable", code: "2440", name: "Leverantörsskulder" },
  { id: "group_vat", code: "2641", name: "Ingående moms" },
];

export async function seedWorkGroup({ base, cookie, periodId }) {
  const origin = new URL(base);

  if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
    throw new Error("Work group fixture requires the disposable loopback runtime");

  async function call(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        cookie,
        origin: origin.origin,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`Work group fixture ${path}: HTTP ${response.status}`);

    return response.json();
  }

  const source = await call("/evidence", {
    title: "Retained synthetic group originals",
    content:
      "Independent fixture: each invoice net10000 tax2500 gross12500 SEK minor units. No payment.",
    mediaType: "text/plain",
    origin: "DRA105 synthetic native group qualification",
  });

  const supplier = await call("/commerce/counterparties", {
    kind: "synthetic_counterparty_v1",
    externalKey: randomUUID(),
    role: "supplier",
    displayName: "Tallvik gruppleverantör",
    evidenceId: source.id,
    reason: "Synthetic qualification",
  });

  const identity = {
    legalName: supplier.displayName,
    registrationId: "5560000001",
    taxId: null,
    address: "Synthetic road 1",
    countryCode: "SE",
    evidenceId: source.id,
  };

  const treatment = {
    basis: "full_deduction",
    rate: { numerator: "25", denominator: "100" },
    deduction: { numerator: "1", denominator: "1" },
    invoiceTaxRounding: "half_up",
    deductionRounding: "half_up",
    acceptancePolicy: "exact_match",
    toleranceMinor: "0",
  };

  async function prepare(number, party = supplier) {
    const original = await call("/evidence", {
      title: `Retained group invoice ${number}`,
      content: `Synthetic distinct original ${number}: net10000 tax2500 gross12500 SEK minor units`,
      mediaType: "text/plain",
      origin: "DRA105 retained original",
    });

    const draft = await call("/commerce/supplier-invoice-drafts", {
      draftKey: `group_${randomUUID()}`,
      content: {
        title: `Tallvik grupp ${number}`,
        counterpartyId: party.id,
        counterpartyRevision: party.revision,
        supplier: { ...identity, legalName: party.displayName },
        buyer: identity,
        sourceEvidenceId: original.id,
        supplierDocumentNumber: number,
        currency: "SEK",
        currencyScale: 2,
        documentDate: "2026-10-03",
        supplyDate: "2026-10-03",
        dueDate: "2026-10-14",
        paymentTerms: "Synthetic terms",
        sourceTotalMinor: "12500",
        lines: [
          {
            id: "line_group",
            description: "Synthetic office supplies",
            quantity: "1",
            unitPriceMinor: "10000",
            baseMinor: "10000",
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: "2500",
            taxDescription: "Swedish standard 25%",
            taxEvidenceId: original.id,
            sourceGrossMinor: "12500",
          },
        ],
      },
    });

    return call("/commerce/supplier-acceptance-reviews", {
      profile: "swedish-purchase-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "group_payable",
      accountingPeriodId: periodId,
      series: "A",
      reason: "Synthetic reviewed group fixture",
      acknowledgeSyntheticOnly: true,
      taxPoint: { taxPointOn: "2026-10-03", basis: "document_date" },
      lineAssignments: [{ lineId: "line_group", expenseAccountId: "group_expense", treatment }],
    });
  }

  const prior = await prepare("G-000");
  const input = { version: 1, digest: prior.digest, acknowledgeSyntheticOnly: true };
  const approval = await call(`/commerce/supplier-acceptance-reviews/${prior.id}/approvals`, input);

  const receipt = await call(`/commerce/supplier-acceptance-reviews/${prior.id}/execute`, {
    ...input,
    approvalId: approval.id,
  });

  const candidates = [await prepare("G-001"), await prepare("G-002")];

  const changed = await prepare("G-003");

  const newcomer = await call("/commerce/counterparties", {
    kind: "synthetic_counterparty_v1",
    externalKey: randomUUID(),
    role: "supplier",
    displayName: "Ny gruppleverantör",
    evidenceId: source.id,
    reason: "Synthetic new supplier exclusion",
  });

  const unfamiliar = await prepare("G-NEW", newcomer);

  return {
    changed,
    unfamiliar,
    priorReceiptId: receipt.id,
    candidates,
    expectedNetMinor: "20000",
    expectedTaxMinor: "5000",
    expectedGrossMinor: "25000",
  };
}
