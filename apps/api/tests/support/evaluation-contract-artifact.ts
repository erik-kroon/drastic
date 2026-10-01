import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as Schema from "effect/Schema";
import { EvaluationContract } from "@open-erp/contracts/evaluations";

const Evidence = Schema.Struct({
  originalText: Schema.String,
  first: Schema.JsonObject,
  successor: Schema.JsonObject,
  exchanges: Schema.Array(Schema.Struct({ status: Schema.Int, response: Schema.String })),
});

function isArray(value: Schema.Json): value is Schema.JsonArray {
  return Array.isArray(value);
}

function canonical(value: Schema.Json): string {
  if (isArray(value)) return `[${value.map(canonical).join(",")}]`;

  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, member]) => `${JSON.stringify(name)}:${canonical(member)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function verify(body: Schema.JsonObject) {
  const { digest, ...unsigned } = body;

  assert.equal(digest, `sha256:${createHash("sha256").update(canonical(unsigned)).digest("hex")}`);

  return Schema.decodeUnknownSync(EvaluationContract)(body);
}

const path = process.argv[2];

if (path === undefined) throw Error("Pass the retained evaluation-contract.json artifact path.");

const evidence = Schema.decodeSync(Schema.fromJsonString(Evidence))(await readFile(path, "utf8"));

const first = verify(evidence.first);

const successor = verify(evidence.successor);

assert.equal(
  evidence.originalText,
  "Synthetic original. No accounting amounts or reference postings.",
);

assert.equal(first.originals.length, 1);

assert.equal(
  first.originals[0]?.sha256,
  `sha256:${createHash("sha256").update(evidence.originalText).digest("hex")}`,
);

assert.equal(first.wholeYearComplete, false);

assert.equal(first.capabilityPolicy, "declared_not_enforced");

assert.deepEqual(successor.predecessor, { id: first.id, digest: first.digest });

assert.notEqual(successor.id, first.id);

assert.deepEqual(
  [...new Set(evidence.exchanges.map((exchange) => exchange.status))].sort(
    (left, right) => left - right,
  ),
  [200, 400, 401, 403, 404, 409, 422],
);

console.log(
  JSON.stringify({
    verified: true,
    first: first.id,
    successor: successor.id,
    independentOriginalAndContractHashes: true,
  }),
);
