import { admitReviewedStatement } from "./banking/source-statement";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Automation from "@open-erp/contracts/automation";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Deadlines from "@open-erp/contracts/deadlines";
import * as Intake from "@open-erp/contracts/source-intake";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "./identity";
import {
  createEvidenceInTransaction,
  digest,
  isoNow,
  newId,
  replay,
  saveCommand,
  sha256Hex,
} from "./posting";
import * as Db from "../db/posting";
import * as Work from "../db/evidence-work";
import { databaseFailure, withTransaction, type Transaction } from "../db/transaction";
import { exactKeys } from "./commerce/support";

type Scope = typeof Accounting.Scope.Type;

type Principal = VerifiedPrincipal;

type JsonObject = Schema.JsonObject;

type CsvMapping = typeof Intake.CsvMapping.Type;

type ReparseInput = typeof Intake.ReparseSourceCsv.Type;

type ApprovePreview = typeof Intake.ApproveSourcePreview.Type;

type AdmitPreview = typeof Intake.AdmitSourcePreview.Type;

type ActivateRule = typeof Automation.ActivateRecurringRule.Type;

type DeactivateRule = typeof Automation.DeactivateRecurringRule.Type;

const SourceOccurrenceSchema = Intake.SourceOccurrence;

const SourceApprovalSchema = Intake.SourceApproval;

const SourceAdmissionSchema = Intake.SourceAdmission;

const SourcePreviewSchema = Intake.SourcePreview;

const SourceSupersessionSchema = Intake.SourceSupersession;

const SourceReviewCaptureSchema = Intake.SourceReviewCapture;

const RevisionHistorySchema = Intake.SourceRevisionHistory;

const PreviewViewSchema = Intake.SourcePreviewView;

const InventorySchema = Intake.SourceInventory;

const PurchaseLinksSchema = Intake.SourcePurchaseLinks;

const ReviewArtifactSchema = Intake.SourceReviewArtifact;

const ReviewArtifactListSchema = Intake.SourceReviewArtifactList;

const ReviewSnapshotSchema = Intake.SourceReviewSnapshot;

const RuleDeactivationSchema = Automation.RuleDeactivation;

const FeedEventsSchema = Deadlines.FeedEvents;

const CheckpointSchema = Bank.Checkpoint;

const privateArtifactFields = [
  "occurrence",
  "original",
  "preview",
  "stateAtCapture",
  "supersessions",
] as const;

const intakeTables = [
  "intake_occurrences",
  "intake_previews",
  "intake_approvals",
  "intake_admissions",
  "intake_preview_supersessions",
  "command_receipts",
];

const reviewTables = [...intakeTables, "intake_contents", "source_review_artifacts"];

const purchaseTables = [
  "intake_occurrences",
  "supplier_invoice_drafts",
  "supplier_invoice_draft_revisions",
  "expense_tax_sources",
  "expense_tax_source_revisions",
  "expense_tax_reviews",
  "expense_tax_source_withdrawals",
  "evidence",
];

const recurringTables = ["recurring_activations", "recurring_deactivations", "command_receipts"];

const bookVersionColumns = ["books.profile_version", "books.writer_epoch"];

function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

function decodeField<A>(schema: Schema.Decoder<A>, value: unknown) {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function toJsonObject(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function requireRecurringAccess(transaction: Transaction, inserts: ReadonlyArray<string>) {
  return Work.readRecurringAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== Work.recurringTablesForActivation.length) return unsupported();

      const denied = rows.some((row) => {
        const write = inserts.includes(row.tableName);

        return !row.canSelect || (write && !row.canInsert);
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function unsupported() {
  return failure("UnsupportedProfile");
}

function isJsonObject(value: Schema.Json): value is Schema.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: Schema.Json, key: string) {
  return isJsonObject(value) ? (value[key] ?? null) : null;
}

function textField(value: Schema.Json, key: string) {
  const found = field(value, key);

  return typeof found === "string" ? found : null;
}

function withoutFields(value: JsonObject, keys: ReadonlyArray<string>) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  ) satisfies JsonObject;
}

function canonicalJson(value: JsonObject) {
  return Effect.gen(function* () {
    const canonical = yield* Effect.sync(() => canonicalizeJson(value));

    if (Result.isFailure(canonical)) return yield* failure("InternalError");

    return canonical.success;
  });
}

function withBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  lockMode: AuthorityLockMode,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function requireTables(
  transaction: Transaction,
  selects: ReadonlyArray<string>,
  inserts: ReadonlyArray<string> = [],
) {
  return Work.readWorkTableAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      const denied = [...selects, ...inserts].some((name) => {
        const access = rows.find((row) => row.tableName === name);

        return (
          access === undefined || !access.canSelect || (inserts.includes(name) && !access.canInsert)
        );
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function requireColumns(transaction: Transaction, names: ReadonlyArray<string>) {
  return Work.readWorkColumnAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      const denied = names.some((name) => {
        const access = rows.find((row) => row.columnName === name);

        return access === undefined || !access.canSelect;
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function previewIsCurrent(transaction: Transaction, bookId: string, preview: Work.PreviewRow) {
  return Effect.gen(function* () {
    if ((yield* Work.readSupersedingPreviewId(transaction, bookId, preview.id)).length)
      return false;
    const accountId = textField(field(preview.body, "mapping"), "accountId");

    if (accountId === null) return yield* failure("InvalidJournal");
    yield* requireTables(transaction, ["bank_sources", "accounts"]);
    yield* requireColumns(transaction, bookVersionColumns);
    const occurrence = (yield* Work.readOccurrence(transaction, bookId, preview.occurrenceId))[0];

    if (!occurrence) return yield* failure("NotFound");
    const versions = (yield* Work.readDependencyVersions(transaction, bookId, accountId))[0];

    if (!versions) return yield* failure("NotFound");
    const recorded = field(preview.body, "dependencies");

    const versionsMatch =
      textField(recorded, "profileVersion") === versions.profileVersion &&
      textField(recorded, "writerEpoch") === versions.writerEpoch &&
      textField(recorded, "accountVersion") === versions.accountVersion &&
      textField(recorded, "sourceRevision") === versions.sourceRevision;

    const conflicts = yield* Work.readConflictingSourceMappings(
      transaction,
      bookId,
      accountId,
      occurrence.sourceAccountId,
    );

    return versionsMatch && conflicts.length === 0;
  });
}

function admissionSummary(row: Work.AdmissionRow) {
  return Effect.gen(function* () {
    const checkpoint = yield* decodeField(CheckpointSchema, row.checkpoint);

    return {
      previewId: row.previewId,
      digest: row.digest,
      admittedAt: row.admittedAt,
      admittedBy: row.admittedBy,
      statementId: row.statementId,
      evidenceId: row.evidenceId,
      checkpoint,
    } satisfies typeof Intake.SourceReviewAdmissionSummary.Type;
  });
}

function readAdmission(transaction: Transaction, bookId: string, occurrenceId: string) {
  return Work.readAdmission(transaction, bookId, occurrenceId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      return row ? decode(SourceAdmissionSchema, row.body) : Effect.succeed(null);
    }),
  );
}

function purchaseSourceReference(content: string) {
  const parsed = Result.try({ try: () => JSON.parse(content), catch: () => undefined });

  if (Result.isFailure(parsed)) return null;
  const entry = Schema.decodeUnknownResult(Schema.JsonObject)(parsed.success);

  if (Result.isFailure(entry)) return null;
  const kind = entry.success.kind;

  if (kind !== "expense_entry_v1" && kind !== "supplier_invoice_source_v1") return null;
  const source = field(entry.success, "source");

  if (!isJsonObject(source)) return null;
  const occurrenceId = textField(source, "occurrenceId");
  const sha256 = textField(source, "sha256");

  return occurrenceId === null || sha256 === null ? null : { occurrenceId, sha256 };
}

function referencesOccurrence(content: string, occurrenceId: string, sha256: string) {
  const reference = purchaseSourceReference(content);

  return (
    reference !== null && reference.occurrenceId === occurrenceId && reference.sha256 === sha256
  );
}

function artifactSummary(row: Work.ReviewArtifactRow) {
  return {
    ...withoutFields(row.body, privateArtifactFields),
    sha256: row.sha256,
    byteLength: row.byteLength,
    mediaType: "application/json",
    receipt: row.receipt,
  } satisfies JsonObject;
}

export const recoverSourceRetention = Effect.fn("evidenceWork.recoverSourceRetention")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTables(transaction, ["command_receipts"]);

      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(command.key)) return yield* failure("InvalidJournal");

      const row = (yield* Work.readRetentionReceipt(
        transaction,
        command.scope.bookId,
        command.key,
        principal.actorId,
      ))[0];

      if (!row) return yield* failure("NotFound");

      return yield* decode(SourceOccurrenceSchema, row.result);
    }),
  );
});

