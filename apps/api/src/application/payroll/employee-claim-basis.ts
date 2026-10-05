import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Claims from "@open-erp/contracts/employee-claims";
import * as Tax from "@open-erp/contracts/expense-tax";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Db from "../../db/payroll/employee-claims";
import * as InputDb from "../../db/payroll/inputs";
import * as Foundation from "../../db/payroll-foundation";
import * as TaxDb from "../../db/vat/expense-tax";
import * as PartyDb from "../../db/commerce/invoice-lifecycle";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import {
  decode,
  toJsonObject,
  requireTableAccess,
  requireRetainedEvidence,
  type Scope,
} from "../commerce/support";
import { readSourceBytesInTransaction } from "../source-retention";
import { assessSource } from "../vat/expense-tax";
import { digest, isoNow } from "../posting";
import { economicKey } from "../purchases/recognition";

export const requireClaimsAccess = Effect.fn("claims.access")(function* (
  tx: Transaction,
  scope: Scope,
  actorId: string,
  write: boolean,
) {
  if ((yield* Foundation.readPayrollAccess(tx, scope.bookId, actorId)).length !== 1)
    return yield* failure("Forbidden");
  yield* requireTableAccess(tx, Db.claimTables, write);

  if (write) {
    for (const row of yield* Db.expiredReservations(tx, scope.bookId))
      yield* InputDb.insertReservationRelease(tx, scope.bookId, row.approvalId, row.runId);
  }
});

export const employeeRevision = Effect.fn("claims.employeeRevision")(function* (
  tx: Transaction,
  scope: Scope,
  employeeId: string,
  month: string,
) {
  const rows = (yield* Foundation.listRevisions(tx, scope.bookId, employeeId)).filter(
    (row) => row.isCurrent && row.kind === "employment" && row.effectiveOn.slice(0, 7) <= month,
  );

  const revision = rows.at(-1);

  if (!revision) return yield* failure("NotFound");

  return revision;
});

export const sealClaimRecord = Effect.fn("claims.seal")(function* <A>(
  tx: Transaction,
  scope: Scope,
  actorId: string,
  key: string,
  operation: string,
  schema: Schema.Decoder<A>,
  values: Schema.JsonObject,
) {
  const body = {
    ...Object.fromEntries(Object.entries(values)),
    scope,
    createdAt: yield* isoNow(tx),
    createdBy: actorId,
    receipt: { key, operation, actorId },
  };

  return yield* decode(schema, yield* toJsonObject({ ...body, digest: yield* digest(body) }));
});

export const retainClaimRecord = Effect.fn("claims.retain")(function* (
  tx: Transaction,
  table: (typeof Db.claimRecordTables)[number],
  row: { readonly id: string; readonly scope: Scope },
) {
  const body = yield* toJsonObject(row);

  if (
    typeof body.claimId === "string" &&
    (yield* Db.records(tx, row.scope.bookId, table, body.claimId)).length >= 50
  )
    return yield* failure("UnsupportedProfile");
  yield* Db.insertRecord(tx, table, row.scope.bookId, row.id, body);
});

export const readClaimRecord = Effect.fn("claims.readRecord")(function* <A>(
  tx: Transaction,
  scope: Scope,
  table: (typeof Db.claimRecordTables)[number],
  id: string,
  schema: Schema.Decoder<A>,
) {
  const row = (yield* Db.record(tx, scope.bookId, table, id))[0];

  if (!row) return yield* failure("NotFound");

  const identity = Schema.Struct({
    id: Schema.String,
    scope: Schema.Struct({ entityId: Schema.String, bookId: Schema.String }),
    digest: Schema.String,
  });

  const value = yield* decode(identity, row.body);

  if (
    value.id !== id ||
    value.scope.entityId !== scope.entityId ||
    value.scope.bookId !== scope.bookId ||
    value.digest !==
      (yield* digest(
        Object.fromEntries(Object.entries(row.body).filter(([field]) => field !== "digest")),
      ))
  )
    return yield* failure("StaleDependency");

  return yield* decode(schema, row.body);
});

export const claimHistory = Effect.fn("claims.history")(function* <A>(
  tx: Transaction,
  scope: Scope,
  claimId: string,
  table: (typeof Db.claimRecordTables)[number],
  schema: Schema.Decoder<A>,
) {
  const rows = yield* Db.records(tx, scope.bookId, table, claimId);

  if (rows.length > 50) return yield* failure("UnsupportedProfile");
  const records = [];

  for (const row of rows) records.push(yield* decode(schema, row.body));

  return records;
});

export const currentClaimRevision = Effect.fn("claims.currentRevision")(function* (
  tx: Transaction,
  scope: Scope,
  claimId: string,
) {
  const revisions = yield* claimHistory(
    tx,
    scope,
    claimId,
    "employee_claim_revisions",
    Claims.EmployeeClaimRevision,
  );

  const current = revisions.at(-1);

  if (!current) return yield* failure("NotFound");

  return current;
});

