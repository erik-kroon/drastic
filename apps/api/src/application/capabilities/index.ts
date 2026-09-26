import { companyFirmCapabilities } from "./company-firms";
import { companyProfileCapabilities } from "./company-profiles";
import { workspaceCapabilities } from "./workspace";
import { taxAccountCapabilities } from "./tax-account";
import { commerceLegalCapabilities } from "./commerce-legal";
import { closingCapabilities } from "./closing";
import { collectionsCapabilities } from "./collections";
import { bankingCapabilities } from "./banking";
import { subledgerOwnerCapabilities } from "./subledger-owners";
import { commerceInvoiceCapabilities } from "./commerce-invoices";
import { vatCapabilities } from "./vat";
import { runCaseCapabilities } from "./runs-cases";
import { reportCapabilities } from "./reports";
import { reportStatementCapabilities } from "./report-statements";
import { sourceIntakeCapabilities } from "./source-intake";
import { fxCapabilities } from "./fx";
import { reviewCapabilities } from "./review";
import { sieCapabilities } from "./sie";
import { ledgerCapabilities } from "./ledger";
import { Capabilities } from "@open-erp/contracts/capabilities";

export const capabilities = {
  ...companyFirmCapabilities,
  ...companyProfileCapabilities,
  ...workspaceCapabilities,
  ...taxAccountCapabilities,
  ...commerceLegalCapabilities,
  ...closingCapabilities,
  ...collectionsCapabilities,
  ...bankingCapabilities,
  ...subledgerOwnerCapabilities,
  ...commerceInvoiceCapabilities,
  ...vatCapabilities,
  ...runCaseCapabilities,
  ...reportCapabilities,
  ...reportStatementCapabilities,
  ...sourceIntakeCapabilities,
  ...fxCapabilities,
  ...reviewCapabilities,
  ...sieCapabilities,
  ...ledgerCapabilities,
} satisfies Record<keyof typeof Capabilities, { readonly readOnly: boolean }>;
