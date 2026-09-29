import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as C from "@open-erp/domain/canonicalization";
import { failedWith, succeeded } from "./pure-support";

const corpus = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      provenance: Schema.String,
      cases: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          input: Schema.String,
          expected: Schema.String,
          sha256: Schema.String,
        }),
      ),
    }),
  ),
)(
  readFileSync(
    new URL("../../../../verification/assurance/corpus/canonical.json", import.meta.url),
    "utf8",
  ),
);

test.each(corpus.cases)(
  "[ASR-C14N] $id preserves independent canonical bytes and hash",
  (vector) => {
    const actual = succeeded(C.canonicalizeJson(vector.input));
    expect(actual.json).toBe(vector.expected);
    expect([...actual.bytes]).toEqual([...Buffer.from(vector.expected, "utf8")]);
    expect(createHash("sha256").update(actual.bytes).digest("hex")).toBe(vector.sha256);
  },
);

test.each([
  ['{"a":1,"a":2}', "DuplicateObjectKey"],
  ['{"a":1,"\\u0061":2}', "DuplicateObjectKey"],
  ['{"nested":{"a":1,"a":2}}', "DuplicateObjectKey"],
  ['{"x":"\\ud800"}', "InvalidUnicode"],
  ['{"x":"\\udc00"}', "InvalidUnicode"],
  ['{"x":9007199254740992}', "UnsupportedNumber"],
  ['{"x":1.0}', "UnsupportedNumber"],
  ['{"x":1e0}', "UnsupportedNumber"],
  ['{"x":01}', "InvalidJson"],
  ['{"x":1}garbage', "InvalidJson"],
])("[ASR-C14N-REFUSE] %s", (input, code) => {
  failedWith(C.canonicalizeJson(input), code);
});

test("[ASR-C14N-VERSION] generic JSON is not implicitly a versioned approval document", () => {
  expect(succeeded(C.canonicalizeJson({ lines: [] })).json).toBe('{"lines":[]}');
  failedWith(C.canonicalizeOpenErpC14nV1({ lines: [] }), "UnsupportedVersion");

  const doc = {
    version: 1,
    canonicalization: "openerp-c14n-v1",
    lines: [],
    amount: "9007199254740993",
  };

  const expected =
    '{"amount":"9007199254740993","canonicalization":"openerp-c14n-v1","lines":[],"version":1}';

  expect(succeeded(C.canonicalizeOpenErpC14nV1(doc)).json).toBe(expected);
});

test("[ASR-C14N-STRINGS] scalar strings and serialized JSON are not interchangeable", () => {
  expect(C.equalJson("100", "100")).toBe(true);
  expect(C.equalJson("100", 100)).toBe(false);
  expect(C.equalJson("å", "a\u030a")).toBe(false);
  expect(C.equalJson(undefined, {})).toBe(false);
  // Generic JSON supports canonical numeric zero. Monetary schemas reject '-0' separately.
  expect(succeeded(C.canonicalizeJson('{"x":-0}')).json).toBe('{"x":0}');
});
