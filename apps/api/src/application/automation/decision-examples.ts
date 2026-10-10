import * as Memory from "@open-erp/domain/firm-memory";
import * as Contract from "@open-erp/contracts/decision-examples";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Provenance from "@open-erp/contracts/decision-provenance";
import * as Consequence from "@open-erp/domain/treatment-consequence";
import * as ApprovalCapture from "@open-erp/contracts/approval-consequences";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import * as Db from "../../db/decision-examples";
import { withBook, decode, toJsonObject } from "../commerce/support";
import { failure } from "../failures";
import { digest, newId, replay, saveCommand } from "../posting";
import * as Shared from "../purchases/shared";

const versions = {
  schema: "decision_examples_v3",
  memory: "firm_memory_v1",
  consequence: "treatment_consequence_v1",
  state: "retained_snapshot_projection_v1",
  options: "served_options_projection_v1",
  lineage: "posted_voucher_lineage_v1",
  redaction: "swedish_personal_id_v1",
  eligibility: "independent_corrected_v1",
};

function redact(text: string) {
  return text.replace(/\b(?:\d{2})?\d{6}[-+ ]?\d{4}\b/g, "[REDACTED_PERSONAL_ID]");
}

function fieldValue(key: string, value: Schema.Json | undefined) {
  if (typeof value !== "string") return null;

  if (
    ["title", "supplierDocumentNumber", "paymentTerms", "description", "taxDescription"].includes(
      key,
    )
  )
    return redact(value);

  return Schema.is(Extraction.ExtractionFieldKey)(key) ? value : null;
}

function textField(value: Schema.JsonObject, key: string) {
  return Shared.textField(value, key) ?? "";
}

function object(value: Schema.Json) {
  return Shared.isJsonObject(value) ? value : {};
}

function journal(action: typeof Accounting.VoucherPostingAction.Type) {
  return {
    postingDate: action.postingDate,
    accountingPeriodId: action.accountingPeriodId,
    lines: action.lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
    })),
  };
}

function consequenceAttachment(inputs: Consequence.CapturedTreatment[]) {
  return {
    builderVersion: "treatment_consequence_v1",
    captureStatus: inputs.length > 0 ? "retained_treatments" : "not_accounting_treatment",
    treatments: inputs.map((capture) => ({ capture, result: Consequence.classify(capture) })),
  };
}

function capturedVatCategory(review: typeof Acceptance.SupplierAcceptanceReview.Type) {
  return review.originalLines?.[0]?.treatment.categoryResolution?.categoryId ?? "not_captured";
}

function appendMissingMapping(missingFacts: string[], inputs: Consequence.CapturedTreatment[]) {
  if (inputs.length === 0 || inputs.some((capture) => capture.mapping === null))
    missingFacts.push("statement_mapping_not_captured");
}

function appendMissingVatCategory(missingFacts: string[], inputs: Consequence.CapturedTreatment[]) {
  if (inputs.length === 0 || inputs.some((capture) => capture.vat.category === null)) {
    missingFacts.push("vat_category_not_captured");
  }
}

const approvalConsequences = Effect.fn("decisionExamples.approvalConsequences")(function* (
  selected: Schema.JsonObject,
  review: typeof Acceptance.SupplierAcceptanceReview.Type,
  action: typeof Accounting.VoucherPostingAction.Type,
  cutoff: string,
) {
  const chosenTreatment = yield* toJsonObject({
    journal: journal(action),
    reviewedTreatments: review.originalLines ?? [],
    vatCategory: capturedVatCategory(review),
  });

  const legacy = (reason: string) => ({
    inputs: consequenceCaptures(action, cutoff, review.originalLines, review.profileWitness),
    missingFacts: [reason],
    chosenTreatment,
  });

  if (selected.consequenceCapture === undefined)
    return legacy("approval_consequence_capture_not_retained");

  const capture = yield* decode(
    ApprovalCapture.ApprovalConsequenceCapture,
    object(selected.consequenceCapture),
  );

  if (capture.status !== "captured") return legacy(capture.status);

  return {
    inputs: capture.sourceLines.map((line) => line.capture),
    missingFacts: [],
    chosenTreatment: yield* toJsonObject({
      journal: journal(action),
      reviewedTreatments: review.originalLines ?? [],
      vatCategory: capturedVatCategory(review),
      sourcePostingBindings: capture.sourceLines.map((line) => ({
        sourceLineId: line.sourceLineId,
        postingLineId: line.postingLineId,
      })),
      mappingRelease: capture.mappingRelease,
    }),
  };
});

