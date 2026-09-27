import * as Schema from "effect/Schema";

// The reviewed account-role vocabulary. It lives in its own leaf so every family
// section of a rule release can name a role without importing another family's
// contract module. NEXT-22 adds the three pre-close corporate-income-tax roles so
// the bridge's exclusion set comes from reviewed role bindings rather than from
// account numbers or from a request payload.
export const RoleKind = Schema.Literals([
  "bank",
  "commerce",
  "owner",
  "subledger",
  "tax",
  "vat",
  "corporate_tax_expense",
  "corporate_tax_liability",
  "corporate_tax_other_expense",
]);
