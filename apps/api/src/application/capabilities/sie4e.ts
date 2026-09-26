import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getSie4E, listSie4Es, prepareSie4E, resumeSie4E, sie4ERows } from "../sie4e";

export const sie4ECapabilities = {
  sie4e_prepare: effectCapability(Capabilities.sie4e_prepare, prepareSie4E),
  sie4e_get: effectCapability(Capabilities.sie4e_get, getSie4E),
  sie4e_rows: effectCapability(Capabilities.sie4e_rows, sie4ERows),
  sie4e_list: effectCapability(Capabilities.sie4e_list, listSie4Es),
  sie4e_resume: effectCapability(Capabilities.sie4e_resume, resumeSie4E),
};
