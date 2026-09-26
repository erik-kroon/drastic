import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { createCompany, getCompanySetup, saveCompanySetup } from "../company-setup";
import { createFirm, getFirm, listFirms, removeFirmClient, saveFirmClient, saveFirmMember } from "../firms";

export const companyFirmCapabilities = {
  company_create: effectCapability(Capabilities.company_create, createCompany),
  company_get_setup: effectCapability(Capabilities.company_get_setup, getCompanySetup),
  company_save_setup: effectCapability(Capabilities.company_save_setup, saveCompanySetup),
  firm_list: effectCapability(Capabilities.firm_list, (token) => listFirms(token)),
  firm_get: effectCapability(Capabilities.firm_get, getFirm),
  firm_create: effectCapability(Capabilities.firm_create, createFirm),
  firm_save_client: effectCapability(Capabilities.firm_save_client, saveFirmClient),
  firm_remove_client: effectCapability(Capabilities.firm_remove_client, removeFirmClient),
  firm_save_member: effectCapability(Capabilities.firm_save_member, saveFirmMember),
};