export const listSourceOccurrences = Effect.fn("evidenceWork.listSourceOccurrences")(function* (
  token: string,
  command: { scope: Scope; cursor?: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* requireTables(transaction, intakeTables);

      const rows = yield* Work.readOccurrenceInventory(
        transaction,
        command.scope.bookId,
        command.cursor ?? null,
      );

      const page = rows.slice(0, 20);

      const items = yield* Effect.forEach(page, (row) =>
        Effect.gen(function* () {
          const occurrence = yield* decode(SourceOccurrenceSchema, row.body);

          const admission =
            row.admissionBody === null
              ? null
              : yield* decode(SourceAdmissionSchema, row.admissionBody);

          return {
            occurrence,
            latestPreviewId: row.latestPreviewId,
            admission,
          } satisfies typeof Intake.OccurrenceSummary.Type;
        }),
      );

      return {
        items,
        nextCursor: rows.length > page.length ? (page.at(-1)?.id ?? null) : null,
      } satisfies typeof InventorySchema.Type;
    }),
  );
});

export const getSourceRevisionHistory = Effect.fn("evidenceWork.getRevisionHistory")(function* (
  token: string,
  command: { scope: Scope; occurrenceId: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTables(transaction, intakeTables);

      const occurrence = (yield* Work.readOccurrence(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      ))[0];

      if (!occurrence) return yield* failure("NotFound");

      const revisions = yield* Work.readRevisionHistory(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      );

      const supersessions = yield* Work.readOccurrenceSupersessions(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
      );

      const approvals = yield* Work.readOwnRevisionApprovals(
        transaction,
        command.scope.bookId,
        command.occurrenceId,
        principal.actorId,
      );

      const history = {
        occurrenceId: command.occurrenceId,
        previews: revisions.map((row) => ({
          previewId: row.previewId,
          digest: row.digest,
          ordinal: row.ordinal,
          ready: row.ready,
          createdAt: row.createdAt,
          createdBy: row.createdBy,
          diagnosticCount: row.diagnosticCount,
          supersededByPreviewId: row.supersededByPreviewId,
        })),
        supersessions: yield* Effect.forEach(supersessions, (row) =>
          decode(SourceSupersessionSchema, row.body),
        ),
        ownApprovals: yield* Effect.forEach(
          [...approvals].sort((left, right) => left.ordinal - right.ordinal),
          (row) => decode(SourceApprovalSchema, row.body),
        ),
        admission: yield* readAdmission(transaction, command.scope.bookId, command.occurrenceId),
      } satisfies typeof RevisionHistorySchema.Type;

      return yield* decode(RevisionHistorySchema, history);
    }),
  );
});

export const getSourcePreview = Effect.fn("evidenceWork.getPreview")(function* (
  token: string,
  command: { scope: Scope; previewId: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTables(transaction, intakeTables);

      const preview = (yield* Work.readPreview(
        transaction,
        command.scope.bookId,
        command.previewId,
      ))[0];

      if (!preview) return yield* failure("NotFound");

      const replacement =
        (yield* Work.readSupersedingPreviewId(
          transaction,
          command.scope.bookId,
          command.previewId,
        ))[0]?.replacementPreviewId ?? null;

      const approvalRow =
        replacement === null
          ? (yield* Work.readCurrentOwnApproval(
              transaction,
              command.scope.bookId,
              command.previewId,
              principal.actorId,
            ))[0]
          : undefined;

      const current =
        replacement === null
          ? yield* previewIsCurrent(transaction, command.scope.bookId, preview)
          : false;

      return yield* decode(PreviewViewSchema, {
        preview: yield* decode(SourcePreviewSchema, preview.body),
        approval: approvalRow ? yield* decode(SourceApprovalSchema, approvalRow.body) : null,
        admission: yield* readAdmission(transaction, command.scope.bookId, preview.occurrenceId),
        supersededByPreviewId: replacement,
        dependenciesCurrent: current,
      });
    }),
  );
});

export const getSourceReviewArtifact = Effect.fn("evidenceWork.getReviewArtifact")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* requireTables(transaction, ["source_review_artifacts"]);

      const row = (yield* Work.readReviewArtifact(
        transaction,
        command.scope.bookId,
        command.id,
      ))[0];

      if (!row) return yield* failure("NotFound");

      return yield* decode(ReviewArtifactSchema, {
        capture: artifactSummary(row),
        snapshot: yield* decode(ReviewSnapshotSchema, row.body),
        content: row.content,
      });
    }),
  );
});

export const listSourceReviewArtifacts = Effect.fn("evidenceWork.listReviewArtifacts")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* requireTables(transaction, ["source_review_artifacts"]);
      const rows = yield* Work.listReviewArtifacts(transaction, command.scope.bookId);

      const items = yield* Effect.forEach(rows, (row) =>
        decode(SourceReviewCaptureSchema, artifactSummary(row)),
      );

      return yield* decode(ReviewArtifactListSchema, { scope: command.scope, items });
    }),
  );
});

