import type * as Accounting from "../../../packages/contracts/src/accounting";
import type * as Corrections from "../../../packages/contracts/src/corrections";
import type {
  FiledVatCorrectionEvidence,
  ReopeningCorrectionEvidence,
} from "../../../apps/web/src/components/corrections/blocked-impact-workspace";
import type { CorrectionPresentationEvidence } from "../../../apps/web/src/components/corrections/presentation-evidence";

export const scope = { entityId: "entity_correction_q45", bookId: "book_correction_q45" };

export const digest = `sha256:7f3a91c2b04e${"0".repeat(52)}`;

export const currentDigest = `sha256:5d20c77a18f3${"0".repeat(52)}`;

const rationale =
  "Fel konto: 6550 ska vara 4010. Originalet bevaras, backas exakt och ersätts i ett enda steg i oktober.";

export const setup = {
  today: "2026-10-04",
  accounts: [
    { id: "account_6550", code: "6550", name: "Konsultarvoden", active: true },
    { id: "account_4010", code: "4010", name: "Inköp tjänster", active: true },
    { id: "account_2640", code: "2640", name: "Ingående moms", active: true },
    { id: "account_2440", code: "2440", name: "Leverantörsskulder", active: true },
  ],
  periods: [
    { id: "period_september", startsOn: "2026-09-01", endsOn: "2026-09-30", locked: true },
    { id: "period_october", startsOn: "2026-10-01", endsOn: "2026-10-31", locked: false },
  ],
  blockers: [],
  warnings: [],
} satisfies typeof Accounting.BookSetup.Type;

function lines(expense: "6550" | "4010", reverse = false) {
  return [
    {
      accountId: `account_${expense}`,
      debitMinor: reverse ? "0" : "1000000",
      creditMinor: reverse ? "1000000" : "0",
      description: "Konsultarvoden",
      lineId: `line_${expense}`,
    },
    {
      accountId: "account_2640",
      debitMinor: reverse ? "0" : "250000",
      creditMinor: reverse ? "250000" : "0",
      description: "Ingående moms",
      lineId: "line_2640",
    },
    {
      accountId: "account_2440",
      debitMinor: reverse ? "1250000" : "0",
      creditMinor: reverse ? "0" : "1250000",
      description: "Leverantörsskulder",
      lineId: "line_2440",
    },
  ];
}

function action(id: string, expense: "6550" | "4010", reverse = false) {
  return {
    kind: "post_voucher",
    correctsVoucherId: id === "event_original" ? null : "voucher_original",
    eventId: id,
    postingPurpose: reverse ? "reversal" : "adjustment",
    occurrenceKey: id,
    fiscalYearId: "year_correction_q45",
    accountingPeriodId: id === "event_original" ? "period_september" : "period_october",
    postingDate: id === "event_original" ? "2026-09-30" : "2026-10-04",
    series: "A",
    currency: "SEK",
    description: "Nordhamn Studio AB, faktura 1048",
    rationale,
    taxAssessment: "not_applicable",
    lines: lines(expense, reverse),
    evidenceRefs: [],
  } satisfies typeof Accounting.PostingAction.Type;
}

function plan(id: string, expense: "6550" | "4010", reverse = false) {
  return {
    schemaVersion: "1",
    canonicalization: "openerp-c14n-v1",
    id,
    version: 1,
    scope,
    createdAt: "2026-10-04T10:41:00Z",
    dependencies: [],
    groups: [
      {
        id: `group_${id}`,
        dependsOnGroupIds: [],
        actions: [action(`event_${id}`, expense, reverse)],
      },
    ],
    planDigest: digest,
  } satisfies typeof Accounting.ChangeSet.Type;
}

export const invoice = {
  kind: "invoice_recognition_replacement_v1",
  invoiceId: "invoice_1048",
  documentNumber: "1048",
  counterpartyName: "Nordhamn Studio AB",
  originalRecognitionVoucherId: "voucher_original",
  predecessorVoucherId: "voucher_original",
  controlAccountId: "account_2440",
  amountMinor: "1250000",
  allocatedMinor: "500000",
  outstandingMinor: "750000",
  invoiceRevision: "1",
  allocationVersion: "1",
  beforeExpense: [
    {
      accountId: "account_6550",
      debitMinor: "1000000",
      creditMinor: "0",
      description: "Konsultarvoden",
    },
  ],
  afterExpense: [
    {
      accountId: "account_4010",
      debitMinor: "1000000",
      creditMinor: "0",
      description: "Inköp tjänster",
    },
  ],
  sourceOwners: [],
  basisDigest: digest,
} satisfies typeof Corrections.InvoiceRecognitionContribution.Type;

