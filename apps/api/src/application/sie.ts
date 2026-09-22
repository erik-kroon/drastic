import * as Accounting from "@open-erp/contracts/accounting";
import * as Sie from "@open-erp/contracts/sie";
import * as Effect from "effect/Effect";
import { query, scopeParameter } from "../db/query";
import { failure } from "./failures";
import { renderSie } from "@open-erp/jurisdiction-se/sie";

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export const getSie = (token: string, input: typeof Sie.SieCapabilities.sie_get.input.Type) =>
  query("getSieTransaction", [token, scopeParameter(input.scope), input.id], Sie.SieView);

export const listSie = (token: string, input: typeof Sie.SieCapabilities.sie_list.input.Type) =>
  query(
    "listSieTransactions",
    [token, scopeParameter(input.scope), input.after ?? ""],
    Sie.SieList,
  );

export const resumeSie = Effect.fn("sie.resume")(function* (
  token: string,
  input: typeof Sie.SieCapabilities.sie_resume.input.Type,
) {
  const view = yield* getSie(token, input);
  if (view.artifact) return view;
  const bytes = yield* Effect.try({
    try: () => renderSie(view.capture),
    catch: (error) =>
      error instanceof Accounting.AccountingError ? error : failure("InternalError"),
  });
  const hash = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", bytes),
    catch: () => failure("InternalError"),
  });
  const sha256 = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return yield* query(
    "sealSieTransaction",
    [
      token,
      scopeParameter(input.scope),
      input.id,
      JSON.stringify({
        captureDigest: view.capture.digest,
        sourceDigest: view.capture.sourceDigest,
        generatorVersion: view.capture.generatorVersion,
        byteLength: bytes.length,
        sha256,
        contentBase64: base64(bytes),
      }),
    ],
    Sie.SieView,
  );
});

export const prepareSie = Effect.fn("sie.prepare")(function* (
  token: string,
  input: typeof Sie.SieCapabilities.sie_prepare.input.Type,
) {
  const capture = yield* query(
    "captureSieTransaction",
    [token, scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)],
    Sie.SieCapture,
  );
  return yield* resumeSie(token, { scope: input.scope, id: capture.id });
});