export const captureSourceReview = Effect.fn("evidenceWork.captureReview")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    previewId: string;
    input: typeof Intake.CaptureSourceReview.Type;
  },
) {
  return yield* withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTables(transaction, reviewTables, [
        "source_review_artifacts",
        "command_receipts",
      ]);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "capture_source_review",
        principal.actorId,
        { previewId: command.previewId, input: command.input },
        SourceReviewCaptureSchema,
      );

      if (request.previous) return request.previous;

      const preview = (yield* Work.readPreview(
        transaction,
        command.scope.bookId,
        command.previewId,
      ))[0];

      if (!preview) return yield* failure("NotFound");
      const previewDigest = textField(preview.body, "digest");

      if (previewDigest === null || previewDigest !== command.input.digest) {
        return yield* failure("StaleDependency");
      }

      const occurrence = (yield* Work.readOccurrence(
        transaction,
        command.scope.bookId,
        preview.occurrenceId,
      ))[0];

      if (!occurrence) return yield* failure("MissingEvidence");

      const original = (yield* Work.readContentManifest(
        transaction,
        command.scope.bookId,
        occurrence.sha256,
      ))[0];

      if (!original) return yield* failure("MissingEvidence");
      const sealedDigest = yield* digest(withoutFields(preview.body, ["digest", "receipt"]));

      if (
        textField(preview.body, "sourceSha256") !== original.sha256 ||
        textField(occurrence.body, "sha256") !== original.sha256 ||
        textField(occurrence.body, "byteLength") !== original.byteLength.toString() ||
        sealedDigest !== previewDigest
      ) {
        return yield* failure("MissingEvidence");
      }

      const artifacts = (yield* Work.countReviewArtifacts(transaction, command.scope.bookId))[0]
        ?.total;

      const reviewed = (yield* Work.countPreviewApprovals(
        transaction,
        command.scope.bookId,
        preview.id,
      ))[0]?.total;

      const interpreted = (yield* Work.countPreviews(
        transaction,
        command.scope.bookId,
        preview.occurrenceId,
      ))[0]?.total;

      const replaced = (yield* Work.countOccurrenceSupersessions(
        transaction,
        command.scope.bookId,
        preview.occurrenceId,
      ))[0]?.total;

      if (
        artifacts === undefined ||
        reviewed === undefined ||
        interpreted === undefined ||
        replaced === undefined ||
        artifacts >= 200 ||
        reviewed > 200 ||
        interpreted > 50 ||
        replaced > 49
      ) {
        return yield* unsupported();
      }

      const replacement =
        (yield* Work.readSupersedingPreviewId(
          transaction,
          command.scope.bookId,
          command.previewId,
        ))[0]?.replacementPreviewId ?? null;

      const approvals = yield* Work.readPreviewApprovalSummaries(
        transaction,
        command.scope.bookId,
        preview.id,
      );

      const supersessions = yield* Work.readOccurrenceSupersessions(
        transaction,
        command.scope.bookId,
        preview.occurrenceId,
      );

      const admittedRow = (yield* Work.readAdmission(
        transaction,
        command.scope.bookId,
        preview.occurrenceId,
      ))[0];

      const admitted = admittedRow ? yield* admissionSummary(admittedRow) : null;
      const current = yield* previewIsCurrent(transaction, command.scope.bookId, preview);
      const artifactId = newId("source_review");
      const capturedAt = yield* isoNow(transaction);

      const body = {
        id: artifactId,
        kind: "source_review_artifact_v1",
        scope: command.scope,
        previewId: preview.id,
        previewDigest,
        occurrenceId: occurrence.id,
        sourceSha256: original.sha256,
        capturedBy: principal.actorId,
        capturedAt,
        coverage: "not_established",
        postingAuthority: false,
        approvalAuthority: false,
        occurrence: occurrence.body,
        original: {
          bookId: command.scope.bookId,
          sha256: original.sha256,
          byteLength: original.byteLength,
          mediaType: textField(occurrence.body, "mediaType"),
          availability: "not_checked",
        },
        preview: preview.body,
        supersessions: supersessions.map((row) => row.body),
        stateAtCapture: {
          dependenciesCurrent: replacement === null && current,
          supersededByPreviewId: replacement,
          reviews: approvals.map((row) => ({
            actorId: row.actorId,
            rationale: row.rationale,
            expiresAt: row.expiresAt,
            expiredAtCapture: row.expiredAtCapture,
          })),
          admission: admitted,
          selectedPreviewAdmitted: admitted !== null && admitted.previewId === preview.id,
        },
      } satisfies JsonObject;

      const canonical = yield* canonicalJson(body);
      const byteLength = canonical.bytes.byteLength;

      if (byteLength > 4194304) return yield* unsupported();
      const sha256 = yield* sha256Hex(canonical.json);

      const receipt = {
        key: command.idempotencyKey,
        operation: "capture_source_review",
        actorId: principal.actorId,
      } satisfies JsonObject;

      yield* Work.insertReviewArtifact(transaction, {
        bookId: command.scope.bookId,
        id: artifactId,
        occurrenceId: occurrence.id,
        previewId: preview.id,
        body,
        content: canonical.json,
        sha256,
        byteLength,
        receipt,
      });

      const summaryValue = {
        ...withoutFields(body, privateArtifactFields),
        sha256,
        byteLength,
        mediaType: "application/json",
        receipt,
      } satisfies JsonObject;

      const result = yield* decode(SourceReviewCaptureSchema, summaryValue);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "capture_source_review",
        principal.actorId,
        summaryValue,
      );

      return result;
    }),
  );
});

