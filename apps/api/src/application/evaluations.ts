import * as Evaluation from "@open-erp/contracts/evaluations";
import { Capabilities } from "@open-erp/contracts/capabilities";
import * as Effect from "effect/Effect";
import * as Db from "../db/evaluations";
import { decode, requireTableAccess, toJsonObject, withBook } from "./commerce/support";
import { failure } from "./failures";
import { digest } from "./json";
import { isoNow, replay, saveCommand } from "./command-receipts";
import { newId } from "./identifiers";
import { resolveCompanyProfileInTransaction } from "./company-profiles";
import { readSourceOccurrenceInTransaction } from "./source-retention";

export const captureEvaluationContract = Effect.fn("evaluations.captureContract")(function* (
  token: string,
  command: typeof Evaluation.EvaluationCapabilities.evaluation_capture_contract.input.Type,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireTableAccess(transaction, ["evaluation_contracts"], true);
      const input = command.input;

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "evaluation_capture_contract",
        principal.actorId,
        yield* toJsonObject(input),
        Evaluation.EvaluationContract,
      );

      if (request.previous !== undefined) return request.previous;

      if (input.allowedCapabilities.some((name) => !Object.hasOwn(Capabilities, name)))
        return yield* failure("UnsupportedProfile");

      if (
        new Set(input.originalIds).size !== input.originalIds.length ||
        new Set(input.allowedCapabilities).size !== input.allowedCapabilities.length ||
        new Set(input.permittedAssistance).size !== input.permittedAssistance.length
      )
        return yield* failure("InvalidJournal");

      if (input.predecessor !== null) {
        const previous = (yield* Db.readContract(
          transaction,
          command.scope.bookId,
          input.predecessor.id,
        ))[0];

        if (
          !previous ||
          previous.digest !== input.predecessor.digest ||
          (yield* Db.readSuccessor(transaction, command.scope.bookId, input.predecessor.id))
            .length !== 0
        )
          return yield* failure("StaleDependency");
      }

      const originals = yield* Effect.forEach(input.originalIds, (id) =>
        readSourceOccurrenceInTransaction(transaction, command.scope, id),
      );

      const profile = yield* resolveCompanyProfileInTransaction(
        transaction,
        command.scope,
        input.recordClass,
        {
          postingOn: input.interval.startsOn,
          taxPointOn: input.interval.startsOn,
          paymentOn: input.interval.startsOn,
          reportOn: input.interval.endsOn,
          taxPeriodOn: input.interval.endsOn,
        },
      );

      const createdAt = yield* isoNow(transaction);
      const id = newId("evaluation");

      const body = yield* toJsonObject({
        id,
        scope: command.scope,
        state: "contract_only",
        recordClass: input.recordClass,
        interval: input.interval,
        originals,
        profile,
        openingBasis: input.openingBasis,
        familyPopulation: input.familyPopulation,
        permittedAssistance: input.permittedAssistance,
        allowedCapabilities: input.allowedCapabilities,
        capabilityPolicy: "declared_not_enforced",
        wholeYearComplete: false,
        predecessor: input.predecessor,
        createdBy: principal.actorId,
        createdAt,
        receipt: {
          key: command.idempotencyKey,
          operation: "evaluation_capture_contract",
          actorId: principal.actorId,
        },
      });

      const hash = yield* digest(body);
      const result = yield* decode(Evaluation.EvaluationContract, { ...body, digest: hash });
      const retained = yield* toJsonObject(result);
      yield* Db.insertContract(transaction, {
        bookId: command.scope.bookId,
        id,
        predecessorId: input.predecessor?.id ?? null,
        predecessorDigest: input.predecessor?.digest ?? null,
        createdBy: principal.actorId,
        createdAt,
        digest: hash,
        body: retained,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "evaluation_capture_contract",
        principal.actorId,
        retained,
      );

      return result;
    },
    "update",
  );
});

export const getEvaluationContract = Effect.fn("evaluations.getContract")(function* (
  token: string,
  command: typeof Evaluation.EvaluationCapabilities.evaluation_get_contract.input.Type,
) {
  return yield* withBook(token, command.scope, true, function* (transaction) {
    yield* requireTableAccess(transaction, ["evaluation_contracts"], false);
    const row = (yield* Db.readContract(transaction, command.scope.bookId, command.id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Evaluation.EvaluationContract, row.body);
  });
});
