import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

const Name = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
  Schema.makeFilter((value) => value.trim().length > 0 || "Enter the company name."),
);

const SetupDate = Accounting.AccountingDate.check(
  Schema.makeFilter((value) => {
    const time = Date.parse(value);

    return (
      (value >= "0001-01-01" &&
        Number.isFinite(time) &&
        new Date(time).toISOString().slice(0, 10) === value) ||
      "Enter a valid calendar date."
    );
  }),
);

const Revision = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2147483646 }));

export const CompanyDetails = Schema.Struct({
  name: Name,
  legalForm: Schema.NullOr(Schema.Literals(["aktiebolag", "enskild_firma"])),
  organizationNumber: Schema.NullOr(
    Schema.String.check(
      Schema.isPattern(/^\d{10}$/, {
        message: "Use 10 digits, without spaces or a hyphen.",
      }),
    ),
  ),
  accountingMethod: Schema.NullOr(Schema.Literals(["accrual", "cash"])),
  vatRegistered: Schema.NullOr(Schema.Boolean),
  vatPeriod: Schema.NullOr(Schema.Literals(["monthly", "quarterly", "yearly"])),
  fiscalYearStartsOn: Schema.NullOr(SetupDate),
  fiscalYearEndsOn: Schema.NullOr(SetupDate),
  historyChoice: Schema.NullOr(Schema.Literals(["new_business", "sie", "opening_balances"])),
  bankChoice: Schema.NullOr(Schema.Literals(["connect", "file", "later"])),
}).check(
  Schema.makeFilter((details) => {
    const issues: Array<Schema.FilterIssue> = [];

    if (details.vatRegistered !== true && details.vatPeriod !== null) {
      issues.push({
        path: ["vatPeriod"],
        issue: "A VAT reporting period requires VAT registration.",
      });
    }

    if (
      details.fiscalYearStartsOn &&
      details.fiscalYearEndsOn &&
      details.fiscalYearStartsOn > details.fiscalYearEndsOn
    ) {
      issues.push({
        path: ["fiscalYearEndsOn"],
        issue: "The fiscal year must end on or after its start date.",
      });
    }

    return issues;
  }),
);

export const CompanySetup = Schema.Struct({
  scope: Accounting.Scope,
  revision: Revision,
  details: CompanyDetails,
  state: Schema.Literals(["incomplete", "details_recorded"]),
  missing: Schema.Array(
    Schema.Literals([
      "legalForm",
      "organizationNumber",
      "accountingMethod",
      "vatRegistered",
      "vatPeriod",
      "fiscalYearStartsOn",
      "fiscalYearEndsOn",
    ]),
  ),
  accountingProfile: Schema.String,
});

export const CreateCompany = Schema.Struct({ name: Name });

export const SaveCompanySetup = Schema.Struct({
  expectedRevision: Revision,
  details: CompanyDetails,
});

const key = Accounting.IdempotencyHeaders.fields["idempotency-key"];

export const CompanySetupCapabilities = {
  company_create: {
    description:
      "Create a company in setup with a book and an operator grant for the signed-in human. Does not activate an accounting profile or assert historical readiness.",
    input: Schema.Struct({ idempotencyKey: key, input: CreateCompany }),
    output: CompanySetup,
    readOnly: false,
  },
  company_get_setup: {
    description:
      "Read the current company's saved setup details and missing inputs using current book access.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: CompanySetup,
    readOnly: true,
  },
  company_save_setup: {
    description:
      "Save company details with optimistic concurrency and replay protection. Requires book operator access. Does not enable accounting or establish import or bank readiness.",
    input: Schema.Struct({ scope: Accounting.Scope, idempotencyKey: key, input: SaveCompanySetup }),
    output: CompanySetup,
    readOnly: false,
  },
};

const path = "/v1/entities/:entityId/books/:bookId/company-setup";

export const CompanySetupApi = HttpApiGroup.make("companySetup").add(
  HttpApiEndpoint.post("createCompany", "/v1/companies", {
    headers: Accounting.IdempotencyHeaders,
    payload: CreateCompany,
    success: CompanySetup,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getCompanySetup", path, {
    params: Accounting.Scope,
    success: CompanySetup,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("saveCompanySetup", path, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: SaveCompanySetup,
    success: CompanySetup,
    error: accountingErrors,
  }),
);
