import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  approveCompanyActivation,
  executeCompanyActivation,
  getCompanyActivation,
  getCompanyProfile,
  prepareCompanyActivation,
  recordCompanyFact,
  recordCompanyRoleBinding,
  reviewCompanyFact,
} from "../company-profiles";

export const companyProfileCapabilities = {
  company_record_fact: effectCapability(Capabilities.company_record_fact, recordCompanyFact),
  company_review_fact: effectCapability(Capabilities.company_review_fact, reviewCompanyFact),
  company_bind_role: effectCapability(Capabilities.company_bind_role, recordCompanyRoleBinding),
  company_get_profile: effectCapability(Capabilities.company_get_profile, getCompanyProfile),
  company_prepare_activation: effectCapability(
    Capabilities.company_prepare_activation,
    prepareCompanyActivation,
  ),
  company_approve_activation: effectCapability(
    Capabilities.company_approve_activation,
    approveCompanyActivation,
  ),
  company_execute_activation: effectCapability(
    Capabilities.company_execute_activation,
    executeCompanyActivation,
  ),
  company_get_activation: effectCapability(
    Capabilities.company_get_activation,
    getCompanyActivation,
  ),
};
