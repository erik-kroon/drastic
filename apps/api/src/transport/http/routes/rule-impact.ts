import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  captureImpact,
  decideTarget,
  getImpactSnapshot,
  listDecisions,
  listImpact,
  listNotices,
  recordNotice,
} from "../../../application/closing/rule-impact";

export const RuleImpactHandlers = HttpApiBuilder.group(Api, "ruleImpact", (handlers) =>
  handlers
    .handle("listRuleChangeNotices", ({ params }) =>
      Effect.flatMap(authenticate, (token) => listNotices(token, { scope: scopeFromPath(params) })),
    )
    .handle("recordRuleChangeNotice", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        recordNotice(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("captureRuleImpact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        captureImpact(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          noticeId: params.noticeId,
          periodFrom: payload.periodFrom,
          periodTo: payload.periodTo,
        }),
      ),
    )
    .handle("listRuleImpact", ({ params }) =>
      Effect.flatMap(authenticate, (token) => listImpact(token, { scope: scopeFromPath(params) })),
    )
    .handle("getRuleImpactSnapshot", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        getImpactSnapshot(token, {
          scope: scopeFromPath(params),
          snapshotId: params.snapshotId,
          after: query.after,
        }),
      ),
    )
    .handle("decideRuleImpact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        decideTarget(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          snapshotId: params.snapshotId,
          input: payload,
        }),
      ),
    )
    .handle("listRuleImpactDecisions", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        listDecisions(token, { scope: scopeFromPath(params), noticeId: params.noticeId }),
      ),
    ),
);