export const approveSourcePreview = Effect.fn("evidenceWork.approvePreview")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    previewId: string;
    input: ApprovePreview;
  },
) {
  return yield* withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTables(transaction, intakeTables, ["intake_approvals", "command_receipts"]);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "approve_source_preview",
        principal.actorId,
        { previewId: command.previewId, input: command.input },
        SourceApprovalSchema,
      );

      if (request.previous) return request.previous;

      const preview = (yield* Work.readPreview(
        transaction,
        command.scope.bookId,
        command.previewId,
      ))[0];

      if (!preview) return yield* failure("NotFound");
      const digest = textField(preview.body, "digest");

      if (digest === null || command.input.digest !== digest || command.input.version !== 1) {
        return yield* failure("ApprovalRequired");
      }

      if (preview.body.ready !== true) return yield* failure("InvalidJournal");

      if (!(yield* previewIsCurrent(transaction, command.scope.bookId, preview))) {
        return yield* failure("StaleDependency");
      }

      const admitted = yield* Work.readAdmission(
        transaction,
        command.scope.bookId,
        preview.occurrenceId,
      );

      if (admitted.length > 0) return yield* failure("IdempotencyConflict");
      const now = yield* Db.readDatabaseTime(transaction);
      const approvalId = newId("intakeapproval");
      const expiresAt = new Date(Date.parse(now.now) + 60 * 60 * 1000).toISOString();

      const body = {
        ...command.input,
        id: approvalId,
        previewId: command.previewId,
        actorId: principal.actorId,
        expiresAt,
        receipt: {
          key: command.idempotencyKey,
          operation: "approve_source_preview",
          actorId: principal.actorId,
        },
      } satisfies JsonObject;

      yield* Work.insertApproval(transaction, {
        bookId: command.scope.bookId,
        id: approvalId,
        previewId: command.previewId,
        actorId: principal.actorId,
        expiresAt,
        body,
      });
      const result = yield* decode(SourceApprovalSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "approve_source_preview",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

const PreviewSchema = Intake.SourcePreview;

const ReparseSchema = Intake.SourceReparse;

const SupersessionSchema = Intake.SourceSupersession;

const AdmissionSchema = Intake.SourceAdmission;

const SelectionSchema = Automation.SimulationSelection;

const ActivationSchema = Automation.RuleActivation;

const csvByteBound = 65536;

const csvFieldByteBound = 4000;

const csvColumnBound = 32;

const csvRecordBound = 201;

const previewOrdinalBound = 50;

const statementCharacterBound = 65536;

const statementByteBound = 262144;

const maxSelectedObservations = 1000;

const previewTables = [...intakeTables, "intake_contents"];

const reparseInputKeys = ["digest", "version", "rationale", "mapping"] as const;

const mappingKeys = [
  "profile",
  "delimiter",
  "lineEnding",
  "dateColumn",
  "descriptionColumn",
  "amountColumn",
  "providerIdColumn",
  "dateFormat",
  "decimalSeparator",
  "sign",
  "accountId",
  "currency",
  "currencyScale",
  "startsOn",
  "endsOn",
  "openingMinor",
  "closingMinor",
  "completeness",
] as const;

type CsvRecord = {
  readonly recordOrdinal: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly fields: ReadonlyArray<string>;
};

type CsvFailure = {
  readonly code: string;
  readonly message: string;
  readonly recordOrdinal: number | null;
  readonly line: number | null;
  readonly byteOffset: number | null;
};

type CsvParse = {
  readonly structuralComplete: boolean;
  readonly hasBom: boolean;
  readonly records: ReadonlyArray<CsvRecord>;
  readonly failure: CsvFailure | null;
};

type ScanState = "start" | "quoted" | "closed" | "unquoted";

const lineEndingFailure = "Line endings do not match the reviewed profile.";

class CsvScanner {
  readonly #bytes: Uint8Array;
  readonly #delimiter: number;
  readonly #lineEnding: string;
  readonly #records: Array<CsvRecord> = [];
  #position: number;
  #fieldStart: number;
  #fieldEnd = 0;
  #recordStart: number;
  #line: number;
  #recordLine: number;
  #ordinal = 1;
  #state: ScanState = "start";
  #fields: Array<string> = [];
  #failure: { readonly code: string; readonly message: string } | null = null;
  #done = false;

  constructor(bytes: Uint8Array, delimiter: string, lineEnding: string, start: number) {
    this.#bytes = bytes;
    this.#delimiter = delimiter.charCodeAt(0);
    this.#lineEnding = lineEnding;
    this.#position = start;
    this.#fieldStart = start;
    this.#recordStart = start;
    this.#line = 1;
    this.#recordLine = 1;
  }

  get failed() {
    return this.#failure !== null;
  }

  get records() {
    return this.#records;
  }

  get failure(): CsvFailure | null {
    if (this.#failure === null) return null;

    return {
      ...this.#failure,
      recordOrdinal: this.#ordinal,
      line: this.#line,
      byteOffset: this.#position,
    };
  }

  scan() {
    while (this.#position <= this.#bytes.length && this.#failure === null && !this.#done) {
      const byte = this.#position === this.#bytes.length ? -1 : (this.#bytes[this.#position] ?? 0);
      const step = this.#scanByte(byte);
      this.#position += step;
    }

    return this;
  }

  #fail(code: string, message: string) {
    this.#failure = { code, message };
  }

  #isLineEnding(byte: number) {
    return byte === 10 || byte === 13;
  }

  #lineEndingStep(byte: number) {
    if (byte === 13 && this.#lineEnding === "crlf" && this.#bytes[this.#position + 1] === 10) {
      return 2;
    }

    if (byte === 13 || (byte === 10 && this.#lineEnding !== "lf")) {
      this.#fail("line_ending", lineEndingFailure);
    }

    return 1;
  }

  #scanByte(byte: number) {
    if (this.#state === "quoted") return this.#scanQuoted(byte);

    if (this.#state === "start" && byte === 34) {
      this.#state = "quoted";
      this.#fieldStart = this.#position + 1;

      return 1;
    }

    if (byte === -1 || this.#isLineEnding(byte) || byte === this.#delimiter) {
      return this.#scanSeparator(byte);
    }

    if (byte === 34 || this.#state === "closed") {
      this.#fail(
        "quote_syntax",
        "Quotes must surround the whole field; text after a closing quote is unsupported.",
      );

      return 1;
    }

    this.#state = "unquoted";

    return 1;
  }

  #scanQuoted(byte: number) {
    if (byte === -1) {
      this.#fail("unclosed_quote", "The quoted field is not closed.");

      return 1;
    }

    let step = 1;

    if (byte === 34) {
      if (this.#bytes[this.#position + 1] === 34) return 2;
      this.#fieldEnd = this.#position;
      this.#state = "closed";
    } else if (this.#isLineEnding(byte)) {
      step = this.#lineEndingStep(byte);

      if (this.#failure !== null) return step;
      this.#line += 1;
    }

    if (this.#position - this.#fieldStart > csvFieldByteBound) {
      this.#fail("field_limit", "A field exceeds 4000 source bytes.");
    }

    return step;
  }

  #scanSeparator(byte: number) {
    if (
      byte === -1 &&
      this.#position === this.#recordStart &&
      this.#fields.length === 0 &&
      this.#state === "start"
    ) {
      this.#done = true;

      return 1;
    }

    const step = this.#isLineEnding(byte) ? this.#lineEndingStep(byte) : 1;

    if (this.#failure !== null) return step;

    if (this.#state !== "closed") this.#fieldEnd = this.#position;

    if (this.#fieldEnd - this.#fieldStart > csvFieldByteBound) {
      this.#fail("field_limit", "A field exceeds 4000 source bytes.");

      return step;
    }

    if (!this.#appendField()) return step;

    if (this.#fields.length > csvColumnBound) {
      this.#fail("column_limit", "At most 32 columns are supported.");

      return step;
    }

    if (byte !== this.#delimiter) {
      if (this.#ordinal > csvRecordBound) {
        this.#fail(
          "record_limit",
          "At most 200 data records are supported. No partial import is available.",
        );

        return step;
      }

      this.#records.push({
        recordOrdinal: this.#ordinal,
        lineStart: this.#recordLine,
        lineEnd: this.#line,
        byteStart: this.#recordStart,
        byteEnd: this.#position,
        fields: [...this.#fields],
      });
      this.#fields = [];
      this.#ordinal += 1;

      if (byte !== -1) this.#line += 1;
      this.#recordLine = this.#line;
      this.#recordStart = this.#position + step;
    }

    this.#state = "start";
    this.#fieldStart = this.#position + step;

    return step;
  }

  #appendField() {
    const slice = this.#bytes.subarray(
      this.#fieldStart,
      this.#fieldStart + (this.#fieldEnd - this.#fieldStart),
    );

    let value = decodeUtf8(slice);

    if (value === null) {
      this.#fail("encoding", "Only valid UTF-8 without NUL is supported.");

      return false;
    }

    if (this.#state === "closed") value = value.split('""').join('"');
    this.#fields.push(value);

    return true;
  }
}

