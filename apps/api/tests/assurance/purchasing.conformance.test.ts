import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as P from "@open-erp/domain/purchasing";
import * as Refund from "@open-erp/domain/supplier-refunds";
import { failedWith, succeeded, independentJournalTotals } from "./pure-support";

function treatment(deduction = "1", denominator = "1"): P.PurchaseTreatment {
  return {
    treatmentId: "domestic_fixture",
    rate: { numerator: "1", denominator: "4" },
    deduction: { numerator: deduction, denominator },
    invoiceTaxRounding: "half_up",
    deductionRounding: "half_up",
    acceptancePolicy: "exact_match",
    toleranceMinor: "0",
    basis: "Synthetic declared treatment, not real company eligibility",
  };
}

function source(
  id = "line_one",
  net = "10000",
  tax = "2500",
  selected = treatment(),
): P.PurchaseSourceLine {
  return {
    sourceLineId: id,
    expenseAccountId: "account_expense",
    netMinor: net,
    sourceTaxMinor: tax,
    sourceGrossMinor: (BigInt(net) + BigInt(tax)).toString(),
    treatment: selected,
    sourceRefs: [{ evidenceId: "evidence_fixture", sourceKey: `source:${id}` }],
  };
}

function input(
  lines: ReadonlyArray<P.PurchaseSourceLine>,
  prefix = "recognition_one",
): P.PurchaseRecognitionInput {
  return Schema.decodeSync(P.PurchaseRecognitionInput)({
    currencyScale: 2,
    recognitionDate: "2026-08-31",
    taxPoint: { taxPointOn: "2026-08-31", basis: "document_date" },
    funding: {
      accountId: "account_payable",
      role: "supplier_payable",
      inputVatAccountId: "account_inputvat",
    },
    reportingObligationId: null,
    ruleReleaseId: null,
    taxComponentPrefix: prefix,
    lines,
  });
}

function original(): P.OriginalLineCapacity {
  return {
    sourceLineId: "line_original",
    expenseAccountId: "account_expense",
    inputVatAccountId: "account_inputvat",
    originalNetMinor: "100",
    originalSourceTaxMinor: "25",
    originalDeductibleTaxMinor: "13",
    creditedNetMinor: "0",
    creditedSourceTaxMinor: "0",
    releasedDeductionMinor: "0",
    treatment: treatment("1", "2"),
    taxComponentId: "original_line_component",
    taxFactId: "original_line_fact",
  };
}

function credit(
  line: P.OriginalLineCapacity,
  net: string,
  tax: string,
  prefix: string,
): P.PurchaseCreditInput {
  return {
    currencyScale: 2,
    taxPoint: { taxPointOn: "2026-09-10", basis: "document_date" },
    reportingObligationId: null,
    ruleReleaseId: null,
    taxComponentPrefix: prefix,
    creditEvidence: { evidenceId: "evidence_credit", sourceKey: `credit:${prefix}` },
    original: [line],
    requested: [
      { sourceLineId: line.sourceLineId, creditNetMinor: net, creditSourceTaxMinor: tax },
    ],
  };
}

test("[ASR-PURCHASE-MULTILINE] exact totals and partial deduction survive public output schemas", () => {
  const actual = succeeded(
    P.compileDomesticPurchase(
      input([source("line_full"), source("line_half", "20000", "5000", treatment("1", "2"))]),
    ),
  );

  expect(Schema.decodeSync(P.PurchaseRecognitionPlan)(actual)).toEqual(actual);
  expect(actual).toMatchObject({
    totalNetMinor: "30000",
    totalSourceTaxMinor: "7500",
    totalDeductibleTaxMinor: "5000",
    totalNonDeductibleTaxMinor: "2500",
    payableMinor: "37500",
  });
  expect(independentJournalTotals(actual.journal)).toEqual({
    account_expense: "32500",
    account_inputvat: "5000",
    account_payable: "-37500",
  });
  expect(actual.taxFacts.map((f) => f.signedDeductibleTaxMinor)).toEqual(["2500", "2500"]);
  expect(new Set(actual.taxFacts.map((f) => f.taxFactId)).size).toBe(2);
});