function consequenceCaptures(
  action: typeof Accounting.VoucherPostingAction.Type,
  originalCommitCutoff: string,
  reviewed: (typeof Acceptance.SupplierAcceptanceReview.Type)["originalLines"],
  witness: (typeof Acceptance.SupplierAcceptanceReview.Type)["profileWitness"],
): Consequence.CapturedTreatment[] {
  const accounts =
    reviewed && reviewed.length > 0
      ? reviewed.map((line) => ({
          accountId: line.expenseAccountId,
          deduction: line.treatment.deduction,
          resolvedRate: line.treatment.rate,
          category: line.treatment.categoryResolution?.categoryId ?? null,
          profileIdentity: line.treatment.categoryResolution?.ruleReleaseChecksum ?? null,
        }))
      : action.lines.map((line) => ({
          accountId: line.accountId,
          deduction: null,
          resolvedRate: null,
          category: null,
          profileIdentity: null,
        }));

  return accounts.map((account) => {
    const lines = action.lines.filter((line) => line.accountId === account.accountId);
    const assignments = lines.length === 1 ? lines[0]?.originalDimensions : undefined;

    return {
      accountId: account.accountId,
      originalCommitCutoff,
      postingOn: action.postingDate,
      mapping: null,
      vat: {
        category: account.category,
        profileIdentity:
          account.profileIdentity ??
          (witness?.family === "vat" ? witness.ruleReleaseChecksum : null),
        resolvedRate: account.resolvedRate,
        deduction: account.deduction,
      },
      period: { id: action.accountingPeriodId, startsOn: null, endsOn: null },
      dimensions: {
        requirements: null,
        assignments:
          assignments?.map((value) => ({
            code: value.dimensionCode,
            revision: value.dimensionRevision,
            valueCode: value.valueCode,
            valueRevision: value.valueRevision,
          })) ?? null,
      },
    };
  });
}

const projectBank = Effect.fn("decisionExamples.bank")(function* (
  selected: Schema.JsonObject,
  snapshot: Schema.JsonObject,
) {
  const basis = Shared.objectField(selected, "bankBasis");

  if (Object.keys(basis).length === 0) return { excluded: "missing_bank_snapshot" };
  const voucherId = textField(selected, "voucherId");
  const vouchers = Shared.arrayField(snapshot, "vouchers").map(object);
  const target = vouchers.find((item) => item.id === voucherId);

  if (!target) return { excluded: "missing_ledger_identity" };

  if (target.personal === true) return { excluded: "personal_owner" };

  if (vouchers.some((item) => item.original === voucherId))
    return { excluded: "reversed_without_replacement" };

  if (
    Shared.arrayField(snapshot, "bankReversals")
      .map(object)
      .some(
        (item) =>
          item.statementId === selected.statementId && item.rowOrdinal === selected.rowOrdinal,
      )
  )
    return { excluded: "bank_match_reversed" };

  return {
    state: yield* toJsonObject({
      observedOn: basis.observedOn,
      description: redact(textField(basis, "description")),
      amountMinor: basis.amountMinor,
      accountId: basis.accountId,
      sourceRevision: basis.sourceRevision,
    }),
    chosenTreatment: yield* toJsonObject({
      voucherId,
      lineId: selected.lineId,
      ledgerSequence: target.sequence,
    }),
    evidence: {
      id: textField(basis, "evidenceId"),
      sourceDigest: textField(basis, "evidenceDigest"),
    },
  };
});

type PrecedentBasis = Omit<
  Memory.Precedent,
  | "chosenTreatment"
  | "provenance"
  | "consequences"
  | "lineage"
  | "digest"
  | "labelSequence"
  | "accountHints"
>;

type CompatibilityHint = {
  expenseAccountId: string;
  vatRatePercent: 0 | 6 | 12 | 25;
  sourceInvoiceId: string;
  categoryResolution?: Schema.JsonObject;
};