// The only CSV byte scanner and interpretation owner for retained bank sources.
// Preview, reparse and admission all read a preview produced here, so the profile
// bounds, diagnostics and readiness have exactly one implementation.
function parseCsvRecords(bytes: Uint8Array, delimiter: string, lineEnding: string): CsvParse {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

  if (decodeUtf8(bytes) === null) {
    return {
      structuralComplete: false,
      hasBom: false,
      records: [],
      failure: {
        code: "encoding",
        message: "Only valid UTF-8 without NUL is supported. Original bytes remain retained.",
        recordOrdinal: null,
        line: null,
        byteOffset: null,
      },
    };
  }

  const scanner = new CsvScanner(bytes, delimiter, lineEnding, hasBom ? 3 : 0).scan();

  if (scanner.failed) {
    return { structuralComplete: false, hasBom, records: [], failure: scanner.failure };
  }

  return { structuralComplete: true, hasBom, records: scanner.records, failure: null };
}

function decodeUtf8(bytes: Uint8Array) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);

    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

function calendarDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(parsed)) return null;

  return new Date(parsed).toISOString().slice(0, 10) === value ? value : null;
}

function parseMinorUnits(value: string | null, separator: string, scale: number) {
  if (value === null || value.length > 48) return null;

  const pattern =
    scale === 0
      ? /^[+-]?(?:0|[1-9][0-9]*)$/
      : new RegExp(`^[+-]?(?:0|[1-9][0-9]*)(?:[${separator}][0-9]{1,${scale}})$`);

  if (!pattern.test(value)) return null;
  const negative = value.startsWith("-");
  const parts = value.replace(/^[+-]/, "").split(separator);
  const fraction = (parts[1] ?? "").padEnd(scale, "0") || "0";
  const magnitude = BigInt(parts[0] ?? "0") * 10n ** BigInt(scale) + BigInt(fraction);

  if (magnitude >= 10n ** 38n) return null;

  return negative ? -magnitude : magnitude;
}

function headerIndex(headers: ReadonlyArray<string>, name: string | null) {
  if (name === null) return null;
  const found = headers.indexOf(name);

  return found < 0 ? null : found;
}

function blockingDiagnostic(
  code: string,
  message: string,
  recordOrdinal: number | null = null,
  line: number | null = null,
  byteOffset: number | null = null,
): JsonObject {
  return { severity: "error", code, message, recordOrdinal, line, byteOffset };
}

type CsvIndices = {
  readonly date: number;
  readonly description: number;
  readonly amount: number;
  readonly provider: number | null;
};

function headerFindings(records: ReadonlyArray<CsvRecord>, input: CsvMapping) {
  const diagnostics: Array<JsonObject> = [];
  const headers = records[0]?.fields ?? [];

  if (records.length < 2) {
    diagnostics.push(blockingDiagnostic("no_records", "At least one data record is required."));
  }

  if (
    headers.some((header) => header.length < 1 || header.length > 200) ||
    new Set(headers).size !== headers.length
  ) {
    diagnostics.push(
      blockingDiagnostic(
        "header",
        "Header names must be nonempty, unique and at most 200 characters.",
        1,
        1,
        0,
      ),
    );
  }

  const date = headerIndex(headers, input.dateColumn);
  const description = headerIndex(headers, input.descriptionColumn);
  const amount = headerIndex(headers, input.amountColumn);
  const provider = headerIndex(headers, input.providerIdColumn);
  const selected = [date, description, amount, provider].filter((index) => index !== null);

  if (
    date === null ||
    description === null ||
    amount === null ||
    (input.providerIdColumn !== null && provider === null) ||
    new Set(selected).size !== selected.length
  ) {
    diagnostics.push(
      blockingDiagnostic(
        "columns",
        "Select different, exact existing header names for every mapped column.",
        1,
        1,
        0,
      ),
    );

    return { diagnostics, indices: null };
  }

  const indices: CsvIndices = { date, description, amount, provider };

  const mapped = [
    input.dateColumn,
    input.descriptionColumn,
    input.amountColumn,
    input.providerIdColumn,
  ].filter((name) => name !== null);

  for (const header of headers) {
    if (mapped.includes(header)) continue;
    diagnostics.push({
      severity: "warning",
      code: "unmapped_column",
      message: `Retained but not interpreted: ${header}`,
      recordOrdinal: 1,
      line: 1,
      byteOffset: 0,
    });
  }

  return { diagnostics, indices };
}

