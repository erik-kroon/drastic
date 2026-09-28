import { companyFirmCapabilities } from "./company-firms";
import { companyProfileCapabilities } from "./company-profiles";
import { workspaceCapabilities } from "./workspace";
import { taxAccountCapabilities } from "./tax-account";
import { commerceLegalCapabilities } from "./commerce-legal";
import { closingCapabilities } from "./closing";
import { financialCloseCapabilities } from "./financial-close";
import { collectionsCapabilities } from "./collections";
import { bankingCapabilities } from "./banking";
import { subledgerOwnerCapabilities } from "./subledger-owners";
import { commerceInvoiceCapabilities } from "./commerce-invoices";
import { purchaseRecognitionCapabilities } from "./purchase-recognition";
import { servicePurchaseCapabilities } from "./service-purchases";
import { vatCapabilities } from "./vat";
import { runCaseCapabilities } from "./runs-cases";
import { periodWorkCapabilities } from "./period-work";
import { reportCapabilities } from "./reports";
import { reportStatementCapabilities } from "./report-statements";
import { annualReportCapabilities } from "./annual-report";
import { sourceIntakeCapabilities } from "./source-intake";
import { fxCapabilities } from "./fx";
import { reviewCapabilities } from "./review";
import { sieCapabilities } from "./sie";
import { sie4ECapabilities } from "./sie4e";
import { ledgerCapabilities } from "./ledger";
import { payrollCalculationCapabilities } from "./payroll-calculations";
import { dimensionCapabilities } from "./dimensions";
import { corporateTaxCapabilities } from "./corporate-tax";
import { Capabilities } from "@open-erp/contracts/capabilities";

export const capabilities = {
  ...companyFirmCapabilities,
  ...companyProfileCapabilities,
  ...workspaceCapabilities,
  ...taxAccountCapabilities,
  ...commerceLegalCapabilities,
  ...closingCapabilities,
  ...financialCloseCapabilities,
  ...collectionsCapabilities,
  ...bankingCapabilities,
  ...subledgerOwnerCapabilities,
  ...commerceInvoiceCapabilities,
  ...purchaseRecognitionCapabilities,
  ...servicePurchaseCapabilities,
  ...vatCapabilities,
  ...runCaseCapabilities,
  ...periodWorkCapabilities,
  ...reportCapabilities,
  ...reportStatementCapabilities,
  ...annualReportCapabilities,
  ...sourceIntakeCapabilities,
  ...fxCapabilities,
  ...reviewCapabilities,
  ...sieCapabilities,
  ...sie4ECapabilities,
  ...ledgerCapabilities,
  ...payrollCalculationCapabilities,
  ...dimensionCapabilities,
  ...corporateTaxCapabilities,
} satisfies Record<keyof typeof Capabilities, { readonly readOnly: boolean }>;