const attachPrecedent = Effect.fn("decisionExamples.attachPrecedent")(function* (
  precedentBasis: PrecedentBasis | undefined,
  chosenTreatment: Schema.JsonObject,
  classification: string,
  provenanceBody: Schema.JsonObject,
  consequenceInputs: Consequence.CapturedTreatment[],
  lineage: Schema.JsonObject[],
  accountHints: Memory.Precedent["accountHints"],
) {
  let precedent: Memory.Precedent | undefined;

  if (precedentBasis) {
    const precedentBody = {
      ...precedentBasis,
      chosenTreatment,
      provenance: { classification, digest: yield* digest(provenanceBody) },
      consequences: consequenceInputs.map(Consequence.classify),
      lineage,
      labelSequence: lineage.length
        ? textField(lineage[lineage.length - 1]!, "sequence")
        : precedentBasis.receiptSequence,
      relatedIds: [
        ...precedentBasis.relatedIds,
        ...lineage.flatMap((item) => [
          `voucher:${textField(item, "voucherId")}`,
          `voucher:${textField(item, "previousVoucherId")}`,
        ]),
      ],
      accountHints: lineage.length ? [] : accountHints,
    };

    precedent = yield* decode(Memory.Precedent, {
      ...precedentBody,
      digest: yield* digest(precedentBody),
    });
  }

  return precedent;
});

const retainedPrecedentBasis = Effect.fn("decisionExamples.precedentBasis")(function* (
  row: Db.InventoryRow,
  retained: Schema.JsonObject,
  review: typeof Acceptance.SupplierAcceptanceReview.Type,
  cutoff: string,
) {
  const content = review.draftSnapshot.content;
  const accountHints: Memory.Precedent["accountHints"][number][] = [];

  if (
    retained.acceptedApprovalId === row.id &&
    /^\d+$/.test(textField(retained, "receiptSequence")) &&
    content.counterpartyId !== null
  ) {
    const sourceInvoiceId = textField(retained, "sourceInvoiceId");

    const basis: PrecedentBasis = {
      id: row.id,
      bookId: review.scope.bookId,
      counterpartyId: content.counterpartyId,
      documentKind: "supplier_invoice",
      currency: content.currency,
      currencyScale: content.currencyScale,
      description: content.lines.map((line) => redact(line.description)).join(" | "),
      amountMinor: content.sourceTotalMinor,
      originalCommitCutoff: cutoff,
      receiptSequence: textField(retained, "receiptSequence"),
      sourceInvoiceId: sourceInvoiceId || null,
      sourceDecisionIds: [row.id],
      relatedIds: [
        `draft:${review.draftSnapshot.id}`,
        `evidence:${content.sourceEvidenceId}`,
        `invoice:${sourceInvoiceId}`,
        `voucher:${textField(retained, "voucherId")}`,
      ],
    };

    for (const line of review.originalLines ?? []) {
      const numerator = BigInt(line.treatment.rate.numerator) * 100n;
      const denominator = BigInt(line.treatment.rate.denominator);
      const percent = Number(numerator / denominator);

      if (
        sourceInvoiceId &&
        numerator % denominator === 0n &&
        (percent === 0 || percent === 6 || percent === 12 || percent === 25)
      ) {
        const hint: CompatibilityHint = {
          expenseAccountId: line.expenseAccountId,
          vatRatePercent: percent,
          sourceInvoiceId,
        };

        if (line.treatment.categoryResolution)
          hint.categoryResolution = yield* toJsonObject(line.treatment.categoryResolution);
        accountHints.push(hint);
      }
    }

    return { basis, accountHints };
  }

  return { basis: undefined, accountHints };
});

function exposureCapture(uncited: Schema.Json | undefined, count: number) {
  if (uncited === true) return "uncited_exposure";

  return count === 0 ? "no_recorded_exposure" : "served_options_only";
}