const qualifiedTax = Effect.fn("claims.qualifiedTax")(function* (
  tx: Transaction,
  scope: Scope,
  selection: typeof Claims.ClaimSourceSelection.Type,
  receipt: typeof Claims.SyntheticEmployeeReceipt.Type,
) {
  if (!selection.taxSourceId || !selection.taxSourceDigest || !selection.taxReviewDigest)
    return yield* failure("MissingEvidence");
  const sourceRow = (yield* TaxDb.readCurrentRevision(tx, scope.bookId, selection.taxSourceId))[0];
  const reviewRow = (yield* TaxDb.readLatestReview(tx, scope.bookId, selection.taxSourceId))[0];

  if (!sourceRow || !reviewRow) return yield* failure("MissingEvidence");
  const source = yield* decode(Tax.TaxSourceRevision, sourceRow.body);
  const review = yield* decode(Tax.TaxReview, reviewRow.body);

  if (
    source.scope.entityId !== scope.entityId ||
    source.scope.bookId !== scope.bookId ||
    review.scope.entityId !== scope.entityId ||
    review.scope.bookId !== scope.bookId ||
    source.digest !== selection.taxSourceDigest ||
    review.digest !== selection.taxReviewDigest ||
    review.sourceDigest !== source.digest ||
    source.evidenceSha256 !== selection.sha256.slice(7) ||
    source.facts.sourceLocator !== selection.occurrenceId ||
    source.facts.recordClass !== "synthetic" ||
    source.facts.amounts.grossMinor !== receipt.grossMinor ||
    source.facts.amounts.netMinor !== receipt.netMinor ||
    source.facts.amounts.vatMinor !== receipt.vatMinor ||
    source.facts.issuedOn !== receipt.issuedOn
  )
    return yield* failure("StaleDependency");
  yield* requireRetainedEvidence(tx, scope.bookId, {
    evidenceId: source.facts.evidenceId,
    sha256: source.evidenceSha256,
  });

  const assessment = yield* assessSource(tx, scope, sourceRow.body, reviewRow.body, {
    mode: "synthetic_demonstration",
    startsOn: receipt.issuedOn,
    endsOn: receipt.issuedOn,
  });

  if (
    assessment.state !== "included_synthetic" ||
    assessment.blockers.length ||
    !assessment.contribution
  )
    return yield* failure("UnsupportedProfile");

  return { source, review, assessment };
});

const requireSyntheticClaimBook = Effect.fn("claims.syntheticBook")(function* (
  tx: Transaction,
  scope: Scope,
) {
  const book = (yield* Ledger.readBook(tx, scope))[0];

  if (
    !book ||
    book.profile !== "synthetic-core-v1" ||
    book.currency !== "SEK" ||
    book.currencyScale !== 2
  )
    return yield* failure("UnsupportedProfile");
});

export const captureClaimSources = Effect.fn("claims.captureSources")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof Claims.SubmitEmployeeClaim.Type,
) {
  yield* requireSyntheticClaimBook(tx, scope);

  if (new Set(input.items.map((item) => item.occurrenceId)).size !== 3)
    return yield* failure("InvalidJournal");
  const seen = new Map<string, typeof Claims.ClaimSourceItem.Type>();
  const items: Array<typeof Claims.ClaimSourceItem.Type> = [];

  for (const selection of input.items) {
    const original = yield* readSourceBytesInTransaction(tx, scope, selection.occurrenceId);

    if (original.occurrence.sha256 !== selection.sha256) return yield* failure("StaleDependency");

    if (original.occurrence.mediaType !== "application/json")
      return yield* failure("UnsupportedProfile");

    const receipt = yield* Schema.decodeEffect(
      Schema.fromJsonString(Claims.SyntheticEmployeeReceipt),
    )(new TextDecoder().decode(original.bytes)).pipe(
      Effect.mapError(() => failure("UnsupportedProfile")),
    );

    if (
      receipt.employeeId !== input.employeeId ||
      receipt.issuedOn.slice(0, 7) !== input.month ||
      BigInt(receipt.netMinor) + BigInt(receipt.vatMinor) !== BigInt(receipt.grossMinor) ||
      BigInt(receipt.grossMinor) <= 0n
    )
      return yield* failure("UnsupportedProfile");

    const partyRow = (yield* PartyDb.readCounterpartyHead(
      tx,
      scope.bookId,
      receipt.counterpartyId,
    ))[0];

    if (!partyRow) return yield* failure("NotFound");
    const party = yield* decode(Commerce.CounterpartyRevision, partyRow.revision);
    const identity = `${economicKey(receipt.counterpartyId, receipt.supplierDocumentNumber)}:${receipt.sourceLineId}`;
    const previous = seen.get(identity);

    const tax =
      previous || receipt.paidBy === "company"
        ? null
        : yield* qualifiedTax(tx, scope, selection, receipt);

    const item: typeof Claims.ClaimSourceItem.Type = {
      selection,
      occurrence: original.occurrence,
      receipt,
      supplierName: party.displayName,
      counterpartyRevision: party.revision,
      outcome: previous ? "duplicate" : receipt.paidBy === "company" ? "company_paid" : "qualified",
      originalOccurrenceId: previous?.occurrence.id ?? null,
      assessment: tax?.assessment ?? null,
      reimbursementMinor: tax?.assessment.contribution?.grossMinor ?? "0",
    };

    if (
      previous &&
      (previous.receipt.grossMinor !== receipt.grossMinor ||
        previous.receipt.paidBy !== receipt.paidBy)
    )
      return yield* failure("StaleDependency");

    if (!previous) seen.set(identity, item);
    items.push(item);
  }

  if (
    items.filter((item) => item.outcome === "qualified").length !== 1 ||
    items.filter((item) => item.outcome === "company_paid").length !== 1 ||
    items.filter((item) => item.outcome === "duplicate").length !== 1
  )
    return yield* failure("UnsupportedProfile");

  return items;
});

