import { scopeFromPath } from "../scope";
import { Buffer } from "node:buffer";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { getSourceOccurrence } from "../../../application/source-retention";
import { parseSie } from "../../../application/sie-import-parser";
import { failure } from "../../../application/failures";
import * as Sie from "../../../application/sie/import";

export const SieImportHandlers = HttpApiBuilder.group(Api, "sieImport", (handlers) =>
  handlers
    .handle("listSieSourcePreviews", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.listSourcePreviews(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("captureSieSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Effect.gen(function* () {
          const source = yield* getSourceOccurrence(token, {
            scope: scopeFromPath(params),
            occurrenceId: params.id,
          });
          const bytes = Buffer.from(source.contentBase64, "base64");
          if (bytes.length > 524288 || source.occurrence.byteLength !== bytes.length)
            return yield* failure("UnsupportedProfile");
          const parsed = parseSie(bytes, payload.encoding);
          if (
            parsed.records.length > 4000 ||
            parsed.vouchers.length > 500 ||
            Buffer.byteLength(JSON.stringify(parsed)) > 1048576
          )
            return yield* failure("UnsupportedProfile");
          return yield* Sie.captureSource(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            id: params.id,
            input: {
              ...parsed,
              encoding: payload.encoding,
              profile: "sie4_source_v1",
              sourceSha256: source.occurrence.sha256,
            },
          });
        }),
      ),
    )
    .handle("getSieSource", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.getSource(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("sealSieSourcePlan", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.sealSourcePlan(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          id: params.id,
          input: payload,
        }),
      ),
    )
    .handle("getSieSourcePlan", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.getSourcePlan(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("startSieSourceRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.startSourceRun(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          id: params.id,
          digest: payload.digest,
        }),
      ),
    )
    .handle("getSieSourceRun", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.getSourceRun(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("advanceSieSourceRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.advanceSourceRun(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          id: params.id,
          input: payload,
        }),
      ),
    )
    .handle("reclaimSieSourceRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Sie.reclaimSourceRun(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          id: params.id,
          action: payload.action,
        }),
      ),
    ),
);
