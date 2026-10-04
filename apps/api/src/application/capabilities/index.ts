import { foreignCashCapabilities } from "./foreign-cash";
import { payrollInputCapabilities } from "./payroll-inputs";
import { treasuryLoanCapabilities } from "./treasury-loans";
import { supplierSettlementCapabilities } from "./supplier-settlements";
import { evaluationCapabilities } from "./evaluations";
import { companyFirmCapabilities } from "./company-firms";
import { companyProfileCapabilities } from "./company-profiles";
import { workspaceCapabilities } from "./workspace";
import { taxAccountCapabilities } from "./tax-account";
import { commerceLegalCapabilities } from "./commerce-legal";
import { closingCapabilities } from "./closing";
import { financialCloseCapabilities } from "./financial-close";
import { collectionsCapabilities } from "./collections";
import { cashForecastCapabilities } from "./cash-forecast";
import { bankingCapabilities } from "./banking";
import { bankingSyncCapabilities } from "./bank-sync-windows";
import { bankingSourceRevisionCapabilities } from "./bank-source-revisions";
import { prepaymentCapabilities } from "./prepayments";
import { cashMethodCapabilities } from "./cash-method";
import { subledgerOwnerCapabilities } from "./subledger-owners";
import { commerceInvoiceCapabilities } from "./commerce-invoices";
import { purchaseRecognitionCapabilities } from "./purchase-recognition";
import { servicePurchaseCapabilities } from "./service-purchases";
import { supplierRefundCapabilities } from "./supplier-refunds";
import { vatCapabilities } from "./vat";
import { vatAssessmentCapabilities } from "./vat-assessment";
import { runCaseCapabilities } from "./runs-cases";
import { periodWorkCapabilities } from "./period-work";
import { reportCapabilities } from "./reports";
import { reportStatementCapabilities } from "./report-statements";
import { cashFlowCapabilities } from "./cash-flow";
import { paymentResolutionCapabilities } from "./payment-resolutions";
import { partyIdentityCapabilities } from "./party-identity";
import { annualReportCapabilities } from "./annual-report";
import { sourceIntakeCapabilities } from "./source-intake";
import { fxCapabilities } from "./fx";
import { reviewCapabilities } from "./review";
import { sieCapabilities } from "./sie";
import { sie4ECapabilities } from "./sie4e";
import { ledgerCapabilities } from "./ledger";
import { payrollRunCapabilities } from "./payroll-runs";
import { payrollCalculationCapabilities } from "./payroll-calculations";
import { dimensionCapabilities } from "./dimensions";
import { corporateTaxCapabilities } from "./corporate-tax";
import { Capabilities } from "@open-erp/contracts/capabilities";

export const capabilities = {
  ...supplierSettlementCapabilities,
  ...companyFirmCapabilities,
  ...companyProfileCapabilities,
  ...evaluationCapabilities,

  ...workspaceCapabilities,
  ...taxAccountCapabilities,
  ...commerceLegalCapabilities,
  ...closingCapabilities,
  ...financialCloseCapabilities,
  ...collectionsCapabilities,
  ...bankingCapabilities,
  ...cashForecastCapabilities,
  ...bankingSyncCapabilities,
  ...bankingSourceRevisionCapabilities,
  ...prepaymentCapabilities,
  ...cashMethodCapabilities,
  ...subledgerOwnerCapabilities,
  ...commerceInvoiceCapabilities,
  ...purchaseRecognitionCapabilities,
  ...servicePurchaseCapabilities,
  ...supplierRefundCapabilities,
  ...vatCapabilities,
  ...vatAssessmentCapabilities,
  ...runCaseCapabilities,
  ...periodWorkCapabilities,
  ...reportCapabilities,
  ...reportStatementCapabilities,
  ...cashFlowCapabilities,
  ...paymentResolutionCapabilities,
  ...partyIdentityCapabilities,
  ...annualReportCapabilities,
  ...sourceIntakeCapabilities,
  ...fxCapabilities,
  ...reviewCapabilities,
  ...sieCapabilities,
  ...sie4ECapabilities,
  ...ledgerCapabilities,
  ...payrollCalculationCapabilities,
  ...payrollRunCapabilities,
  ...foreignCashCapabilities,
  ...payrollInputCapabilities,
  ...treasuryLoanCapabilities,
  ...dimensionCapabilities,
  ...corporateTaxCapabilities,
} satisfies Record<keyof typeof Capabilities, { readonly readOnly: boolean }>;
