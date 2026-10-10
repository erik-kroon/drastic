import type { Api } from "@open-erp/contracts/api";
import { HistoricalMigrationOperations } from "./historical-migration";
import { CatalogOperations } from "./catalog";
import { CashFlowOperations } from "./cash-flow";
import { DecisionQuestionOperations } from "./decision-questions";
import { PayrollInputOperations } from "./payroll-inputs";
import { FinancialCloseOperations } from "./financial-close";
import { CommerceOperations } from "./commerce";
import { DeadlineOperations } from "./deadlines";
import { SettlementOperations } from "./settlements";
import { CompanyProfileOperations } from "./company-profile";
import { SieImportOperations } from "./sie-import";
import { BankMatchCandidateOperations } from "./bank-match-candidates";
import { EmployeeClaimOperations } from "./employee-claims";
import { SupplierInvoiceDraftOperations } from "./supplier-invoice-drafts";
import { CrmMasterOperations } from "./crm-master";
import { MileageCorrectionOperations } from "./mileage-corrections";
import { BankSignoffOperations } from "./bank-signoffs";
import { AccountingOperations } from "./accounting";
import { LegalSalesPolicyOperations } from "./legal-sales-policy";
import { TaxAccountOperations } from "./tax-account";
import { PayrollFoundationOperations } from "./payroll-foundation";
import { SupplierExtractionOperations } from "./supplier-extraction";
import { RuleImpactOperations } from "./rule-impact";
import { OwnerOperationOperations } from "./owner-operations";
import { PaymentResolutionOperations } from "./payment-resolutions";
import { DimensionOperations } from "./dimensions";
import { ReconciliationOperations } from "./reconciliation";
import { CashForecastOperations } from "./cash-forecast";
import { Sie4EOperations } from "./sie4e";
import { RecurringInvoiceOperations } from "./recurring-invoices";
import { SupplierSettlementOperations } from "./supplier-settlements";
import { ClosingOperations } from "./closing";
import { RegisterReportOperations } from "./register-reports";
import { SubledgerOperations } from "./subledgers";
import { CommerceFxOperations } from "./commerce-fx";
import { OnboardingOperations } from "./onboarding";
import { PartyIdentityOperations } from "./party-identity";
import { AutomationOperations } from "./automation";
import { VariablePayReviewOperations } from "./variable-pay-review";
import { DocumentSignatureOperations } from "./document-signatures";
import { ProcessorClearingOperations } from "./processor-clearing";
import { PayrollCalculationOperations } from "./payroll-calculations";
import { InvoiceDraftOperations } from "./invoice-drafts";
import { AccountantReviewOperations } from "./accountant-review";
import { ExchangeRatesOperations } from "./exchange-rates";
import { SupplierRefundOperations } from "./supplier-refunds";
import { BankSourceRevisionsOperations } from "./bank-source-revisions";
import { ServicePurchaseOperations } from "./service-purchases";
import { InvoiceDocumentOperations } from "./invoice-documents";
import { PostingRecoveryOperations } from "./posting-recovery";
import { CaseOperations } from "./cases";
import { BankSourceCoverageOperations } from "./bank-source-coverage";
import { PresenceOperations } from "./presence";
import { SupplierPaymentBatchOperations } from "./supplier-payment-batches";
import { BankMatchReversalOperations } from "./bank-match-reversals";
import { FilingLifecycleOperations } from "./filing-lifecycle";
import { EvaluationOperations } from "./evaluations";
import { SiePartitionsOperations } from "./sie-partitions";
import { BureauObligationsOperations } from "./bureau-obligations";
import { OnboardingMappingOperations } from "./onboarding-mappings";
import { CustomerCreditOperations } from "./customer-credit-notes";
import { SieOperations } from "./sie";
import { InvoiceCancellationOperations } from "./invoice-cancellations";
import { VatAssessmentOperations } from "./vat-assessment";
import { SubledgerControlsOperations } from "./subledger-controls";
import { LegalInvoicePdfOperations } from "./legal-invoice-pdf";
import { BankConnectorOperations } from "./bank-connector";
import { InvoicePolicyOperations } from "./invoice-policy";
import { CollectionsOperations } from "./collections";
import { AssetDisposalOperations } from "./asset-disposals";
import { InvoicePdfOperations } from "./invoice-pdf";
import { CorrectionOperations } from "./corrections";
import { LegalDeliveryOperations } from "./legal-delivery";
import { HistoricalAdoptionsOperations } from "./historical-adoptions";
import { BankSyncWindowsOperations } from "./bank-sync-windows";
import { FirmOperations } from "./firms";
import { CashMethodOperations } from "./cash-method";
import { TreasuryLoanOperations } from "./treasury-loans";
import { PurchaseRecognitionOperations } from "./purchase-recognition";
import { ForeignCashOperations } from "./foreign-cash";
import { ExpenseTaxOperations } from "./expense-tax";
import { PeriodWorkOperations } from "./period-work";
import { BankInventorySignoffOperations } from "./bank-inventory-signoffs";
import { SalesOrderOperations } from "./sales-orders";
import { ReportOperations } from "./reports";
import { CompanySetupOperations } from "./company-setup";
import { DecisionExampleOperations } from "./decision-examples";
import { PaymentIdentifierOperations } from "./payment-identifiers";
import { InvoiceTemplateOperations } from "./invoice-templates";
import { WorkspaceOperations } from "./workspace";
import { SupplierInboxOperations } from "./supplier-inbox";
import { SupplierCreditOperations } from "./supplier-credits";
import { AnnualReportOperations } from "./annual-report";
import { ReportStatementOperations } from "./report-statements";
import { OwnerRegisterOperations } from "./owner-register";
import { ArLegalIssueOperations } from "./ar-legal-issue";
import { CommerceAllocationReversalOperations } from "./commerce-allocation-reversals";
import { SourceIntakeOperations } from "./source-intake";
import { CorporateTaxOperations } from "./corporate-tax";
import { PeppolExchangeOperations } from "./peppol-exchange";
import { SupplierAcceptanceOperations } from "./supplier-acceptance";
import { OnboardingDeltaOperations } from "./onboarding-deltas";
import { PrepaymentsOperations } from "./prepayments";
import { InvoiceIssuanceOperations } from "./invoice-issuance";
import { VatReturnsOperations } from "./vat-returns";
import { InvoiceDeliveryOperations } from "./invoice-delivery";
import { PayrollRunOperations } from "./payroll-runs";
import { PayrollSettlementOperations } from "./payroll-settlements";
import { PostingMandateOperations } from "./posting-mandates";

