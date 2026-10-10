import * as Contract from "@open-erp/contracts/decision-examples";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Provenance from "@open-erp/contracts/decision-provenance";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../../db/decision-examples";
import { withBook, decode, toJsonObject } from "../commerce/support";
import { failure } from "../failures";
import { digest, newId, replay, saveCommand } from "../posting";
import * as Shared from "../purchases/shared";

const versions = {
  schema: "decision_examples_v1",
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

const project = Effect.fn("decisionExamples.project")(function* (
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
    const record = yield* decode(Provenance.SuggestionRecord, Shared.objectField(item, "body"));

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

  let state: Schema.JsonObject;
  let chosenTreatment: Schema.JsonObject;
  const evidence: Schema.JsonObject[] = [];
  const lineage: Schema.JsonObject[] = [];

  const missingFacts = [
    "historical_chart_universe_not_captured",
    "vat_category_not_captured",
    "statement_mapping_not_captured",
  ];

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
    chosenTreatment = yield* toJsonObject({
      journal: journal(action),
      reviewedTreatments: review.originalLines ?? [],
      vatCategory: "not_captured",
    });

    if (retained.mediaType === "text/plain" && typeof retained.content === "string") {
      const text = redact(retained.content);
      evidence.push({
        id: textField(retained, "evidenceId"),
        sourceDigest: textField(retained, "sourceDigest"),
        redactedDigest: yield* digest(text),
        transcript: text,
      });
    } else missingFacts.push("source_text_not_captured");
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

  const classification = yield* Schema.decodeUnknownEffect(Provenance.DecisionClassification)(
    row.classification,
  ).pipe(Effect.mapError(() => failure("InternalError")));

  const body = {
    decision: { owner: row.owner, id: row.id },
    subject,
    originalCommitCutoff: cutoff,
    stateBuilderVersion: versions.state,
    optionBuilderVersion: versions.options,
    state,
    options: {
      capture:
        row.body.uncitedExposure === true
          ? "uncited_exposure"
          : ids.length === 0
            ? "no_recorded_exposure"
            : "served_options_only",
      fullUniverseCaptured: false,
      records: optionRecords,
    },
    chosenTreatment,
    provenance: { classification, digest: yield* digest(row.body) },
    lineage,
    evidence,
    missingFacts,
  };

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

        const result = yield* project(row, snapshot);

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
