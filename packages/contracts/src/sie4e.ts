import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { accountingErrors as errors } from "./accounting-errors";
import * as Accounting from "./accounting";

// NEXT-11: a complete selected-book SIE4E export. This is a different export
// purpose from the retained SIE4I transaction transfer: it carries the frozen
// selected book through `asOf`, its accounts, its raw opening/closing balances,
// its raw result balances and its complete voucher membership.

export const Sie4EAccountClass = Schema.Literals(["balance_sheet", "nominal"]);

// The pinned edition covers types 1-4, so the 4E record family shares its
// checksum. The edition date is the specification edition, not a legal effective
// date, and it is not a claim of SIE Group approval or destination acceptance.
export const Sie4ESpecificationSha256 = Schema.Literal(
  "96fcd3f7931b2aa22d18fbd518a33f863b57edd5562a78af195251e2bf38bac1",
);

export const Sie4ESpecificationEdition = Schema.Literal("4C-2025-08-06");

export const Sie4ERendererVersion = Schema.Literal("openerp-sie4e-v1");

// The specification permits the organisation number with or without its grouping
// dash. Both are declared representations of the same field; this release does
// not validate a Swedish organisation number against a registry.
export const Sie4EOrganizationNumber = Schema.String.check(
  Schema.isPattern(/^[0-9]{6}-?[0-9]{4}$/u, {
    message:
      "Use the declared six-plus-four digit organisation number, with or without its grouping dash.",
  }),
);

export const Sie4EOpeningRepresentation = Schema.Literals([
  "opening_set_voucher",
  "prior_native_balance",
]);

export const Sie4ERecordProfile = Schema.Array(
  Schema.Literals([
    "#FLAGGA",
    "#PROGRAM",
    "#FORMAT",
    "#GEN",
    "#SIETYP",
    "#ORGNR",
    "#FNAMN",
    "#RAR",
    "#VALUTA",
    "#PROSA",
    "#KONTO",
    "#IB",
    "#UB",
    "#RES",
    "#VER",
    "#TRANS",
  ]),
);

// Every record family this renderer emits, and nothing else. A reader can state
// exactly which type-4 records the file carries without inferring them.
export const Sie4EEmittedRecords = Schema.Struct({
  recordProfile: Sie4ERecordProfile,
  objectRecords: Schema.Literal("absent"),
  priorYearRecords: Schema.Literal("absent"),
});

export const Sie4ERendererRelease = Schema.Struct({
  version: Sie4ERendererVersion,
  format: Schema.Literal("SIE4E"),
  specificationEdition: Sie4ESpecificationEdition,
  specificationSha256: Sie4ESpecificationSha256,
});

export const Sie4EFiscalYear = Schema.Struct({
  id: Accounting.Identifier,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
});

// The account class is a reviewed input. This release holds no reviewed account
// classification, so an operator must classify the complete account set and a
// missing or duplicated classification blocks the export instead of being
// inferred from an account number range.
export const Sie4EAccountClassification = Schema.Struct({
  accountId: Accounting.Identifier,
  accountClass: Sie4EAccountClass,
});

export const PrepareSie4E = Schema.Struct({
  fiscalYearId: Accounting.Identifier,
  asOf: Accounting.AccountingDate,
  legalName: Accounting.Description,
  organizationNumber: Sie4EOrganizationNumber,
  legalNameEvidenceId: Accounting.Identifier,
  accountClassifications: Schema.Array(Sie4EAccountClassification).check(Schema.isMaxLength(500)),
});

export const Sie4ELimitation = Schema.Struct({
  code: Schema.Literals([
    "year_to_date_scope",
    "no_reviewed_company_profile",
    "no_external_source_completeness",
    "no_object_owner",
    "unreviewed_account_classification",
    "not_a_statutory_archive",
    "no_destination_validation",
  ]),
  detail: Schema.String,
});

// The independent check re-parses the produced bytes with the inbound SIE parser
// and compares identities, amounts, dimension assignments, record counts and
// control totals against the frozen capture. It is an internal consistency
// check of the exact bytes, not SIE Group validation and not importer
// acceptance.
export const Sie4EValidation = Schema.Struct({
  checkedBy: Schema.Literal("independent_sie_reparse_v1"),
  recordsCompared: Schema.Int,
  vouchersCompared: Schema.Int,
  linesCompared: Schema.Int,
  controlTotalsCompared: Schema.Int,
  accountDeclarationsCompared: Schema.Int,
  openingMovementClosingIdentity: Schema.Boolean,
  parserDiagnostics: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
  destinationAcceptance: Schema.Literal("not_established"),
});

