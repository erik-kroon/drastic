import * as Layer from "effect/Layer";
import { HistoricalMigrationHandlers } from "./routes/historical-migration";
import { CatalogHandlers } from "./routes/catalog";
import { CashFlowHandlers } from "./routes/cash-flow";
import { DecisionQuestionHandlers } from "./routes/decision-questions";
import { PayrollInputHandlers } from "./routes/payroll-inputs";
import { FinancialCloseHandlers } from "./routes/financial-close";
import { CommerceHandlers } from "./routes/commerce";
import { DeadlineHandlers } from "./routes/deadlines";
import { SettlementHandlers } from "./routes/settlements";
import { CompanyProfileHandlers } from "./routes/company-profile";
import { SieImportHandlers } from "./routes/sie-import";
import { BankMatchCandidateHandlers } from "./routes/bank-match-candidates";
import { EmployeeClaimHandlers } from "./routes/employee-claims";
import { SupplierInvoiceDraftHandlers } from "./routes/supplier-invoice-drafts";
import { CrmMasterHandlers } from "./routes/crm-master";
import { MileageCorrectionHandlers } from "./routes/mileage-corrections";
import { BankSignoffHandlers } from "./routes/bank-signoffs";
import { AccountingHandlers } from "./routes/accounting";
import { LegalSalesPolicyHandlers } from "./routes/legal-sales-policy";
import { TaxAccountHandlers } from "./routes/tax-account";
import { PayrollFoundationHandlers } from "./routes/payroll-foundation";
import { SupplierExtractionHandlers } from "./routes/supplier-extraction";
import { RuleImpactHandlers } from "./routes/rule-impact";
import { OwnerOperationHandlers } from "./routes/owner-operations";
import { PaymentResolutionHandlers } from "./routes/payment-resolutions";
import { DimensionHandlers } from "./routes/dimensions";
import { ReconciliationHandlers } from "./routes/reconciliation";
import { CashForecastHandlers } from "./routes/cash-forecast";
import { Sie4EHandlers } from "./routes/sie4e";
import { RecurringInvoiceHandlers } from "./routes/recurring-invoices";
import { SupplierSettlementHandlers } from "./routes/supplier-settlements";
import { ClosingHandlers } from "./routes/closing";
import { RegisterReportHandlers } from "./routes/register-reports";
import { SubledgerHandlers } from "./routes/subledgers";
import { CommerceFxHandlers } from "./routes/commerce-fx";
import { OnboardingHandlers } from "./routes/onboarding";
import { PartyIdentityHandlers } from "./routes/party-identity";
import { AutomationHandlers } from "./routes/automation";
import { VariablePayReviewHandlers } from "./routes/variable-pay-review";
import { DocumentSignatureHandlers } from "./routes/document-signatures";
import { ProcessorClearingHandlers } from "./routes/processor-clearing";
import { PayrollCalculationHandlers } from "./routes/payroll-calculations";
import { InvoiceDraftHandlers } from "./routes/invoice-drafts";
import { AccountantReviewHandlers } from "./routes/accountant-review";
import { ExchangeRatesHandlers } from "./routes/exchange-rates";
import { SupplierRefundHandlers } from "./routes/supplier-refunds";
import { BankSourceRevisionsHandlers } from "./routes/bank-source-revisions";
import { ServicePurchaseHandlers } from "./routes/service-purchases";
import { InvoiceDocumentHandlers } from "./routes/invoice-documents";
import { PostingRecoveryHandlers } from "./routes/posting-recovery";
import { CaseHandlers } from "./routes/cases";
import { BankSourceCoverageHandlers } from "./routes/bank-source-coverage";
import { PresenceHandlers } from "./routes/presence";
import { SupplierPaymentBatchHandlers } from "./routes/supplier-payment-batches";
import { BankMatchReversalHandlers } from "./routes/bank-match-reversals";
import { FilingLifecycleHandlers } from "./routes/filing-lifecycle";
import { EvaluationHandlers } from "./routes/evaluations";
import { SiePartitionsHandlers } from "./routes/sie-partitions";
import { BureauObligationsHandlers } from "./routes/bureau-obligations";
import { OnboardingMappingHandlers } from "./routes/onboarding-mappings";
import { CustomerCreditHandlers } from "./routes/customer-credit-notes";
import { SieHandlers } from "./routes/sie";
import { InvoiceCancellationHandlers } from "./routes/invoice-cancellations";
import { VatAssessmentHandlers } from "./routes/vat-assessment";
import { SubledgerControlsHandlers } from "./routes/subledger-controls";
import { LegalInvoicePdfHandlers } from "./routes/legal-invoice-pdf";
import { BankConnectorHandlers } from "./routes/bank-connector";
import { InvoicePolicyHandlers } from "./routes/invoice-policy";
import { CollectionsHandlers } from "./routes/collections";
import { AssetDisposalHandlers } from "./routes/asset-disposals";
import { InvoicePdfHandlers } from "./routes/invoice-pdf";
import { CorrectionHandlers } from "./routes/corrections";
import { LegalDeliveryHandlers } from "./routes/legal-delivery";
import { HistoricalAdoptionsHandlers } from "./routes/historical-adoptions";
import { BankSyncWindowsHandlers } from "./routes/bank-sync-windows";
import { FirmHandlers } from "./routes/firms";
import { CashMethodHandlers } from "./routes/cash-method";
import { TreasuryLoanHandlers } from "./routes/treasury-loans";
import { PurchaseRecognitionHandlers } from "./routes/purchase-recognition";
import { ForeignCashHandlers } from "./routes/foreign-cash";
import { ExpenseTaxHandlers } from "./routes/expense-tax";
import { PeriodWorkHandlers } from "./routes/period-work";
import { BankInventorySignoffHandlers } from "./routes/bank-inventory-signoffs";
import { SalesOrderHandlers } from "./routes/sales-orders";
import { ReportHandlers } from "./routes/reports";
import { CompanySetupHandlers } from "./routes/company-setup";
import { DecisionExampleHandlers } from "./routes/decision-examples";
import { PaymentIdentifierHandlers } from "./routes/payment-identifiers";
import { InvoiceTemplateHandlers } from "./routes/invoice-templates";
import { WorkspaceHandlers } from "./routes/workspace";
import { SupplierInboxHandlers } from "./routes/supplier-inbox";
import { SupplierCreditHandlers } from "./routes/supplier-credits";
import { AnnualReportHandlers } from "./routes/annual-report";
import { ReportStatementHandlers } from "./routes/report-statements";
import { OwnerRegisterHandlers } from "./routes/owner-register";
import { ArLegalIssueHandlers } from "./routes/ar-legal-issue";
import { CommerceAllocationReversalHandlers } from "./routes/commerce-allocation-reversals";
import { SourceIntakeHandlers } from "./routes/source-intake";
import { CorporateTaxHandlers } from "./routes/corporate-tax";
import { PeppolExchangeHandlers } from "./routes/peppol-exchange";
import { SupplierAcceptanceHandlers } from "./routes/supplier-acceptance";
import { OnboardingDeltaHandlers } from "./routes/onboarding-deltas";
import { PrepaymentsHandlers } from "./routes/prepayments";
import { InvoiceIssuanceHandlers } from "./routes/invoice-issuance";
import { VatReturnsHandlers } from "./routes/vat-returns";
import { InvoiceDeliveryHandlers } from "./routes/invoice-delivery";
import { PayrollRunHandlers } from "./routes/payroll-runs";
import { PayrollSettlementHandlers } from "./routes/payroll-settlements";
import { PostingMandateHandlers } from "./routes/posting-mandates";

