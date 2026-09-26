import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  captureConversionReview,
  getConversionReview,
  getExchangeRate,
  listConversionReviews,
  listExchangeRates,
} from "../exchange-rates";

export const fxCapabilities = {
  fx_list_rates: effectCapability(Capabilities.fx_list_rates, listExchangeRates),
  fx_get_rate: effectCapability(Capabilities.fx_get_rate, getExchangeRate),
  fx_capture_conversion: effectCapability(
    Capabilities.fx_capture_conversion,
    captureConversionReview,
  ),
  fx_list_conversions: effectCapability(Capabilities.fx_list_conversions, listConversionReviews),
  fx_get_conversion: effectCapability(Capabilities.fx_get_conversion, getConversionReview),
};
