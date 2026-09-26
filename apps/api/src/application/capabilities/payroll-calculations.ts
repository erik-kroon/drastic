import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getCalculation, listCalculations, prepareCalculation } from "../payroll/calculations";

export const payrollCalculationCapabilities = {
  payroll_prepare_calculation: effectCapability(
    Capabilities.payroll_prepare_calculation,
    prepareCalculation,
  ),
  payroll_get_calculation: effectCapability(Capabilities.payroll_get_calculation, getCalculation),
  payroll_list_calculations: effectCapability(
    Capabilities.payroll_list_calculations,
    listCalculations,
  ),
};
