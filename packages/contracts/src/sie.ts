import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { ReviewJournalLine } from "./accountant-review";
import { accountingErrors } from "./accounting-errors";

export const PrepareSie = Schema.Struct({
  packId: Accounting.Identifier,
  packDigest: Accounting.Digest,
  selection: Schema.Literal("all_pack_movement_vouchers"),
  legalName: Accounting.Description,
  legalNameEvidenceId: Accounting.Identifier,
});
export const SieAccount = Schema.Struct({ accountId: Accounting.Identifier, code: Schema.String, name: Schema.String });
export const SieSource = Schema.Struct({
  accounts: Schema.Array(SieAccount),
  lines: Schema.Array(ReviewJournalLine),
});
export const SieCapture = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: PrepareSie,
  legalNameEvidenceSha256: Schema.String,
  generatorVersion: Schema.Literal("openerp-sie4i-v1"),
  specificationSha256: Schema.Literal("96fcd3f7931b2aa22d18fbd518a33f863b57edd5562a78af195251e2bf38bac1"),
  format: Schema.Literal("SIE4I"),
  generatedOn: Accounting.AccountingDate,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  currency: Schema.String,
  currencyScale: Schema.Literal(2),
  sequence: Accounting.MinorUnits,
  source: SieSource,
  sourceDigest: Accounting.Digest,
  digest: Accounting.Digest,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  syntheticOnly: Schema.Literal(true),
  externalAcceptance: Schema.Literal("not_established"),
});
export const SieArtifact = Schema.Struct({
  captureId: Accounting.Identifier,
  scope: Accounting.Scope,
  captureDigest: Accounting.Digest,
  sourceDigest: Accounting.Digest,
  packDigest: Accounting.Digest,
  generatorVersion: SieCapture.fields.generatorVersion,
  format: Schema.Literal("SIE4I"),
  filename: Schema.String,
  encoding: Schema.Literal("CP437"),
  mediaType: Schema.Literal("application/octet-stream"),
  byteLength: Schema.Int,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  contentBase64: Schema.String,
  sealedAt: Schema.String,
  syntheticOnly: Schema.Literal(true),
  externalAcceptance: Schema.Literal("not_established"),
});
export const SieView = Schema.Struct({ capture: SieCapture, artifact: Schema.NullOr(SieArtifact) });
export const SieCursor = Schema.String.check(
  Schema.isPattern(/^si1_[a-f0-9]+$/), Schema.isMaxLength(2048),
);
export const SieList = Schema.Struct({
  scope: Accounting.Scope,
  cutoff: Accounting.MinorUnits,
  total: Accounting.AggregateMinorUnits,
  first: SieCursor,
  items: Schema.Array(Schema.Struct({
    id: Accounting.Identifier, packId: Accounting.Identifier, captureDigest: Accounting.Digest,
    createdAt: Schema.String,
  })).check(Schema.isMaxLength(25)),
  next: Schema.NullOr(SieCursor),
});
const path = "/v1/entities/:entityId/books/:bookId/sie-transfers";
const scoped = { params: Accounting.Scope, error: accountingErrors };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
export const SieApi = HttpApiGroup.make("sie").add(
  HttpApiEndpoint.post("prepareSie", path, { ...scoped, headers: Accounting.IdempotencyHeaders,
    payload: PrepareSie.annotate({ parseOptions: { onExcessProperty: "error" } }), success: SieView }),
  HttpApiEndpoint.get("listSie", path, { ...scoped, query: Schema.Struct({ after: Schema.optional(SieCursor) }), success: SieList }),
  HttpApiEndpoint.get("getSie", `${path}/:id`, { ...identified, success: SieView }),
  HttpApiEndpoint.post("resumeSie", `${path}/:id/render`, { ...identified, success: SieView }),
);
export const SieCapabilities = {
  sie_prepare: { description: "Capture, render and retain synthetic SIE4I transaction-transfer bytes from all movement vouchers in an immutable review pack. Not full-book export or external acceptance.",
    input: Schema.Struct({ scope: Accounting.Scope, idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"], input: PrepareSie }), output: SieView, readOnly: false },
  sie_get: { description: "Read a retained SIE4I capture and exact base64 binary artifact, or recover unfinished capture state.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }), output: SieView, readOnly: true },
  sie_list: { description: "Rediscover captured or sealed synthetic SIE4I transfers with a pinned ordinal list boundary.",
    input: Schema.Struct({ scope: Accounting.Scope, after: Schema.optional(SieCursor) }), output: SieList, readOnly: true },
  sie_resume: { description: "Resume deterministic rendering and sealing of an existing capture owned by the current actor. No new financial effects or external transmission.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }), output: SieView, readOnly: false },
};