function recordDate(value: string, input: CsvMapping) {
  if (input.dateFormat !== "DD/MM/YYYY") return value;
  const european = /^([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/.exec(value);

  return european === null ? null : `${european[3]}-${european[2]}-${european[1]}`;
}

function recordFindings(
  record: CsvRecord,
  headers: ReadonlyArray<string>,
  input: CsvMapping,
  indices: CsvIndices,
  existing: ReadonlySet<string>,
) {
  const diagnostics: Array<JsonObject> = [];

  if (record.fields.length !== headers.length || record.fields.join("") === "") {
    return {
      diagnostics: [
        blockingDiagnostic(
          "row_width",
          "Blank records and records with a different column count are unsupported.",
          record.recordOrdinal,
          record.lineStart,
          record.byteStart,
        ),
      ],
      row: null,
    };
  }

  const normalized = recordDate(record.fields[indices.date] ?? "", input);
  const date = normalized !== null && calendarDate(normalized) !== null ? normalized : null;

  if (date === null || date < input.startsOn || date > input.endsOn) {
    diagnostics.push(
      blockingDiagnostic(
        "date",
        "Use a valid date in the selected format and declared interval.",
        record.recordOrdinal,
        record.lineStart,
        record.byteStart,
      ),
    );
  }

  const description = record.fields[indices.description] ?? "";

  if (description.length < 1 || description.length > 2000) {
    diagnostics.push(
      blockingDiagnostic(
        "description",
        "Description must contain 1-2000 characters.",
        record.recordOrdinal,
        record.lineStart,
        record.byteStart,
      ),
    );
  }

  const parsed = parseMinorUnits(
    record.fields[indices.amount] ?? null,
    input.decimalSeparator,
    input.currencyScale,
  );

  if (parsed === null) {
    diagnostics.push(
      blockingDiagnostic(
        "amount",
        "Unsupported amount, fractional precision or 38-digit minor-unit bound. Grouping and spaces are not supported.",
        record.recordOrdinal,
        record.lineStart,
        record.byteStart,
      ),
    );
  }

  const amount = input.sign === "outflow_positive" && parsed !== null ? -parsed : parsed;
  const providerId = indices.provider === null ? null : (record.fields[indices.provider] ?? null);

  const taken =
    indices.provider !== null &&
    (providerId === null ||
      providerId.length < 1 ||
      providerId.length > 200 ||
      existing.has(providerId));

  if (taken) {
    diagnostics.push(
      blockingDiagnostic(
        "provider_identity",
        "Provider ID is empty, too long or already represented. No row was discarded.",
        record.recordOrdinal,
        record.lineStart,
        record.byteStart,
      ),
    );
  }

  if (diagnostics.length > 0 || amount === null || date === null) return { diagnostics, row: null };

  return {
    diagnostics,
    row: {
      rowOrdinal: record.recordOrdinal - 1,
      providerId,
      date,
      description,
      amountMinor: amount.toString(),
    },
    amount,
  };
}

function interpretCsv(
  transaction: Transaction,
  scope: Scope,
  occurrence: Work.OccurrenceRow,
  input: CsvMapping,
  parse: CsvParse,
) {
  return Effect.gen(function* () {
    const diagnostics: Array<JsonObject> = parse.failure
      ? [blockingDiagnostic(parse.failure.code, parse.failure.message)]
      : [];

    const rows: Array<JsonObject> = [];
    let total = 0n;

    if (parse.records.length === 0) {
      if (parse.structuralComplete) {
        diagnostics.push(
          blockingDiagnostic("empty_file", "A header and at least one data record are required."),
        );
      }
    } else {
      const headers = parse.records[0]?.fields ?? [];
      const found = headerFindings(parse.records, input);
      diagnostics.push(...found.diagnostics);

      if (found.indices !== null) {
        const existing = new Set(
          (yield* Work.readRetainedProviderIds(
            transaction,
            scope.bookId,
            occurrence.sourceAccountId,
            parse.records.flatMap((record) => record.fields),
          )).map((row) => row.providerId),
        );

        for (const record of parse.records) {
          if (record.recordOrdinal <= 1) continue;
          const findings = recordFindings(record, headers, input, found.indices, existing);
          diagnostics.push(...findings.diagnostics);

          if (findings.row === null) continue;
          const providerId = textField(findings.row, "providerId");

          if (providerId !== null) existing.add(providerId);
          rows.push(findings.row);
          total += BigInt(textField(findings.row, "amountMinor") ?? "0");
        }
      }
    }

    const statement = yield* buildStatement(
      transaction,
      scope,
      occurrence,
      input,
      rows,
      total,
      diagnostics,
    );

    return yield* toJsonObject({
      structuralComplete: parse.structuralComplete,
      hasBom: parse.hasBom,
      records: parse.records,
      rows,
      diagnostics,
      ready: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
      movementMinor: total.toString(),
      statement: diagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? null
        : statement.statement,
    });
  });
}

function buildStatement(
  transaction: Transaction,
  scope: Scope,
  occurrence: Work.OccurrenceRow,
  input: CsvMapping,
  rows: ReadonlyArray<JsonObject>,
  total: bigint,
  diagnostics: Array<JsonObject>,
) {
  return Effect.gen(function* () {
    const candidates = rows
      .map((row) => textField(row, "providerId"))
      .filter((value): value is string => value !== null);

    const context = (yield* Work.readInterpretationContext(
      transaction,
      scope.bookId,
      input.accountId,
      input.currency,
      input.currencyScale,
      occurrence.sourceAccountId,
      input.startsOn,
      input.endsOn,
      candidates,
    ))[0];

    const gates: ReadonlyArray<readonly [boolean, string, string]> = [
      [
        context === undefined || !context.accountReady,
        "account_currency",
        "Select an active account and explicitly confirm the book currency and scale.",
      ],
      [
        context === undefined || !context.profileReady,
        "admission_profile",
        "Current bank admission supports only native synthetic-core-v1 books. Retention and diagnostics do not activate a real company.",
      ],
      [
        context?.overlapping === true,
        "overlap",
        "An existing statement overlaps the declared interval. Explicit overlap reconciliation is not supported.",
      ],
      [
        context?.conflicting === true,
        "source_mapping",
        "The source account conflicts with an existing bank mapping.",
      ],
      [
        BigInt(input.openingMinor) + total !== BigInt(input.closingMinor),
        "controls",
        "Declared opening plus all valid movements does not equal declared closing. Invalid records also block admission.",
      ],
    ];

    for (const [blocked, code, message] of gates) {
      if (blocked) diagnostics.push(blockingDiagnostic(code, message));
    }

    const statement = yield* toJsonObject({
      kind: "synthetic_bank_statement_v1",
      statementIdentifier: occurrence.id,
      sourceBankAccountId: occurrence.sourceAccountId,
      accountId: input.accountId,
      currency: input.currency,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      openingMinor: input.openingMinor,
      closingMinor: input.closingMinor,
      completeness: input.completeness,
      rows,
    });

    const sealed = yield* canonicalJson(statement);

    if (
      sealed.json.length > statementCharacterBound ||
      sealed.bytes.byteLength > statementByteBound
    ) {
      diagnostics.push(
        blockingDiagnostic(
          "normalized_limit",
          "Normalized evidence exceeds the current evidence authority limit. No partial admission is available.",
        ),
      );
    }

    return { statement };
  });
}

function interpretPreview(
  transaction: Transaction,
  principal: Principal,
  scope: Scope,
  occurrenceId: string,
  input: CsvMapping,
  idempotencyKey: string,
) {
  return Effect.gen(function* () {
    const request = yield* replay(
      transaction,
      scope,
      idempotencyKey,
      "preview_source_csv",
      principal.actorId,
      yield* toJsonObject({ occurrenceId, mapping: input }),
      PreviewSchema,
    );

    if (request.previous) return request.previous;
    yield* requireTables(transaction, previewTables, ["intake_previews", "command_receipts"]);
    const occurrence = (yield* Work.readOccurrence(transaction, scope.bookId, occurrenceId))[0];

    if (!occurrence) return yield* failure("NotFound");
    const byteLength = Number(textField(occurrence.body, "byteLength"));

    if (textField(occurrence.body, "mediaType") !== "text/csv" || byteLength > csvByteBound) {
      return yield* unsupported();
    }

    if ((yield* Work.readAdmission(transaction, scope.bookId, occurrenceId)).length > 0) {
      return yield* failure("IdempotencyConflict");
    }

    const ordinal = (yield* Work.readNextPreviewOrdinal(transaction, scope.bookId, occurrenceId))[0]
      ?.ordinal;

    if (ordinal === undefined) return yield* failure("InternalError");

    if (ordinal > previewOrdinalBound) return yield* failure("InvalidJournal");

    const content = (yield* Work.readInlineContent(
      transaction,
      scope.bookId,
      occurrence.sha256,
    ))[0];

    if (!content || content.bytes === null) return yield* unsupported();
    const mapping = yield* toJsonObject(input);
    yield* requireMapping(mapping, input);

    const versions = (yield* Work.readDependencyVersions(
      transaction,
      scope.bookId,
      input.accountId,
    ))[0];

    if (!versions) return yield* failure("NotFound");
    const parse = parseCsvRecords(content.bytes, input.delimiter, input.lineEnding);
    const interpretation = yield* interpretCsv(transaction, scope, occurrence, input, parse);
    const id = newId("preview");

    const body = yield* toJsonObject({
      ...interpretation,
      id,
      occurrenceId,
      scope,
      version: 1,
      sourceSha256: occurrence.sha256,
      mapping,
      dependencies: versions,
      createdBy: principal.actorId,
      createdAt: yield* isoNow(transaction),
    });

    const sealed = yield* toJsonObject({
      ...body,
      digest: yield* digest(withoutFields(body, ["digest", "receipt"])),
      receipt: { key: idempotencyKey, operation: "preview_source_csv", actorId: principal.actorId },
    });

    yield* Work.insertPreview(transaction, {
      bookId: scope.bookId,
      id,
      occurrenceId,
      ordinal,
      body: sealed,
    });
    const result = yield* decode(PreviewSchema, sealed);
    yield* saveCommand(
      transaction,
      scope,
      idempotencyKey,
      request.expected,
      "preview_source_csv",
      principal.actorId,
      result,
    );

    return result;
  });
}

function requireMapping(mapping: JsonObject, input: CsvMapping) {
  const declared = Object.keys(mapping).sort();
  const expected = [...mappingKeys].sort();

  if (
    declared.length !== expected.length ||
    declared.some((key, index) => key !== expected[index])
  ) {
    return failure("InvalidJournal");
  }

  if (input.startsOn > input.endsOn) return failure("InvalidJournal");

  return Effect.void;
}

export const previewSourceCsv = Effect.fn("evidenceWork.previewCsv")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; occurrenceId: string; input: CsvMapping },
) {
  return yield* withBook(token, command.scope, false, "update", (transaction, principal) =>
    interpretPreview(
      transaction,
      principal,
      command.scope,
      command.occurrenceId,
      command.input,
      command.idempotencyKey,
    ),
  );
});