export const HttpOperationLayers = Layer.mergeAll(
  HistoricalMigrationHandlers,
  CatalogHandlers,
  CashFlowHandlers,
  DecisionQuestionHandlers,
  PayrollInputHandlers,
  FinancialCloseHandlers,
  CommerceHandlers,
  DeadlineHandlers,
  SettlementHandlers,
  CompanyProfileHandlers,
  SieImportHandlers,
  BankMatchCandidateHandlers,
  EmployeeClaimHandlers,
  SupplierInvoiceDraftHandlers,
  CrmMasterHandlers,
  MileageCorrectionHandlers,
  BankSignoffHandlers,
  AccountingHandlers,
  LegalSalesPolicyHandlers,
  TaxAccountHandlers,
  PayrollFoundationHandlers,
  SupplierExtractionHandlers,
  RuleImpactHandlers,
  OwnerOperationHandlers,
  PaymentResolutionHandlers,
  DimensionHandlers,
  ReconciliationHandlers,
  CashForecastHandlers,
  Sie4EHandlers,
  RecurringInvoiceHandlers,
  SupplierSettlementHandlers,
  ClosingHandlers,
  RegisterReportHandlers,
  SubledgerHandlers,
  CommerceFxHandlers,
  OnboardingHandlers,
  PartyIdentityHandlers,
  AutomationHandlers,
  VariablePayReviewHandlers,
  DocumentSignatureHandlers,
  ProcessorClearingHandlers,
  PayrollCalculationHandlers,
  InvoiceDraftHandlers,
  AccountantReviewHandlers,
  ExchangeRatesHandlers,
  SupplierRefundHandlers,
  BankSourceRevisionsHandlers,
  ServicePurchaseHandlers,
  InvoiceDocumentHandlers,
  PostingRecoveryHandlers,
  CaseHandlers,
  BankSourceCoverageHandlers,
  PresenceHandlers,
  SupplierPaymentBatchHandlers,
  BankMatchReversalHandlers,
  FilingLifecycleHandlers,
  EvaluationHandlers,
  SiePartitionsHandlers,
  BureauObligationsHandlers,
  OnboardingMappingHandlers,
  CustomerCreditHandlers,
  SieHandlers,
  InvoiceCancellationHandlers,
  VatAssessmentHandlers,
  SubledgerControlsHandlers,
  LegalInvoicePdfHandlers,
  BankConnectorHandlers,
  InvoicePolicyHandlers,
  CollectionsHandlers,
  AssetDisposalHandlers,
  InvoicePdfHandlers,
  CorrectionHandlers,
  LegalDeliveryHandlers,
  HistoricalAdoptionsHandlers,
  BankSyncWindowsHandlers,
  FirmHandlers,
  CashMethodHandlers,
  TreasuryLoanHandlers,
  PurchaseRecognitionHandlers,
  ForeignCashHandlers,
  ExpenseTaxHandlers,
  PeriodWorkHandlers,
  BankInventorySignoffHandlers,
  SalesOrderHandlers,
  ReportHandlers,
  CompanySetupHandlers,
  DecisionExampleHandlers,
  PaymentIdentifierHandlers,
  InvoiceTemplateHandlers,
  WorkspaceHandlers,
  SupplierInboxHandlers,
  SupplierCreditHandlers,
  AnnualReportHandlers,
  ReportStatementHandlers,
  OwnerRegisterHandlers,
  ArLegalIssueHandlers,
  CommerceAllocationReversalHandlers,
  SourceIntakeHandlers,
  CorporateTaxHandlers,
  PeppolExchangeHandlers,
  SupplierAcceptanceHandlers,
  OnboardingDeltaHandlers,
  PrepaymentsHandlers,
  InvoiceIssuanceHandlers,
  VatReturnsHandlers,
  InvoiceDeliveryHandlers,
  PayrollRunHandlers,
  PayrollSettlementHandlers,
  PostingMandateHandlers,
);
