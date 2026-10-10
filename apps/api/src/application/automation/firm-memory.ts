import { MinorUnits } from "@open-erp/domain/money";
import * as Memory from "@open-erp/domain/firm-memory";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Transaction } from "../../db/transaction";
import * as Db from "../../db/decision-examples";
import { projectDecisionExample } from "./decision-examples";
import { digest } from "../json";
import { failure } from "../failures";

const Inventory = Schema.Array(
  Schema.Struct({
    owner: Schema.String,
    id: Schema.String,
    classification: Schema.NullOr(Schema.String),
    body: Schema.NullOr(Schema.JsonObject),
  }),
);

export const readFirmMemory = Effect.fn("firmMemory.read")(function* (
  transaction: Transaction,
  target: Omit<Memory.Target, "cutoff">,
) {
  const retained = (yield* Db.snapshot(transaction, target.bookId))[0];

  if (!retained) return yield* failure("NotFound");
  const snapshot = retained.body;

  const inventory = yield* Schema.decodeUnknownEffect(Inventory)(snapshot.inventory).pipe(
    Effect.mapError(() => failure("InternalError")),
  );

  const history: Memory.Precedent[] = [];
  const projectionExclusions: { id: string; reason: string }[] = [];

  for (const row of inventory) {
    if (row.owner !== "supplier_approval") continue;
    const result = yield* projectDecisionExample(row, snapshot);

    if (result.example?.precedent) history.push(result.example.precedent);
    else
      projectionExclusions.push({
        id: row.id,
        reason: result.excluded ?? "missing_committed_precedent",
      });
  }

  const historyDigest = yield* digest({
    algorithmVersion: "firm_memory_v1",
    inventory,
    vouchers: snapshot.vouchers ?? null,
  });

  const cutoff = yield* Schema.decodeUnknownEffect(MinorUnits)(snapshot.cutoff).pipe(
    Effect.mapError(() => failure("InternalError")),
  );

  const ranked = Memory.rank({ ...target, cutoff }, history);

  return {
    ...ranked,
    historyDigest,
    exclusions: [...ranked.exclusions, ...projectionExclusions].sort((left, right) =>
      left.id < right.id ? -1 : Number(left.id > right.id),
    ),
  };
});
