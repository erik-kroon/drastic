import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getSie, listSie, prepareSie, resumeSie } from "../sie";

export const sieCapabilities = {
  sie_prepare: effectCapability(Capabilities.sie_prepare, prepareSie),
  sie_get: effectCapability(Capabilities.sie_get, getSie),
  sie_list: effectCapability(Capabilities.sie_list, listSie),
  sie_resume: effectCapability(Capabilities.sie_resume, resumeSie),
};