export const reparseSourceCsv = Effect.fn("evidenceWork.reparseCsv")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; previewId: string; input: ReparseInput },
) {
  return yield* withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "reparse_source_csv",
        principal.actorId,
        yield* toJsonObject({ previewId: command.previewId, input: command.input }),
        ReparseSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTables(transaction, previewTables, [
        "intake_previews",
        "intake_preview_supersessions",
        "command_receipts",
      ]);
      yield* exactKeys(yield* toJsonObject(command.input), reparseInputKeys);

      const preview = (yield* Work.readPreview(
        transaction,
        command.scope.bookId,
        command.previewId,
        "update",
      ))[0];

      if (!preview) return yield* failure("NotFound");

      if (command.input.digest !== textField(preview.body, "digest")) {
        return yield* failure("StaleDependency");
      }

      if (
        (yield* Work.readAdmission(transaction, command.scope.bookId, preview.occurrenceId))
          .length > 0
      ) {
        return yield* failure("IdempotencyConflict");
      }

      if (
        (yield* Work.readSupersedingPreviewId(transaction, command.scope.bookId, command.previewId))
          .length > 0
      ) {
        return yield* failure("StaleDependency");
      }

      const replacement = yield* interpretPreview(
        transaction,
        principal,
        command.scope,
        preview.occurrenceId,
        command.input.mapping,
        newId("intakereparse"),
      );

      const supersession = yield* decode(
        SupersessionSchema,
        yield* toJsonObject({
          occurrenceId: preview.occurrenceId,
          previousPreviewId: preview.id,
          previousDigest: textField(preview.body, "digest"),
          replacementPreviewId: replacement.id,
          replacementDigest: replacement.digest,
          rationale: command.input.rationale,
          actorId: principal.actorId,
          createdAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "reparse_source_csv",
            actorId: principal.actorId,
          },
        }),
      );

      yield* Work.insertSupersession(transaction, {
        bookId: command.scope.bookId,
        previousPreviewId: preview.id,
        replacementPreviewId: replacement.id,
        body: yield* toJsonObject(supersession),
      });
      const result = yield* decode(ReparseSchema, { preview: replacement, supersession });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "reparse_source_csv",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