export const bundle = {
  id: "r_0007",
  version: 1,
  scope,
  originalVoucher: {
    id: "voucher_original",
    number: "148",
    sequence: "148",
    recordedAt: "2026-09-30T12:00:00Z",
    action: action("event_original", "6550"),
  },
  datePolicy: "explicit_open_period",
  rationale,
  reversal: plan("plan_reversal", "6550", true),
  replacement: plan("plan_replacement", "4010"),
  createdAt: "2026-10-04T10:41:00Z",
  createdBy: "actor_synthetic_preparer",
  bundleDigest: digest,
  impactReview: { id: "impact_q45", digest },
  registerContribution: invoice,
} satisfies typeof Corrections.CorrectionBundle.Type;

export const basis = {
  intent: {
    datePolicy: "explicit_open_period",
    accountingPeriodId: "period_october",
    postingDate: "2026-10-04",
    rationale,
    replacement: {
      description: "Nordhamn Studio AB, faktura 1048",
      lines: lines("4010").map(({ accountId, debitMinor, creditMinor, description }) => ({
        accountId,
        debitMinor,
        creditMinor,
        description,
      })),
    },
  },
  chain: {
    scope,
    selectedVoucherId: "voucher_original",
    rootVoucherId: "voucher_original",
    sequence: "148",
    vouchers: [bundle.originalVoucher],
    receipts: [],
    balances: [],
  },
  resources: [
    {
      kind: "bank_match",
      id: "match_october",
      detail: "Matchningen 1 okt bevaras. Ingen ny bankobservation skapas.",
      path: "/bank/match",
      blocks: false,
    },
    {
      kind: "report",
      id: "report_september",
      detail:
        "Resultat september oförändrat, 54 608,00. Resultat oktober: samma summa, kontofördelningen ändras. Sparade rapportbilder behåller sitt innehåll.",
      path: "/report-snapshots/report_september",
      blocks: false,
    },
  ],
  blockers: [],
  configurationDigest: digest,
  netChange: [
    { accountId: "account_6550", deltaMinor: "-1000000" },
    { accountId: "account_4010", deltaMinor: "1000000" },
  ],
  executable: false,
  limitations: ["Isolated visual fixture only."],
  registerContribution: invoice,
} satisfies typeof Corrections.CorrectionImpactBasis.Type;

export const impact = {
  impact: {
    id: "impact_q45",
    scope,
    voucherId: "voucher_original",
    createdBy: "actor_synthetic_preparer",
    createdAt: "2026-10-04T10:41:00Z",
    basis,
    digest,
  },
  snapshotCurrent: true,
  executable: false,
  currentBasis: basis,
  currentDigest: digest,
  storedBasisDigest: digest,
} satisfies typeof Corrections.CorrectionImpactView.Type;

export const staleImpact = {
  ...impact,
  snapshotCurrent: false,
  currentDigest,
  currentBasis: {
    ...basis,
    registerContribution: {
      ...invoice,
      allocatedMinor: "1250000",
      outstandingMinor: "0",
      allocationVersion: "2",
      basisDigest: currentDigest,
    },
  },
} satisfies typeof Corrections.CorrectionImpactView.Type;

