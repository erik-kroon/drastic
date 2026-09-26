import * as Dimensions from "@open-erp/contracts/dimensions";
import * as Effect from "effect/Effect";
import { failure } from "./failures";
import { lockBookForShare, lockBookForUpdate } from "../db/posting";
import * as Catalogue from "../db/dimensions";
import type { Transaction } from "../db/transaction";
import { replay, saveCommand } from "./posting";
import { decode, toJsonObject, unsupported, withBook, type Scope } from "./commerce/support";

type SaveDimensionInput = typeof Dimensions.SaveDimension.Type;

type SaveDimensionValueInput = typeof Dimensions.SaveDimensionValue.Type;

type CatalogueFields = {
  readonly code: string;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly archived: boolean;
};

const ListSchema = Dimensions.DimensionList;

const SavedSchema = Dimensions.DimensionSaved;

const ValueSavedSchema = Dimensions.DimensionValueSaved;

function requireCatalogueAccess(transaction: Transaction, write: boolean) {
  return Catalogue.readCatalogueAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      const denied = Catalogue.dimensionTables.some((name) => {
        const access = rows.find((row) => row.tableName === name);

        return (
          access === undefined ||
          !access.canSelect ||
          (write && (!access.canInsert || !access.canUpdate))
        );
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function requireValidRange(input: { effectiveFrom: string; effectiveTo: string | null }) {
  return input.effectiveTo !== null && input.effectiveTo < input.effectiveFrom
    ? failure("InvalidJournal")
    : Effect.void;
}

function entryFields(row: CatalogueFields) {
  return {
    code: row.code,
    name: row.name,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    archived: row.archived,
  };
}

function revisionFields(row: Catalogue.DimensionRevisionRow) {
  return {
    revision: row.revision,
    name: row.name,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    archived: row.archived,
  };
}

export const listDimensions = Effect.fn("dimensions.list")(function* (
  token: string,
  input: { scope: Scope },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireCatalogueAccess(transaction, false);
    yield* lockBookForShare(transaction, input.scope);
    const dimensions = yield* Catalogue.readDimensions(transaction, input.scope.bookId);
    const values = yield* Catalogue.readDimensionValues(transaction, input.scope.bookId);
    const revisions = yield* Catalogue.readDimensionRevisions(transaction, input.scope.bookId);

    const valueRevisions = yield* Catalogue.readDimensionValueRevisions(
      transaction,
      input.scope.bookId,
    );

    return yield* decode(ListSchema, {
      scope: input.scope,
      dimensions: dimensions.map((dimension) => ({
        ...entryFields(dimension),
        revision: dimension.revision,
        revisions: revisions.filter((row) => row.code === dimension.code).map(revisionFields),
        values: values
          .filter((row) => row.dimensionCode === dimension.code)
          .map((value) => ({
            ...entryFields(value),
            revision: value.revision,
            revisions: valueRevisions
              .filter((row) => row.dimensionCode === value.dimensionCode && row.code === value.code)
              .map(revisionFields),
          })),
      })),
    });
  });
});

export const saveDimension = Effect.fn("dimensions.save")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: SaveDimensionInput },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const payload = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "save_dimension",
        principal.actorId,
        payload,
        SavedSchema,
      );

      if (request.previous) return request.previous;
      yield* requireCatalogueAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = command.input;
      yield* requireValidRange(input);

      const heads = yield* Catalogue.lockDimensionRevision(transaction, command.scope.bookId, {
        code: input.code,
        dimensionCode: "",
        valueCode: "",
      });

      const current = heads[0]?.currentRevision ?? 0;

      if (current !== input.expectedRevision) return yield* failure("StaleDependency");

      const row: Catalogue.RevisionWrite = {
        bookId: command.scope.bookId,
        code: input.code,
        revision: current + 1,
        name: input.name,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        archived: input.archived,
      };

      if (current === 0) {
        yield* Catalogue.insertDimension(transaction, row);
      } else {
        yield* Catalogue.updateDimension(transaction, row);
      }

      yield* Catalogue.insertDimensionRevision(transaction, row);

      const result = yield* decode(SavedSchema, {
        scope: command.scope,
        ...entryFields(row),
        revision: row.revision,
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "save_dimension",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const saveDimensionValue = Effect.fn("dimensions.saveValue")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: SaveDimensionValueInput },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const payload = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "save_dimension_value",
        principal.actorId,
        payload,
        ValueSavedSchema,
      );

      if (request.previous) return request.previous;
      yield* requireCatalogueAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = command.input;
      yield* requireValidRange(input);

      const parents = yield* Catalogue.readDimensionHead(transaction, command.scope.bookId, {
        code: input.dimensionCode,
        dimensionCode: "",
        valueCode: "",
      });

      if (parents.length === 0) return yield* failure("NotFound");

      const heads = yield* Catalogue.lockDimensionValueRevision(transaction, command.scope.bookId, {
        code: "",
        dimensionCode: input.dimensionCode,
        valueCode: input.code,
      });

      const current = heads[0]?.currentRevision ?? 0;

      if (current !== input.expectedRevision) return yield* failure("StaleDependency");

      const row: Catalogue.ValueRevisionWrite = {
        bookId: command.scope.bookId,
        dimensionCode: input.dimensionCode,
        code: input.code,
        revision: current + 1,
        name: input.name,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        archived: input.archived,
      };

      if (current === 0) {
        yield* Catalogue.insertDimensionValue(transaction, row);
      } else {
        yield* Catalogue.updateDimensionValue(transaction, row);
      }

      yield* Catalogue.insertDimensionValueRevision(transaction, row);

      const result = yield* decode(ValueSavedSchema, {
        scope: command.scope,
        dimensionCode: row.dimensionCode,
        ...entryFields(row),
        revision: row.revision,
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "save_dimension_value",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});