export const claimInput = Effect.fn("claims.inputBasis")(function* (
  tx: Transaction,
  scope: Scope,
  revision: typeof Claims.EmployeeClaimRevision.Type,
  review: typeof Claims.ReviewEmployeeClaim.Type,
  items: ReadonlyArray<typeof Claims.ClaimSourceItem.Type>,
) {
  const eligible = items.find((item) => item.outcome === "qualified");

  if (!eligible) return yield* failure("UnsupportedProfile");
  const qualified = yield* qualifiedTax(tx, scope, eligible.selection, eligible.receipt);
  const facts = qualified.review.facts;

  if (
    facts.rateNumerator === null ||
    facts.rateDenominator === null ||
    facts.deductionNumerator === null ||
    facts.deductionDenominator === null ||
    !facts.deductionBasis
  )
    return yield* failure("UnsupportedProfile");

  const input: typeof Inputs.SubmitPayrollInput.Type = {
    employeeId: revision.input.employeeId,
    month: revision.input.month,
    recordClass: "synthetic",
    economicKey: `claim:${revision.claimId}:${revision.revision}`,
    evidence: {
      evidenceId: qualified.source.facts.evidenceId,
      sha256: qualified.source.evidenceSha256,
    },
    purpose: revision.input.purpose,
    accountingPeriodId: review.accountingPeriodId,
    postingDate: review.postingDate,
    series: review.series,
    liabilityAccountId: review.liabilityAccountId,
    basis: {
      kind: "claim",
      paidBy: "employee",
      counterpartyId: eligible.receipt.counterpartyId,
      supplierDocumentNumber: eligible.receipt.supplierDocumentNumber,
      inputVatAccountId: review.inputVatAccountId,
      line: {
        sourceLineId: eligible.receipt.sourceLineId,
        expenseAccountId: review.expenseAccountId,
        netMinor: eligible.receipt.netMinor,
        sourceTaxMinor: eligible.receipt.vatMinor,
        sourceGrossMinor: eligible.receipt.grossMinor,
        treatment: {
          treatmentId: "synthetic_expense_tax_v1",
          rate: { numerator: facts.rateNumerator, denominator: facts.rateDenominator },
          deduction: {
            numerator: facts.deductionNumerator,
            denominator: facts.deductionDenominator,
          },
          invoiceTaxRounding: "half_up",
          deductionRounding: "half_up",
          acceptancePolicy: "exact_match",
          toleranceMinor: "0",
          basis: facts.deductionBasis,
        },
        sourceRefs: [
          { evidenceId: qualified.source.facts.evidenceId, sourceKey: eligible.occurrence.id },
        ],
      },
    },
  };

  if (review.postingDate.slice(0, 7) !== revision.input.month)
    return yield* failure("UnsupportedProfile");

  return input;
});

export const checkedInstruction = Effect.fn("claims.checkedInstruction")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest?: string,
) {
  const instruction = yield* readClaimRecord(
    tx,
    scope,
    "employee_claim_instructions",
    id,
    Claims.ClaimInstruction,
  );

  if (expectedDigest !== undefined && instruction.digest !== expectedDigest)
    return yield* failure("StaleDependency");

  const recognition = yield* readClaimRecord(
    tx,
    scope,
    "employee_claim_recognitions",
    instruction.recognitionId,
    Claims.EmployeeClaimRecognition,
  );

  if (
    recognition.inputExecution.id !== instruction.parentExecutionId ||
    recognition.inputExecution.inputId !== instruction.parentInputId
  )
    return yield* failure("StaleDependency");
  yield* requireRetainedEvidence(tx, scope.bookId, instruction.evidence);

  return instruction;
});
