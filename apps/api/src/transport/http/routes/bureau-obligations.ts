import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { listBureauObligations } from "../../../application/bureau-obligations";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const BureauObligationsHandlers = HttpApiBuilder.group(
  Api,
  "bureauObligations",
  (handlers) =>
    handlers.handle("listBureauObligations", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        listBureauObligations(token, { scope: scopeFromPath(params) }),
      ),
    ),
);
