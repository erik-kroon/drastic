import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { AssetDisposalOperations } from "../../../application/operations/asset-disposals";
import { operationHandlers } from "../operation-handlers";

export const AssetDisposalHandlers = HttpApiBuilder.group(Api, "assetDisposals", (handlers) =>
  handlers.handleAll(operationHandlers(AssetDisposalOperations)),
);