export const projectDecisionExample = Effect.fn("decisionExamples.project")(function* (
  row: Db.InventoryRow,
  snapshot: Schema.JsonObject,
) {
  if (["payroll", "employee_claim", "personal_batch", "personal_bank"].includes(row.owner))
    return { excluded: "personal_owner" };

  if (!["supplier_approval", "extraction_field", "bank_match"].includes(row.owner))
    return { excluded: "unsupported_snapshot_owner" };

  if (row.body === null) return { excluded: "missing_capture_version" };

  if (row.body.captureVersion !== "decision_provenance_v1")
    return { excluded: "missing_capture_version" };
  const selected = Shared.objectField(row.body, "selected");
  const cutoff = textField(selected, "bookCommitSequence");

  if (!/^\d+$/.test(cutoff)) return { excluded: "missing_original_cutoff" };
  const subject = Shared.objectField(row.body, "subject");

  const ids = Shared.arrayField(row.body, "presentedSuggestionIds").filter(
    (id): id is string => typeof id === "string",
  );

  const suggestions = Shared.arrayField(snapshot, "suggestions")
    .map(object)
    .filter((item) => ids.includes(textField(item, "id")));

  if (suggestions.length !== ids.length) return { excluded: "missing_options_capture" };
  const optionRecords: Schema.JsonObject[] = [];

  for (const item of suggestions) {
    const decodedRecord = Schema.decodeUnknownResult(Provenance.SuggestionRecord)(
      Shared.objectField(item, "body"),
    );

    if (Result.isFailure(decodedRecord)) return { excluded: "undecodable_capture" };
    const record = decodedRecord.success;

    const ranked =
      record.ranked.source === "extraction"
        ? {
            ...record.ranked,
            options: record.ranked.options.map((option) => ({
              ...option,
              value: fieldValue(option.fieldKey, option.value),
            })),
          }
        : record.ranked;

    optionRecords.push(
      yield* toJsonObject({
        id: record.id,
        sourceDigest: yield* digest(record),
        optionSetDigest: record.optionSetDigest,
        ranked,
        redactedDigest: yield* digest(ranked),
      }),
    );
  }

  let precedentBasis: PrecedentBasis | undefined;
  let accountHints: Memory.Precedent["accountHints"] = [];
  let state: Schema.JsonObject;
  let chosenTreatment: Schema.JsonObject;
  let consequenceInputs: Consequence.CapturedTreatment[] = [];
  const evidence: Schema.JsonObject[] = [];
  const lineage: Schema.JsonObject[] = [];

  const missingFacts = ["historical_chart_universe_not_captured"];

  if (row.body.uncitedExposure === true) missingFacts.push("uncited_option_records_not_bound");

  if (row.owner === "supplier_approval") {
    const retained = Shared.arrayField(snapshot, "reviews")
      .map(object)
      .find((item) => item.id === selected.reviewId);

    if (!retained) return { excluded: "missing_review_snapshot" };

    const review = yield* decode(
      Acceptance.SupplierAcceptanceReview,
      Shared.objectField(retained, "body"),
    );

    const content = review.draftSnapshot.content;
    state = yield* toJsonObject({
      reviewId: review.id,
      reviewDigest: review.digest,
      draftId: review.draftSnapshot.id,
      draftRevision: review.draftSnapshot.revision,
      draftDigest: review.draftSnapshot.digest,
      documentDate: content.documentDate,
      supplyDate: content.supplyDate,
      currency: content.currency,
      sourceTotalMinor: content.sourceTotalMinor,
      lines: content.lines.map((line) => ({
        id: line.id,
        description: redact(line.description),
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        baseMinor: line.baseMinor,
        discountMinor: line.discountMinor,
        chargeMinor: line.chargeMinor,
        taxMinor: line.taxMinor,
        sourceGrossMinor: line.sourceGrossMinor,
      })),
    });
    const action = review.postingPlan.groups[0]?.actions[0];

    if (!action || action.kind !== "post_voucher") return { excluded: "missing_posting_snapshot" };
    const retainedConsequence = yield* approvalConsequences(selected, review, action, cutoff);

    consequenceInputs = retainedConsequence.inputs;
    missingFacts.push(...retainedConsequence.missingFacts);
    chosenTreatment = retainedConsequence.chosenTreatment;

    if (retained.mediaType === "text/plain" && typeof retained.content === "string") {
      const text = redact(retained.content);
      evidence.push({
        id: textField(retained, "evidenceId"),
        sourceDigest: textField(retained, "sourceDigest"),
        redactedDigest: yield* digest(text),
        transcript: text,
      });
    } else missingFacts.push("source_text_not_captured");
    const retainedBasis = yield* retainedPrecedentBasis(row, retained, review, cutoff);
    precedentBasis = retainedBasis.basis;
    accountHints = retainedBasis.accountHints;
    const voucherId = textField(retained, "voucherId");
    let current = voucherId;
    const vouchers = Shared.arrayField(snapshot, "vouchers").map(object);
    const visited = new Set<string>();

    while (current !== "") {
      if (visited.has(current)) return { excluded: "invalid_lineage_cycle" };
      visited.add(current);
      const descendants = vouchers.filter((item) => item.original === current);

      if (descendants.length === 0) break;

      if (descendants.some((item) => item.personal === true))
        return { excluded: "personal_replacement_owner" };
      const replacement = descendants.find((item) => item.purpose !== "reversal");

      if (!replacement) return { excluded: "reversed_without_replacement" };

      const replacementAction = yield* decode(
        Accounting.VoucherPostingAction,
        Shared.objectField(replacement, "body"),
      );

      lineage.push({
        voucherId: textField(replacement, "id"),
        receiptId: textField(replacement, "receiptId"),
        bundleId: textField(replacement, "bundleId"),
        bundleDigest: textField(replacement, "bundleDigest"),
        sequence: textField(replacement, "sequence"),
        sourceDigest: yield* digest(Shared.objectField(replacement, "body")),
        previousVoucherId: current,
      });
      chosenTreatment = yield* toJsonObject({
        journal: journal(replacementAction),
        reviewedTreatments: [],
        vatReasoning: "replacement_journal_only",
      });
      consequenceInputs = consequenceCaptures(replacementAction, cutoff, undefined, undefined);
      missingFacts.push("replacement_vat_reasoning_not_captured");
      current = textField(replacement, "id");
    }
  } else if (row.owner === "bank_match") {
    const bank = yield* projectBank(selected, snapshot);

    if (bank.excluded !== undefined) return { excluded: bank.excluded };
    state = bank.state;
    chosenTreatment = bank.chosenTreatment;
    evidence.push(bank.evidence);
  } else {
    const field = Shared.objectField(selected, "mergedField");

    if (Object.keys(field).length === 0) return { excluded: "missing_field_snapshot" };

    const attempt = Shared.arrayField(snapshot, "attempts")
      .map(object)
      .find((item) => item.id === subject.attemptId);

    if (!attempt) return { excluded: "missing_attempt_snapshot" };
    const attemptBody = Shared.objectField(Shared.objectField(attempt, "body"), "extraction");
    const document = attemptBody.document;

    if (document === undefined) return { excluded: "source_text_not_captured" };
    const reading = yield* decode(Extraction.DocumentReadingEvidence, object(document));
    const text = redact(reading.transcript);
    evidence.push({
      attemptId: textField(attempt, "id"),
      sourceDigest: yield* digest(reading),
      redactedDigest: yield* digest(text),
      transcript: text,
    });
    state = yield* toJsonObject({
      fieldKey: selected.fieldKey,
      lineOrdinal: selected.lineOrdinal,
      state: field.state,
      current: fieldValue(textField(selected, "fieldKey"), field.current),
      suggestion: fieldValue(textField(selected, "fieldKey"), field.suggestion),
    });
    chosenTreatment = yield* toJsonObject({
      fieldKey: selected.fieldKey,
      lineOrdinal: selected.lineOrdinal,
      decisionKind: selected.decisionKind,
      value: fieldValue(textField(selected, "fieldKey"), selected.selectedValue),
    });
  }

  appendMissingMapping(missingFacts, consequenceInputs);

  appendMissingVatCategory(missingFacts, consequenceInputs);

  const classification = yield* Schema.decodeUnknownEffect(Provenance.DecisionClassification)(
    row.classification,
  ).pipe(Effect.mapError(() => failure("InternalError")));

  const precedent = yield* attachPrecedent(
    precedentBasis,
    chosenTreatment,
    classification,
    row.body,
    consequenceInputs,
    lineage,
    accountHints,
  );

  const body = {
    ...(yield* toJsonObject({
      decision: { owner: row.owner, id: row.id },
      subject,
      originalCommitCutoff: cutoff,
      stateBuilderVersion: versions.state,
      optionBuilderVersion: versions.options,
      state,
      options: {
        capture: exposureCapture(row.body.uncitedExposure, ids.length),
        fullUniverseCaptured: false,
        records: optionRecords,
      },
      chosenTreatment,
      consequence: consequenceAttachment(consequenceInputs),
      provenance: { classification, digest: yield* digest(row.body) },
      lineage,
      evidence,
      missingFacts,
    })),
  };

  if (precedent) body.precedent = yield* toJsonObject(precedent);

  return {
    example: yield* decode(Contract.DecisionExample, { ...body, digest: yield* digest(body) }),
  };
});