test("[ASR-PURCHASE-ZERO-TAX] rounded zero tax retains semantics without a zero journal line", () => {
  const actual = succeeded(P.compileDomesticPurchase(input([source("line_tiny", "1", "0")])));
  expect(actual.journal).toHaveLength(2);
  expect(actual.taxFacts[0]?.signedDeductibleTaxMinor).toBe("0");
  expect(independentJournalTotals(actual.journal)).toEqual({
    account_expense: "1",
    account_payable: "-1",
  });
});

test("[ASR-PURCHASE-IDENTITY] local line IDs cannot collide across recognition identities", () => {
  const a = succeeded(P.compileDomesticPurchase(input([source()], "invoice_alpha")));
  const b = succeeded(P.compileDomesticPurchase(input([source()], "invoice_beta")));
  expect(a.taxFacts[0]?.taxFactId).not.toBe(b.taxFacts[0]?.taxFactId);
  expect(a.lines[0]?.taxFactId).toBe(a.taxFacts[0]?.taxFactId);
});

test("[ASR-PURCHASE-REFUSE] source amount, rate and duplicate identity refusals are specific", () => {
  failedWith(
    P.compileDomesticPurchase(input([{ ...source(), sourceGrossMinor: "12499" }])),
    "SourceAmountMismatch",
  );
  failedWith(
    P.compileDomesticPurchase(input([source("bad_tax", "10000", "2501")])),
    "SourceTaxMismatch",
  );
  failedWith(P.compileDomesticPurchase(input([source(), source()])), "DuplicateSourceLine");
  failedWith(
    P.compileDomesticPurchase(input([source("bad_deduction", "10000", "2500", treatment("2"))])),
    "DeductionOutOfRange",
  );
});

test("[ASR-PURCHASE-TOLERANCE] qualified source discrepancy is retained, never rewritten", () => {
  const selected = {
    ...treatment(),
    acceptancePolicy: "qualified_tolerance" as const,
    toleranceMinor: "1",
  };

  const actual = succeeded(
    P.compileDomesticPurchase(input([source("line_tolerance", "10000", "2501", selected)])),
  );

  expect(actual.payableMinor).toBe("12501");
  expect(actual.lines[0]).toMatchObject({
    sourceTaxMinor: "2501",
    taxDiscrepancyMinor: "1",
    taxDiscrepancyOutcome: "retained_discrepancy",
  });
  expect(independentJournalTotals(actual.journal)).toEqual({
    account_expense: "10000",
    account_inputvat: "2501",
    account_payable: "-12501",
  });
});

test("[ASR-CREDIT-SEQUENCE] two actual compiler calls release original deduction exactly once", () => {
  const first = succeeded(
    P.compileUnpaidPurchaseCredit({
      ...credit(original(), "40", "10", "credit_first"),
      payableAccountId: "account_payable",
      unpaidResidualMinor: "125",
    }),
  );

  expect(first.lines[0]?.releasedDeductionMinor).toBe("5");
  expect(first.taxAdjustments[0]?.adjustsTaxFactId).toBe("original_line_fact");

  const secondBasis = {
    ...original(),
    creditedNetMinor: "40",
    creditedSourceTaxMinor: "10",
    releasedDeductionMinor: "5",
  };

  const second = succeeded(
    P.compileUnpaidPurchaseCredit({
      ...credit(secondBasis, "60", "15", "credit_second"),
      payableAccountId: "account_payable",
      unpaidResidualMinor: "75",
    }),
  );

  expect(second.lines[0]?.releasedDeductionMinor).toBe("8");
  expect(second.lines[0]?.releasedDeductionAfterMinor).toBe("13");
  expect(independentJournalTotals(first.journal)).toEqual({
    account_expense: "-45",
    account_inputvat: "-5",
    account_payable: "50",
  });
  expect(independentJournalTotals(second.journal)).toEqual({
    account_expense: "-67",
    account_inputvat: "-8",
    account_payable: "75",
  });
  expect(second.taxAdjustments[0]?.adjustsTaxFactId).toBe(
    first.taxAdjustments[0]?.adjustsTaxFactId,
  );
  expect(second.taxAdjustments[0]?.taxFactId).not.toBe(first.taxAdjustments[0]?.taxFactId);
  failedWith(
    P.compileUnpaidPurchaseCredit({
      ...credit(secondBasis, "60", "15", "credit_refused"),
      payableAccountId: "account_payable",
      unpaidResidualMinor: "74",
    }),
    "UnpaidResidualExceeded",
  );
});