export const admitSourcePreview = Effect.fn("evidenceWork.admitPreview")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; previewId: string; input: AdmitPreview },
) {
  return yield* withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "admit_source_preview",
        principal.actorId,
        yield* toJsonObject({ previewId: command.previewId, input: command.input }),
        AdmissionSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTables(transaction, previewTables, [
        "intake_admissions",
        "command_receipts",
        "evidence",
      ]);

      const preview = (yield* Work.readPreview(
        transaction,
        command.scope.bookId,
        command.previewId,
        "update",
      ))[0];

      if (!preview) return yield* failure("NotFound");
      const digestValue = textField(preview.body, "digest");

      if (command.input.digest !== digestValue || command.input.version !== 1) {
        return yield* failure("ApprovalRequired");
      }

      const existing = (yield* Work.readAdmission(
        transaction,
        command.scope.bookId,
        preview.occurrenceId,
      ))[0];

      if (existing) {
        if (
          existing.previewId !== command.previewId ||
          existing.body.approvalId !== command.input.approvalId
        ) {
          return yield* failure("IdempotencyConflict");
        }

        const admitted = yield* decode(AdmissionSchema, existing.body);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "admit_source_preview",
          principal.actorId,
          admitted,
        );

        return admitted;
      }

      const approval = (yield* Work.readApproval(
        transaction,
        command.scope.bookId,
        command.input.approvalId,
        command.previewId,
        principal.actorId,
      ))[0];

      if (
        !approval ||
        approval.expiredAtCapture ||
        textField(approval.body, "digest") !== digestValue
      ) {
        return yield* failure("ApprovalRequired");
      }

      const statement = field(preview.body, "statement");

      if (preview.body.ready !== true || statement === null) {
        return yield* failure("InvalidJournal");
      }

      if (!(yield* previewIsCurrent(transaction, command.scope.bookId, preview))) {
        return yield* failure("StaleDependency");
      }

      const internal = `intake_${preview.occurrenceId}`;
      const sourceSha256 = textField(preview.body, "sourceSha256");

      if (!isJsonObject(statement)) return yield* failure("InvalidJournal");
      const statementText = (yield* canonicalJson(statement)).json;

      const evidence = yield* createEvidenceInTransaction(transaction, principal, {
        scope: command.scope,
        idempotencyKey: `${internal}_evidence`,
        input: {
          title: `Reviewed bank CSV interpretation ${command.previewId}`,
          content: statementText,
          mediaType: "application/json",
          origin: `Retained source ${preview.occurrenceId}; preview ${command.previewId}; ${sourceSha256 ?? ""}`,
        },
      });

      const imported = yield* admitReviewedStatement(
        transaction,
        command.scope,
        principal.actorId,
        `${internal}_import`,
        {
          ...(yield* decode(Bank.StatementSource, statement)),
          evidenceId: evidence.id,
          existingMatches: [],
        },
      );

      const body = yield* toJsonObject({
        occurrenceId: preview.occurrenceId,
        previewId: command.previewId,
        approvalId: command.input.approvalId,
        digest: command.input.digest,
        admittedAt: yield* isoNow(transaction),
        imported,
        receipt: {
          key: command.idempotencyKey,
          operation: "admit_source_preview",
          actorId: principal.actorId,
        },
      });

      yield* Work.insertAdmission(transaction, {
        bookId: command.scope.bookId,
        occurrenceId: preview.occurrenceId,
        previewId: command.previewId,
        approvalId: command.input.approvalId,
        body,
      });
      const result = yield* decode(AdmissionSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "admit_source_preview",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

export const activateRecurringRule = Effect.fn("evidenceWork.activateRule")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: ActivateRule },
) {
  return yield* withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "activate_recurring_rule",
        principal.actorId,
        yield* toJsonObject(command.input),
        ActivationSchema,
      );

      if (request.previous) return request.previous;
      yield* requireRecurringAccess(transaction, ["recurring_activations", "command_receipts"]);

      const rule = (yield* Work.readRule(
        transaction,
        command.scope.bookId,
        command.input.ruleId,
      ))[0];

      if (!rule) return yield* failure("NotFound");

      const simulation = (yield* Work.readSimulation(
        transaction,
        command.scope.bookId,
        command.input.simulationId,
        command.input.ruleId,
      ))[0];

      if (!simulation) return yield* failure("NotFound");

      if (
        textField(rule.body, "digest") !== command.input.ruleDigest ||
        textField(simulation.body, "digest") !== command.input.simulationDigest
      ) {
        return yield* failure("StaleDependency");
      }

      const current = (yield* Work.readCurrentSelection(
        transaction,
        command.scope.bookId,
        rule.body,
        simulation.body,
      ))[0];

      if (!current || current.stale) return yield* failure("StaleDependency");
      const selection = yield* decode(SelectionSchema, current.selection);

      if (selection.blockers.length > 0 || selection.matchingCount === 0) {
        return yield* failure("InvalidJournal");
      }

      if (selection.matchingCount > maxSelectedObservations) {
        return yield* failure("InvalidJournal");
      }

      if (
        (yield* Work.readActiveActivation(transaction, command.scope.bookId, command.input.ruleId))
          .length > 0
      ) {
        return yield* failure("InvalidJournal");
      }

      const id = newId("activation");

      const body = yield* toJsonObject({
        ...command.input,
        id,
        actorId: principal.actorId,
        activatedAt: yield* isoNow(transaction),
        authority: "prepare_only",
        receipt: {
          key: command.idempotencyKey,
          operation: "activate_recurring_rule",
          actorId: principal.actorId,
        },
      });

      yield* Work.insertActivation(transaction, {
        bookId: command.scope.bookId,
        id,
        ruleId: command.input.ruleId,
        simulationId: command.input.simulationId,
        body,
      });
      const result = yield* decode(ActivationSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "activate_recurring_rule",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

export const getSourcePurchaseLinks = Effect.fn("evidenceWork.getPurchaseLinks")(function* (
  token: string,
  command: { scope: Scope; occurrenceId: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* requireTables(transaction, purchaseTables);
      const bookId = command.scope.bookId;
      const occurrence = (yield* Work.readOccurrence(transaction, bookId, command.occurrenceId))[0];

      if (!occurrence) return yield* failure("NotFound");
      const drafts = (yield* Work.countSupplierInvoiceDrafts(transaction, bookId))[0]?.total ?? 0;
      const expenses = (yield* Work.countExpenseTaxSources(transaction, bookId))[0]?.total ?? 0;

      if (drafts > 200 || expenses > 200) return yield* unsupported();

      const linkedDrafts = yield* Work.readLinkedDraftRevisions(
        transaction,
        bookId,
        command.occurrenceId,
      );

      const draftIds = [
        ...new Set(
          linkedDrafts
            .filter((row) =>
              referencesOccurrence(row.evidenceContent, command.occurrenceId, occurrence.sha256),
            )
            .map((row) => row.draftId),
        ),
      ].sort();

      const currentDrafts = yield* Work.readDraftCurrentRevisions(
        transaction,
        bookId,
        draftIds,
        command.occurrenceId,
      );

      const linkedExpenses = yield* Work.readLinkedExpenseRevisions(
        transaction,
        bookId,
        command.occurrenceId,
      );

      const sourceIds = [
        ...new Set(
          linkedExpenses
            .filter((row) =>
              referencesOccurrence(row.evidenceContent, command.occurrenceId, occurrence.sha256),
            )
            .map((row) => row.sourceId),
        ),
      ].sort();

      const currentExpenses = yield* Work.readExpenseCurrentRevisions(
        transaction,
        bookId,
        sourceIds,
        command.occurrenceId,
      );

      return yield* decode(PurchaseLinksSchema, {
        scope: command.scope,
        occurrenceId: command.occurrenceId,
        supplierDrafts: currentDrafts.map((row) => ({
          id: row.draftId,
          title: row.title,
          revision: row.revision,
          currentSource:
            row.currentContent !== null &&
            referencesOccurrence(row.currentContent, command.occurrenceId, occurrence.sha256),
        })),
        expenses: currentExpenses.map((row) => ({
          id: row.sourceId,
          description: row.description,
          currentSource:
            row.currentContent !== null &&
            referencesOccurrence(row.currentContent, command.occurrenceId, occurrence.sha256),
          reviewCurrent: !row.withdrawn && row.reviewSourceDigest === row.digest,
          withdrawn: row.withdrawn,
        })),
      });
    }),
  );
});

export const deactivateRecurringRule = Effect.fn("evidenceWork.deactivateRule")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: DeactivateRule },
) {
  return yield* withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTables(transaction, recurringTables, [
        "recurring_deactivations",
        "command_receipts",
      ]);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "deactivate_recurring_rule",
        principal.actorId,
        command.input,
        RuleDeactivationSchema,
      );

      if (request.previous) return request.previous;

      const activation = (yield* Work.readActivation(
        transaction,
        command.scope.bookId,
        command.input.activationId,
      ))[0];

      if (!activation) return yield* failure("NotFound");

      const existing = (yield* Work.readDeactivation(
        transaction,
        command.scope.bookId,
        command.input.activationId,
      ))[0];

      const body =
        existing?.body ??
        ({
          ...command.input,
          actorId: principal.actorId,
          deactivatedAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "deactivate_recurring_rule",
            actorId: principal.actorId,
          },
        } satisfies JsonObject);

      if (!existing) {
        yield* Work.insertDeactivation(transaction, {
          bookId: command.scope.bookId,
          activationId: command.input.activationId,
          body,
        });
      }

      const result = yield* decode(RuleDeactivationSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "deactivate_recurring_rule",
        principal.actorId,
        result,
      );

      return result;
    }),
  );
});

export const readDeadlineFeedEvents = Effect.fn("evidenceWork.deadlineFeedEvents")(function* (
  secret: string,
) {
  const tokenHash = yield* sha256Hex(secret);

  return yield* withTransaction((transaction) =>
    Effect.gen(function* () {
      const feed = (yield* Work.readFeedByTokenHash(transaction, tokenHash))[0];

      if (!feed) return yield* failure("Forbidden");
      const events = yield* Work.listFeedDeadlines(transaction, feed.bookId);

      return yield* decode(FeedEventsSchema, {
        bookId: feed.bookId,
        events: events.map((row) => ({
          id: row.id,
          title: row.title,
          dueAt: row.dueAt,
          updatedAt: row.updatedAt,
          timeZone: row.timeZone,
          revision: Number(row.revision),
        })),
      });
    }).pipe(Effect.mapError(databaseFailure)),
  );
});