const blockedSnapshot = {
  ...impact,
  impact: {
    ...impact.impact,
    id: "impact_q46",
    basis: {
      ...basis,
      intent: {
        ...basis.intent,
        replacement: {
          description: "Vinter & Co AB, faktura 3290",
          lines: lines("6550").map(({ accountId, debitMinor, creditMinor, description }) => ({
            accountId,
            debitMinor,
            creditMinor,
            description,
          })),
        },
        rationale:
          "A139 gäller faktura 3290 från Vinter & Co AB, 12 500,00. Ingående moms bokfördes som 1 200,00 men fakturan visar 2 500,00. Momsen hör till september, som är låst och redan deklarerad.",
      },
      chain: {
        ...basis.chain,
        vouchers: [
          {
            ...bundle.originalVoucher,
            number: "139",
            action: {
              ...bundle.originalVoucher.action,
              description: "Vinter & Co AB, faktura 3290",
              lines: bundle.originalVoucher.action.lines.map((line) => {
                if (line.accountId === "account_2640") return { ...line, debitMinor: "120000" };

                if (line.accountId === "account_2440") return { ...line, creditMinor: "1120000" };

                return line;
              }),
            },
          },
        ],
      },
      resources: [
        {
          kind: "closing",
          id: "period_september",
          detail:
            "Period september är låst. Stängningsunderlag och momsunderlag blir inaktuella om den öppnas och görs om. Öppnandet har separat godkännande.",
          path: "/closing-certificates/period_september",
          blocks: true,
        },
        {
          kind: "owner_record",
          id: "filed_vat_september",
          detail:
            "Momsdeklaration september, inlämnad 4 okt, kvittens 15:30. Ruta 48: 12 340,00 inlämnad, 13 640,00 efter rättelse, +1 300,00. Ruta 49: 24 660,00 inlämnad, 23 360,00 efter rättelse, −1 300,00. Inlämnad deklaration och kvittens bevaras oförändrade. En rättad deklaration och dess påverkansärende har eget arbetsflöde och godkännande.",
          path: "/owner-register/records/filed_vat_september",
          blocks: true,
        },
        {
          kind: "report",
          id: "report_september",
          detail: "Sparade rapportbilder behåller sitt innehåll.",
          path: "/report-snapshots/report_september",
          blocks: false,
        },
      ],
      blockers: [
        {
          code: "PeriodLocked",
          message:
            "Bokför bara kontot i oktober, utan att ändra momsen: stoppad. Det rättar inte felet, momsen och skulden skulle fortsätta avvika från fakturan.",
        },
      ],
      registerContribution: undefined,
      netChange: [
        { accountId: "account_2640", deltaMinor: "130000" },
        { accountId: "account_2440", deltaMinor: "-130000" },
      ],
    },
  },
} satisfies typeof Corrections.CorrectionImpactView.Type;

export const blockedImpact = {
  ...blockedSnapshot,
  currentBasis: blockedSnapshot.impact.basis,
} satisfies typeof Corrections.CorrectionImpactView.Type;

export const presentation = {
  originalVoucherId: bundle.originalVoucher.id,
  bundleDigest: bundle.bundleDigest,
  bundleLabel: "R-0007",
  reversalLabel: "A158",
  replacementLabel: "A159",
  preparerName: "Sara Lind",
  approverName: "Elin Sund",
  allocationDate: "2026-10-01",
  allocationCount: 1,
  currentAllocationCount: 2,
  deniedAt: "2026-10-04T14:20:00Z",
  changedAt: "2026-10-04T14:05:00Z",
  changedBy: "Maja Ek",
  reason: "Fel konto, ska vara 4010",
  vatPeriod: "september",
  vatAccountId: "account_2640",
  synthetic: true,
} satisfies CorrectionPresentationEvidence;

export const filedVat = {
  status: "filed",
  impactDigest: blockedImpact.impact.digest,
  originalVoucherId: blockedImpact.impact.voucherId,
  periodId: "period_september",
  returnId: "synthetic_filed_vat_september",
  acknowledgementId: "synthetic_acknowledgement_september",
  filedOn: "2026-10-04",
  acknowledgementTime: "15:30",
  boxes: [
    { box: "48", filedMinor: "1234000", proposedMinor: "1364000" },
    { box: "49", filedMinor: "2466000", proposedMinor: "2336000" },
  ],
} satisfies FiledVatCorrectionEvidence;

export const reopening = {
  status: "awaiting_approval",
  impactDigest: blockedImpact.impact.digest,
  originalVoucherId: blockedImpact.impact.voucherId,
  requesterName: "Sara Lind",
  reviewerName: "Elin Sund",
} satisfies ReopeningCorrectionEvidence;