// A read-only artifact. It carries its own receipt and never a journal, voucher
// number or approval use, so the export has no financial effect.
export const Sie4EReceipt = Schema.Struct({
  key: Schema.String,
  operation: Schema.Literal("prepare_sie_book_export"),
  actorId: Schema.String,
});

export const Sie4EExport = Schema.Struct({
  kind: Schema.Literal("complete_book_sie_v1"),
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  fiscalYear: Sie4EFiscalYear,
  asOf: Accounting.AccountingDate,
  ledgerBoundary: Accounting.MinorUnits,
  recordedCutoff: Schema.String,
  generationDate: Accounting.AccountingDate,
  currency: Schema.String,
  currencyScale: Schema.Literal(2),
  legalName: Schema.String,
  organizationNumber: Sie4EOrganizationNumber,
  legalNameEvidenceSha256: Schema.String,
  openingBasis: Schema.Struct({
    representation: Sie4EOpeningRepresentation,
    basisId: Accounting.Identifier,
    openingVoucherId: Schema.NullOr(Accounting.Identifier),
    established: Schema.Boolean,
    reviewed: Schema.Literal(false),
  }),
  dimensions: Schema.Array(Schema.String).check(Schema.isMaxLength(500)),
  counts: Schema.Struct({
    accounts: Schema.Int,
    balances: Schema.Int,
    vouchers: Schema.Int,
    lines: Schema.Int,
  }),
  openingControlTotalMinor: Accounting.SignedMinorUnits,
  movementControlTotalMinor: Accounting.SignedMinorUnits,
  closingControlTotalMinor: Accounting.SignedMinorUnits,
  sourceDigest: Accounting.Digest,
  rendererRelease: Sie4ERendererRelease,
  emittedRecords: Sie4EEmittedRecords,
  coverageLimitations: Schema.Array(Sie4ELimitation).check(Schema.isMaxLength(20)),
  digest: Accounting.Digest,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  noFinancialEffect: Schema.Literal(true),
  receipt: Sie4EReceipt,
});

export const Sie4EAccountRow = Schema.Struct({
  rowId: Schema.String,
  ordinal: Schema.Int,
  kind: Schema.Literal("account"),
  accountId: Accounting.Identifier,
  code: Schema.String,
  name: Schema.String,
  accountClass: Sie4EAccountClass,
  active: Schema.Boolean,
  version: Schema.String,
});

export const Sie4EBalanceRow = Schema.Struct({
  rowId: Schema.String,
  ordinal: Schema.Int,
  kind: Schema.Literal("balance"),
  accountId: Accounting.Identifier,
  code: Schema.String,
  accountClass: Sie4EAccountClass,
  openingMinor: Accounting.SignedMinorUnits,
  movementMinor: Accounting.SignedMinorUnits,
  closingMinor: Accounting.SignedMinorUnits,
  resultMinor: Accounting.SignedMinorUnits,
});

export const Sie4ELineRow = Schema.Struct({
  rowId: Schema.String,
  ordinal: Schema.Int,
  kind: Schema.Literal("line"),
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  ordinalInVoucher: Schema.Int,
  sequence: Accounting.MinorUnits,
  fiscalYearId: Accounting.Identifier,
  series: Schema.String,
  number: Accounting.MinorUnits,
  postingDate: Accounting.AccountingDate,
  eventId: Accounting.Identifier,
  changeSetId: Accounting.Identifier,
  correctsVoucherId: Schema.NullOr(Accounting.Identifier),
  accountId: Accounting.Identifier,
  accountCode: Schema.String,
  debitMinor: Accounting.MinorUnits,
  creditMinor: Accounting.MinorUnits,
  signedMinor: Accounting.SignedMinorUnits,
  description: Schema.String,
});

export const Sie4ERow = Schema.Union([Sie4EAccountRow, Sie4EBalanceRow, Sie4ELineRow]);

export const Sie4EArtifact = Schema.Struct({
  exportId: Accounting.Identifier,
  scope: Accounting.Scope,
  captureDigest: Accounting.Digest,
  sourceDigest: Accounting.Digest,
  renderer: Sie4ERendererRelease,
  filename: Schema.String,
  encoding: Schema.Literal("CP437"),
  mediaType: Schema.Literal("application/octet-stream"),
  byteLength: Schema.Int,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  contentBase64: Schema.String,
  sealedAt: Schema.String,
  validation: Sie4EValidation,
  destinationAcceptance: Schema.Literal("not_established"),
});