test("[ASR-PAID-CREDIT] paid-principal credit creates a refund asset, not negative payable", () => {
  const capacity = {
    ...original(),
    originalNetMinor: "100000",
    originalSourceTaxMinor: "25000",
    originalDeductibleTaxMinor: "25000",
    treatment: treatment(),
  };

  const selected = {
    ...credit(capacity, "40000", "10000", "credit_paid"),
    payableControlAccountId: "account_payable",
    refundReceivableAccountId: "account_refund",
    reservedMinor: "0",
    position: {
      originalGrossMinor: "125000",
      creditedMinor: "0",
      paidMinor: "100000",
      refundedMinor: "0",
    },
    creditNoteIdentity: "supplier-credit-1",
    knownCreditNoteIdentities: [],
  };

  const actual = succeeded(Refund.compilePaidSupplierCredit(selected));
  expect(actual).toMatchObject({
    apReleaseMinor: "25000",
    refundPrincipalIncreaseMinor: "25000",
    positionAfter: { unpaidMinor: "0", refundPrincipalMinor: "25000", refundDueMinor: "25000" },
  });
  expect(independentJournalTotals(actual.journal)).toEqual({
    account_expense: "-40000",
    account_inputvat: "-10000",
    account_payable: "25000",
    account_refund: "25000",
  });
  failedWith(
    Refund.compilePaidSupplierCredit({ ...selected, reservedMinor: "1" }),
    "ExportReservationUnresolved",
  );
  failedWith(
    Refund.compilePaidSupplierCredit({
      ...selected,
      knownCreditNoteIdentities: [selected.creditNoteIdentity],
    }),
    "DuplicateCreditIdentity",
  );
});

test("[ASR-PAID-POSITION] bounded generated states conserve unpaid and recoverable principal", () => {
  for (let gross = 1n; gross <= 24n; gross++) {
    for (let paid = 0n; paid <= gross; paid++) {
      for (let credited = 0n; credited <= gross; credited++) {
        const remaining = gross - paid - credited;
        const owed = remaining > 0n ? remaining : 0n;
        const principal = remaining < 0n ? -remaining : 0n;

        const actual = succeeded(
          Refund.derivePaidPosition({
            originalGrossMinor: String(gross),
            creditedMinor: String(credited),
            paidMinor: String(paid),
            refundedMinor: String(principal),
          }),
        );

        expect(actual).toEqual({
          unpaidMinor: String(owed),
          refundPrincipalMinor: String(principal),
          refundDueMinor: "0",
        });
      }
    }
  }

  failedWith(
    Refund.derivePaidPosition({
      originalGrossMinor: "125",
      creditedMinor: "50",
      paidMinor: "100",
      refundedMinor: "26",
    }),
    "RefundExceedsPrincipal",
  );
  failedWith(
    Refund.derivePaidPosition({
      originalGrossMinor: "125",
      creditedMinor: "0",
      paidMinor: "126",
      refundedMinor: "0",
    }),
    "PaymentExceedsOriginal",
  );
});