export const sealDecisionExamples = Effect.fn("decisionExamples.seal")(function* (
  token: string,
  command: {
    scope: typeof Accounting.Scope.Type;
    idempotencyKey: string;
    input: typeof Contract.SealDecisionExamples.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "seal_decision_examples",
        principal.actorId,
        yield* toJsonObject(command.input),
        Contract.DecisionExampleExport,
      );

      if (request.previous !== undefined) return request.previous;
      const retained = (yield* Db.snapshot(transaction, command.scope.bookId))[0];

      if (!retained) return yield* failure("NotFound");
      const snapshot = retained.body;

      const inventory = yield* Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({
            owner: Schema.String,
            id: Schema.String,
            classification: Schema.NullOr(Schema.String),
            body: Schema.NullOr(Schema.JsonObject),
          }),
        ),
      )(snapshot.inventory).pipe(Effect.mapError(() => failure("InternalError")));

      const selection = command.input.selectedDecisionIds;

      if (
        new Set(selection).size !== selection.length ||
        selection.some((id) => !inventory.some((row) => row.id === id))
      )
        return yield* failure("InvalidJournal");

      const selected =
        selection.length === 0 ? inventory : inventory.filter((row) => selection.includes(row.id));

      if (
        command.input.purpose === "evaluation" &&
        selection.length > 0 &&
        selected.some((row) => !["independent", "corrected"].includes(row.classification ?? ""))
      )
        return yield* failure("UnsupportedProfile");
      const examples = [];
      const exclusions = [];
      const identities = [];

      for (const row of inventory)
        identities.push({ owner: row.owner, id: row.id, digest: yield* digest(row) });

      for (const row of selected) {
        if (
          command.input.purpose === "evaluation" &&
          !["independent", "corrected"].includes(row.classification ?? "")
        ) {
          exclusions.push({ owner: row.owner, id: row.id, reason: "evaluation_ineligible" });
          continue;
        }

        const result = yield* projectDecisionExample(row, snapshot);

        if (result.example) examples.push(result.example);
        else
          exclusions.push({
            owner: row.owner,
            id: row.id,
            reason: result.excluded ?? "missing_snapshot",
          });
      }

      const lineageInventory = [];

      for (const item of Shared.arrayField(snapshot, "vouchers").map(object)) {
        lineageInventory.push({
          kind: "voucher",
          id: textField(item, "id"),
          digest: yield* digest({
            id: item.id ?? null,
            sequence: item.sequence ?? null,
            purpose: item.purpose ?? null,
            receiptId: item.receiptId ?? null,
            bundleId: item.bundleId ?? null,
            bundleDigest: item.bundleDigest ?? null,
            original: item.original ?? null,
            personal: item.personal ?? null,
          }),
        });
      }

      for (const item of Shared.arrayField(snapshot, "bankReversals").map(object))
        lineageInventory.push({
          kind: "bank_match_reversal",
          id: textField(item, "id"),
          digest: textField(item, "digest"),
        });
      const exclusionCounts: Record<string, number> = {};

      for (const row of exclusions)
        exclusionCounts[row.reason] = (exclusionCounts[row.reason] ?? 0) + 1;

      const body = {
        id: newId("decision_export"),
        scope: command.scope,
        purpose: command.input.purpose,
        lineageCutoff: textField(snapshot, "cutoff"),
        versions,
        examples,
        exclusions,
        manifest: {
          denominators: {
            inventory: inventory.length,
            selected: selected.length,
            exported: examples.length,
            excluded: exclusions.length,
          },
          inventory: identities,
          exclusionCounts,
          lineageInventory,
        },
      };

      const result = yield* decode(Contract.DecisionExampleExport, {
        ...body,
        digest: yield* digest(body),
      });

      const json = yield* toJsonObject(result);
      yield* Db.retain(transaction, command.scope.bookId, result.id, json, result.digest);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "seal_decision_examples",
        principal.actorId,
        json,
      );

      return result;
    },
    "update",
  );
});

export const getDecisionExamples = Effect.fn("decisionExamples.get")(function* (
  token: string,
  command: { scope: typeof Accounting.Scope.Type; id: string },
) {
  return yield* withBook(token, command.scope, true, function* (transaction) {
    const row = (yield* Db.read(transaction, command.scope.bookId, command.id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contract.DecisionExampleExport, row.body);
  });
});
