import { Capabilities } from "@open-erp/contracts/capabilities";
import { captureCashBasis, getCashBasis, listCashBases } from "../cash/basis";
import { captureCashForecast, getCashForecast, listCashForecasts } from "../cash/forecast";
import { effectCapability } from "./shared";

export const cashForecastCapabilities = {
  cash_list_forecasts: effectCapability(Capabilities.cash_list_forecasts, listCashForecasts),
  cash_list_bases: effectCapability(Capabilities.cash_list_bases, listCashBases),
  cash_capture_forecast: effectCapability(Capabilities.cash_capture_forecast, captureCashForecast),
  cash_get_forecast: effectCapability(Capabilities.cash_get_forecast, getCashForecast),
  cash_capture_basis: effectCapability(Capabilities.cash_capture_basis, captureCashBasis),
  cash_get_basis: effectCapability(Capabilities.cash_get_basis, getCashBasis),
};
