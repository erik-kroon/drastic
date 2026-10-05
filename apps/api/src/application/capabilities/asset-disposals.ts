import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import * as Owner from "../subledger/disposals";

export const assetDisposalCapabilities = {
  asset_disposals_prepare: effectCapability(Capabilities.asset_disposals_prepare, Owner.prepare),
  asset_disposals_execute: effectCapability(Capabilities.asset_disposals_execute, Owner.execute),
  asset_disposals_get: effectCapability(Capabilities.asset_disposals_get, Owner.get),
};
