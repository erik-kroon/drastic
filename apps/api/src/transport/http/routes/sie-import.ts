import { Buffer } from "node:buffer";
import { Api } from "@open-erp/contracts/api";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";
import { getSourceOccurrence } from "../../../application/source-retention";
import { parseSie } from "../../../application/sie-import-parser";
import { failure } from "../../../application/failures";

export const SieImportHandlers = HttpApiBuilder.group(Api, "sieImport", (handlers) =>
  handlers
    .handle("listSieSourcePreviews", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "listSieSourcePreviews",
          [token, scopeParameter(params), params.id],
          Sie.SiePreviewInventory,
        ),
      ),
    )
    .handle("captureSieSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Effect.gen(function* () {
          const source = yield* getSourceOccurrence(token, {
            scope: params,
            occurrenceId: params.id,
          });
          const bytes = Buffer.from(source.contentBase64, "base64");
          if (bytes.length > 524288 || source.occurrence.byteLength !== bytes.length)
            return yield* failure("UnsupportedProfile");
          const parsed = parseSie(bytes, payload.encoding);
          if (
            parsed.records.length > 2000 ||
            parsed.vouchers.length > 200 ||
            Buffer.byteLength(JSON.stringify(parsed)) > 1048576
          )
            return yield* failure("UnsupportedProfile");
          return yield* query(
            "captureSieSource",
            [
              token,
              scopeParameter(params),
              headers["idempotency-key"],
              params.id,
              JSON.stringify({
                ...parsed,
                encoding: payload.encoding,
                profile: "sie4_source_v1",
                sourceSha256: source.occurrence.sha256,
              }),
            ],
            Sie.SiePreview,
          );
        }),
      ),
    )
    .handle("getSieSource", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getSieSource", [token, scopeParameter(params), params.id], Sie.SiePreview),
      ),
    )
    .handle("sealSieSourcePlan", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "sealSieSourcePlan",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Sie.SiePlan,
        ),
      ),
    )
    .handle("getSieSourcePlan", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getSieSourcePlan", [token, scopeParameter(params), params.id], Sie.SiePlan),
      ),
    )
    .handle("startSieSourceRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "startSieSourceRun",
          [token, scopeParameter(params), headers["idempotency-key"], params.id, payload.digest],
          Sie.SieRunStart,
        ),
      ),
    )
    .handle("getSieSourceRun", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getSieSourceRun", [token, scopeParameter(params), params.id], Sie.SieRun),
      ),
    )
    .handle("advanceSieSourceRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "advanceSieSourceRun",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Sie.SieChunk,
        ),
      ),
    )
    .handle("reclaimSieSourceRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "reclaimSieSourceRun",
          [token, scopeParameter(params), headers["idempotency-key"], params.id, payload.action],
          Sie.SieFence,
        ),
      ),
    ),
);