export const Sie4EView = Schema.Struct({
  capture: Sie4EExport,
  artifact: Schema.NullOr(Sie4EArtifact),
});

export const Sie4ERowCursor = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{2,127}:[1-9][0-9]{0,9}$/u, {
    message: "Use the row cursor returned for this export. Omit after to restart the membership.",
  }),
);

export const Sie4EListCursor = Schema.String.check(
  Schema.isPattern(/^sb1_[a-f0-9]+$/u),
  Schema.isMaxLength(2048),
);

export const Sie4ERowsPage = Schema.Struct({
  exportId: Accounting.Identifier,
  order: Schema.Literal("retained_membership_ordinal"),
  total: Schema.Int,
  items: Schema.Array(Sie4ERow).check(Schema.isMaxLength(100)),
  next: Schema.NullOr(Sie4ERowCursor),
});

export const Sie4EList = Schema.Struct({
  scope: Accounting.Scope,
  cutoff: Accounting.MinorUnits,
  total: Accounting.AggregateMinorUnits,
  first: Sie4EListCursor,
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      captureDigest: Accounting.Digest,
      asOf: Accounting.AccountingDate,
      artifactAttached: Schema.Boolean,
      createdAt: Schema.String,
    }),
  ).check(Schema.isMaxLength(25)),
  next: Schema.NullOr(Sie4EListCursor),
});

export const Sie4ECapabilities = {
  sie4e_prepare: {
    description:
      "Freeze a complete selected-book SIE4E export through asOf, render exact CP437 bytes outside the financial transaction and retain the independently checked bytes with their manifest. Requires a reviewed account classification, a retained legal-name and organisation-number evidence record and an established opening representation. A dimension-bearing book refuses; destination acceptance is never established.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareSie4E,
    }),
    output: Sie4EView,
    readOnly: false,
  },
  sie4e_get: {
    description:
      "Read one frozen complete-book SIE4E capture and its exact base64 bytes, or recover unfinished capture state. A repeated read returns the retained bytes, never a newly rendered file with today's date.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: Sie4EView,
    readOnly: true,
  },
  sie4e_rows: {
    description:
      "Page the retained complete-book membership of one frozen export: account declarations, raw balances and complete journal lines. Follow next until null; this is history, not live ledger state.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      id: Accounting.Identifier,
      after: Schema.optional(Sie4ERowCursor),
    }),
    output: Sie4ERowsPage,
    readOnly: true,
  },
  sie4e_list: {
    description:
      "Rediscover frozen complete-book SIE4E captures with a pinned ordinal list boundary. Membership summaries never imply an attached verified artifact; read one export for that.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      after: Schema.optional(Sie4EListCursor),
    }),
    output: Sie4EList,
    readOnly: true,
  },
  sie4e_resume: {
    description:
      "Resume deterministic rendering and attachment for an existing frozen capture owned by the current actor. A captured historical export stays renderable without being changed to current balances, and a different byte result for the same capture refuses.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: Sie4EView,
    readOnly: false,
  },
};

const scoped = { params: Accounting.Scope, error: errors };

const identified = { params: Accounting.ChangePath, error: errors };

const base = "/v1/entities/:entityId/books/:bookId/sie-book-exports";

export const Sie4EApi = HttpApiGroup.make("sieFullBook").add(
  HttpApiEndpoint.post("prepareSie4E", base, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareSie4E.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: Sie4EView,
  }),
  HttpApiEndpoint.get("listSie4E", base, {
    ...scoped,
    query: Schema.Struct({ after: Schema.optional(Sie4EListCursor) }),
    success: Sie4EList,
  }),
  HttpApiEndpoint.get("getSie4E", `${base}/:id`, { ...identified, success: Sie4EView }),
  HttpApiEndpoint.get("sie4ERows", `${base}/:id/rows`, {
    ...identified,
    query: Schema.Struct({ after: Schema.optional(Sie4ERowCursor) }),
    success: Sie4ERowsPage,
  }),
  HttpApiEndpoint.post("resumeSie4E", `${base}/:id/render`, { ...identified, success: Sie4EView }),
);
