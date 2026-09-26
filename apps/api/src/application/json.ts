import type * as Accounting from "@open-erp/contracts/accounting";
import { canonicalizeJson, canonicalizeOpenErpC14nV1 } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import { failure } from "./failures";

type JsonObject = Schema.JsonObject;

function digestCanonical<A extends { readonly bytes: Uint8Array }>(
  canonicalize: () => Result.Result<A, unknown>,
  code: typeof Accounting.FailureCode.Type,
) {
  return Effect.gen(function* () {
    const canonical = yield* Effect.sync(canonicalize);

    if (Result.isFailure(canonical)) return yield* failure(code);
    const canonicalBytes = new Uint8Array(canonical.success.bytes.byteLength);
    canonicalBytes.set(canonical.success.bytes);

    const bytes = yield* Effect.tryPromise({
      try: () => crypto.subtle.digest("SHA-256", canonicalBytes),
      catch: () => failure(code),
    });

    const hex = Array.from(new Uint8Array(bytes), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    return `sha256:${hex}`;
  });
}

export function digest(
  value: Schema.Json,
  code: typeof Accounting.FailureCode.Type = "InternalError",
) {
  return digestCanonical(() => canonicalizeJson(typeof value === "string" ? JSON.stringify(value) : value), code);
}

export function versionedDigest(
  value: JsonObject,
  code: typeof Accounting.FailureCode.Type = "InternalError",
) {
  return digestCanonical(() => canonicalizeOpenErpC14nV1(value), code);
}

export function canonicalText(value: Schema.Json) {
  return Effect.gen(function* () {
    const result = canonicalizeJson(typeof value === "string" ? JSON.stringify(value) : value);

    if (Result.isFailure(result)) return yield* failure("InternalError");

    return result.success.json;
  });
}
