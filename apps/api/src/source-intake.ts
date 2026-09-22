import { Api } from "@open-erp/contracts/api";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "./auth";
import { query, scopeParameter } from "./database";

export const SourceIntakeHandlers = HttpApiBuilder.group(Api, "sourceIntake", (handlers) =>
  handlers
    .handle("retainSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "retainSource",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Intake.SourceOccurrence,
        ),
      ),
    )
    .handle("listSourceOccurrences", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "listSourceOccurrences",
          [token, scopeParameter(params), search.cursor ?? ""],
          Intake.SourceInventory,
        ),
      ),
    )
    .handle("getSourceOccurrence", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getSourceOccurrence",
          [token, scopeParameter(params), params.id],
          Intake.SourceOccurrenceView,
        ),
      ),
    )
    .handle("previewSourceCsv", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "previewSourceCsv",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Intake.SourcePreview,
        ),
      ),
    )
    .handle("getSourcePreview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getSourcePreview",
          [token, scopeParameter(params), params.id],
          Intake.SourcePreviewView,
        ),
      ),
    )
    .handle("approveSourcePreview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveSourcePreview",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Intake.SourceApproval,
        ),
      ),
    )
    .handle("admitSourcePreview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "admitSourcePreview",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Intake.SourceAdmission,
        ),
      ),
    ),
);