type HttpOperationGroups = {
  readonly [Group in Exclude<keyof typeof Api.groups, "system">]: {
    readonly [Endpoint in keyof (typeof Api.groups)[Group]["endpoints"]]: {
      readonly endpoint: { readonly identifier: Endpoint };
    };
  };
};

export const httpOperations = {
  historicalMigration: HistoricalMigrationOperations,
  catalog: CatalogOperations,
  cashFlow: CashFlowOperations,
  decisionQuestions: DecisionQuestionOperations,
  payrollInput: PayrollInputOperations,
  financialClose: FinancialCloseOperations,
  commerce: CommerceOperations,
  deadlines: DeadlineOperations,
  settlements: SettlementOperations,
  companyProfile: CompanyProfileOperations,
  sieImport: SieImportOperations,
  bankMatchCandidates: BankMatchCandidateOperations,
  employeeClaims: EmployeeClaimOperations,
  supplierInvoiceDrafts: SupplierInvoiceDraftOperations,
  crmMaster: CrmMasterOperations,
  mileageCorrections: MileageCorrectionOperations,
  bankSignoffs: BankSignoffOperations,
  accounting: AccountingOperations,
  legalSalesPolicies: LegalSalesPolicyOperations,
  taxAccount: TaxAccountOperations,
  payrollFoundation: PayrollFoundationOperations,
  supplierExtraction: SupplierExtractionOperations,
  ruleImpact: RuleImpactOperations,
  ownerOperations: OwnerOperationOperations,
  paymentResolutions: PaymentResolutionOperations,
  dimensions: DimensionOperations,
  reconciliation: ReconciliationOperations,
  cashForecast: CashForecastOperations,
  sieFullBook: Sie4EOperations,
  recurringInvoices: RecurringInvoiceOperations,
  supplierSettlements: SupplierSettlementOperations,
  closing: ClosingOperations,
  registerReports: RegisterReportOperations,
  subledgers: SubledgerOperations,
  commerceFx: CommerceFxOperations,
  onboarding: OnboardingOperations,
  partyIdentity: PartyIdentityOperations,
  automation: AutomationOperations,
  variablePayReview: VariablePayReviewOperations,
  documentSignatures: DocumentSignatureOperations,
  processorClearing: ProcessorClearingOperations,
  payrollCalculation: PayrollCalculationOperations,
  invoiceDrafts: InvoiceDraftOperations,
  accountantReview: AccountantReviewOperations,
  exchangeRates: ExchangeRatesOperations,
  supplierRefunds: SupplierRefundOperations,
  bankSourceRevisions: BankSourceRevisionsOperations,
  servicePurchases: ServicePurchaseOperations,
  invoiceDocuments: InvoiceDocumentOperations,
  postingRecovery: PostingRecoveryOperations,
  cases: CaseOperations,
  bankSourceCoverage: BankSourceCoverageOperations,
  presence: PresenceOperations,
  supplierPaymentBatches: SupplierPaymentBatchOperations,
  bankMatchReversals: BankMatchReversalOperations,
  filingLifecycle: FilingLifecycleOperations,
  evaluations: EvaluationOperations,
  siePartitions: SiePartitionsOperations,
  bureauObligations: BureauObligationsOperations,
  onboardingMappings: OnboardingMappingOperations,
  customerCreditNotes: CustomerCreditOperations,
  sie: SieOperations,
  invoiceCancellations: InvoiceCancellationOperations,
  vatAssessment: VatAssessmentOperations,
  subledgerControls: SubledgerControlsOperations,
  legalInvoicePdfs: LegalInvoicePdfOperations,
  bankConnector: BankConnectorOperations,
  invoicePolicies: InvoicePolicyOperations,
  collections: CollectionsOperations,
  assetDisposals: AssetDisposalOperations,
  invoicePdfs: InvoicePdfOperations,
  corrections: CorrectionOperations,
  legalDeliveries: LegalDeliveryOperations,
  historicalAdoptions: HistoricalAdoptionsOperations,
  bankSyncWindows: BankSyncWindowsOperations,
  firms: FirmOperations,
  cashMethod: CashMethodOperations,
  treasuryLoan: TreasuryLoanOperations,
  purchaseRecognition: PurchaseRecognitionOperations,
  foreignCash: ForeignCashOperations,
  expenseTax: ExpenseTaxOperations,
  periodWork: PeriodWorkOperations,
  bankInventorySignoffs: BankInventorySignoffOperations,
  salesOrders: SalesOrderOperations,
  reports: ReportOperations,
  companySetup: CompanySetupOperations,
  decisionExamples: DecisionExampleOperations,
  paymentIdentifiers: PaymentIdentifierOperations,
  invoiceTemplates: InvoiceTemplateOperations,
  workspace: WorkspaceOperations,
  supplierInbox: SupplierInboxOperations,
  supplierCredits: SupplierCreditOperations,
  annualReport: AnnualReportOperations,
  reportStatements: ReportStatementOperations,
  ownerRegister: OwnerRegisterOperations,
  arLegalIssue: ArLegalIssueOperations,
  commerceAllocationReversals: CommerceAllocationReversalOperations,
  sourceIntake: SourceIntakeOperations,
  corporateTax: CorporateTaxOperations,
  peppolExchange: PeppolExchangeOperations,
  supplierAcceptance: SupplierAcceptanceOperations,
  onboardingDeltas: OnboardingDeltaOperations,
  prepayments: PrepaymentsOperations,
  invoiceIssuance: InvoiceIssuanceOperations,
  vatReturns: VatReturnsOperations,
  invoiceDeliveries: InvoiceDeliveryOperations,
  payrollRun: PayrollRunOperations,
  payrollSettlement: PayrollSettlementOperations,
  postingMandates: PostingMandateOperations,
} satisfies HttpOperationGroups;
