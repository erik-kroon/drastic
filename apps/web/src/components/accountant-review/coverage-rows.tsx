import type * as Review from "@open-erp/contracts/accountant-review";
import { Badge } from "@open-erp/ui/components/badge";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import type { Locale } from "@/paraglide/runtime";
import { reviewCopy } from "./copy";

const controlNames = {
  opening_basis: ["Opening balances", "Ingående saldon"],
  company_profile: ["Company and tax details", "Företags- och skatteuppgifter"],
  required_source_inventory: ["Required source documents", "Nödvändiga underlag"],
  bank_controls: ["Bank reconciliation", "Bankavstämning"],
  commerce_controls: ["Invoice and payment registers", "Faktura- och betalningsregister"],
  schedule_controls: ["Assets and scheduled entries", "Tillgångar och planerade poster"],
  schedule_carrying_basis: [
    "Asset acquisition and opening amounts",
    "Anskaffning och ingående tillgångsvärden",
  ],
  subledger_control_coverage: [
    "Register-to-ledger reconciliation",
    "Avstämning av register mot huvudbok",
  ],
  owner_funding: ["Owner funding and expenses", "Ägarfinansiering och utlägg"],
  vat_tax: ["Expense tax reviews", "Skattegranskning av utgifter"],
  vat_return_controls: ["VAT return basis", "Underlag för momsdeklaration"],
  other_obligations: ["Other company obligations", "Övriga företagsskyldigheter"],
  unlinked_evidence: [
    "Evidence without an included posting",
    "Underlag utan ingående bokföringspost",
  ],
  later_dated_vouchers: ["Vouchers after the period", "Verifikationer efter perioden"],
  statutory_outputs: ["Statutory reports and filing", "Lagstadgade rapporter och inlämning"],
  period_inventory_unavailable: ["Accounting period setup", "Inställningar för redovisningsperiod"],
};

const expenseReasons = {
  method_unknown_or_unsupported: [
    "Expense: accounting method unconfirmed",
    "Utgift: redovisningsmetod inte bekräftad",
  ],
  missing_deduction_basis: ["Expense: deduction basis missing", "Utgift: avdragsunderlag saknas"],
  missing_jurisdiction: ["Expense: jurisdiction missing", "Utgift: jurisdiktion saknas"],
  missing_review_dates: ["Expense: review dates missing", "Utgift: granskningsdatum saknas"],
  production_profile_unapproved: [
    "Expense: tax profile not approved",
    "Utgift: skatteprofil inte godkänd",
  ],
  registration_unknown_or_unsupported: [
    "Expense: VAT registration unconfirmed",
    "Utgift: momsregistrering inte bekräftad",
  ],
  rounding_policy_unavailable: [
    "Expense: rounding policy unavailable",
    "Utgift: avrundningsregel saknas",
  ],
  stale_review: [
    "Expense: source changed after review",
    "Utgift: underlaget ändrades efter granskningen",
  ],
  unsupported_profile: ["Expense: unsupported tax profile", "Utgift: skatteprofil stöds inte"],
};

function controlName(code: string, locale: Locale) {
  const language = locale === "sv" ? 1 : 0;
  const known = Object.entries(controlNames).find(([key]) => key === code)?.[1];

  if (known) return known[language];

  if (code.startsWith("expense_")) {
    const reason = Object.entries(expenseReasons).find(([key]) => code.endsWith(`_${key}`));

    if (reason) return reason[1][language] ?? code;
  }

  if (code.startsWith("bank_inventory_"))
    return locale === "sv" ? "Förväntade bankkonton" : "Expected bank accounts";

  if (code.startsWith("expected_bank_"))
    return locale === "sv" ? "Förväntat kontoutdrag" : "Expected bank statement";

  if (code.startsWith("declared_exclusion_"))
    return locale === "sv" ? "Angivet undantag" : "Declared exclusion";

  return code;
}

export function CoverageRows({
  items,
  locale,
}: {
  items: ReadonlyArray<typeof Review.ReviewCoverage.Type>;
  locale: Locale;
}) {
  const copy = reviewCopy(locale);

  const statuses =
    locale === "sv"
      ? {
          observed: "Observerad",
          missing: "Saknas",
          unavailable: "Inte tillgänglig",
          unverified: "Inte verifierad",
          excluded: "Undantagen",
        }
      : {
          observed: "Observed",
          missing: "Missing",
          unavailable: "Unavailable",
          unverified: "Unverified",
          excluded: "Excluded",
        };

  return (
    <DataTable
      title={copy.coverage}
      narrow="stack"
      columns={[
        { id: "control", label: copy.code },
        { id: "status", label: copy.status },
        { id: "detail", label: copy.detail },
      ]}
      rows={items.map((row) => ({
        id: row.code,
        cells: [
          controlName(row.code, locale),
          <Badge key="status" variant={row.status === "missing" ? "warning" : "secondary"}>
            {statuses[row.status]}
          </Badge>,
          <details key="detail">
            <summary>{locale === "sv" ? "Visa förklaring" : "View explanation"}</summary>
            <Box display="grid" gap="md" paddingBlock="md" maxWidth="content">
              <Text>{row.detail}</Text>
              <Text>{row.code}</Text>
            </Box>
          </details>,
        ],
      }))}
    />
  );
}
