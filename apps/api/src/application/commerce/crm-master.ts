import * as Crm from "@open-erp/contracts/crm-master";
import * as Effect from "effect/Effect";
import * as CrmDb from "../../db/commerce/crm-master";
import { newId, replay, saveCommand } from "../posting";
import { lockBookForUpdate } from "../../db/posting";
import { failure } from "../failures";
import {
  decode,
  exactKeys,
  requireTableAccess,
  withBook,
  type JsonObject,
  type Scope,
} from "./support";

const DirectoryPageSchema = Crm.DirectoryPage;
const DirectoryExportSchema = Crm.DirectoryExport;
const AnnotationSchema = Crm.Annotation;
const AddAnnotationSchema = Crm.AddAnnotation;

const annotationKinds = ["contact", "alias", "registry_provenance"] as const;

function directoryEntry(row: CrmDb.PartyRow): JsonObject {
  return { party: row.revision, annotations: row.annotations };
}

function validRole(role: string) {
  return role === "" || role === "customer" || role === "supplier" || role === "both";
}

function boundedFilter(filters: { search: string; role: string; after: string }) {
  if (filters.search.length > 200 || filters.after.length > 200 || !validRole(filters.role)) {
    return failure("InvalidJournal");
  }
  return Effect.void;
}

export const readDirectory = Effect.fn("commerce.crm.readDirectory")(function* (
  token: string,
  input: { scope: Scope; filters: { search: string; role: string; after: string } },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CrmDb.crmMasterTables, false);
    yield* boundedFilter(input.filters);
    const rows = yield* CrmDb.readDirectoryPage(
      transaction,
      input.scope.bookId,
      input.filters.search,
      input.filters.role,
      input.filters.after,
      50,
    );
    const last = rows[rows.length - 1];
    return yield* decode(DirectoryPageSchema, {
      items: rows.map(directoryEntry),
      next: last?.hasMore === true ? last.id : null,
    });
  });
});

export const readDirectoryExport = Effect.fn("commerce.crm.readDirectoryExport")(function* (
  token: string,
  input: { scope: Scope; filters: { search: string; role: string; after: string } },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CrmDb.crmMasterTables, false);
    yield* boundedFilter(input.filters);
    const rows = yield* CrmDb.readDirectoryPage(
      transaction,
      input.scope.bookId,
      input.filters.search,
      input.filters.role,
      input.filters.after,
      200,
    );
    const last = rows[rows.length - 1];
    return yield* decode(DirectoryExportSchema, {
      scope: input.scope,
      items: rows.map(directoryEntry),
      next: last?.hasMore === true ? last.id : null,
    });
  });
});

export const addAnnotation = Effect.fn("commerce.crm.addAnnotation")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Crm.AddAnnotation.Type },
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
        "crm_add_annotation",
        principal.actorId,
        command.input,
        AnnotationSchema,
      );
      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, CrmDb.crmMasterTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = yield* decode(AddAnnotationSchema, command.input);
      yield* exactKeys(input, ["partyId", "kind", "label", "detail", "evidenceId"]);
      if (!annotationKinds.includes(input.kind)) return yield* failure("InvalidJournal");
      if (
        input.partyId.length > 200 ||
        input.label.length > 200 ||
        input.detail.length > 2000 ||
        input.evidenceId.length > 200
      ) {
        return yield* failure("InvalidJournal");
      }
      const evidence = yield* CrmDb.readEvidenceIdentity(
        transaction,
        command.scope.bookId,
        input.evidenceId,
      );
      if (evidence.length === 0) return yield* failure("MissingEvidence");
      const parties = yield* CrmDb.readPartyExists(
        transaction,
        command.scope.bookId,
        input.partyId,
      );
      if (parties[0]?.present !== true) return yield* failure("NotFound");
      const id = newId("crm");
      yield* CrmDb.insertAnnotation(transaction, {
        bookId: command.scope.bookId,
        partyId: input.partyId,
        id,
        kind: input.kind,
        label: input.label,
        detail: input.detail,
        evidenceId: input.evidenceId,
        recordedBy: principal.actorId,
      });
      const recorded = yield* CrmDb.readAnnotation(transaction, command.scope.bookId, id);
      const row = recorded[0];
      if (!row) return yield* failure("InternalError");
      const result = yield* decode(AnnotationSchema, {
        id: row.id,
        partyId: row.partyId,
        kind: row.kind,
        label: row.label,
        detail: row.detail,
        evidenceId: row.evidenceId,
        recordedBy: row.recordedBy,
        recordedAt: row.recordedAt,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "crm_add_annotation",
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});
