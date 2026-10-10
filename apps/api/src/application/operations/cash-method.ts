import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { admitCashMethodInvoice } from "../commerce/cash-invoices";
import { prepareCashCredit, approveCashCredit, executeCashCredit } from "../commerce/cash-credits";
import {
  prepareCashYearEnd,
  approveCashYearEnd,
  executeCashYearEnd,
} from "../commerce/cash-year-end";
import { recognizeCashPayment, registerCashMethodLine } from "../commerce/cash-method";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const CashMethodOperations = {
  executeCashCredit: defineHttpOperation(
    Api.groups.cashMethod.endpoints.executeCashCredit,
    (token, { params, headers, payload }) =>
      executeCashCredit(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveCashCredit: defineHttpOperation(
    Api.groups.cashMethod.endpoints.approveCashCredit,
    (token, { params, headers, payload }) =>
      approveCashCredit(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareCashCredit: defineHttpOperation(
    Api.groups.cashMethod.endpoints.prepareCashCredit,
    (token, { params, headers, payload }) =>
      prepareCashCredit(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  readCashMethodLine: bindHttpOperation(
    Api.groups.cashMethod.endpoints.readCashMethodLine,
    capabilities.commerce_read_cash_method_line,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  executeCashYearEnd: defineHttpOperation(
    Api.groups.cashMethod.endpoints.executeCashYearEnd,
    (token, { params, headers, payload }) =>
      executeCashYearEnd(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveCashYearEnd: defineHttpOperation(
    Api.groups.cashMethod.endpoints.approveCashYearEnd,
    (token, { params, headers, payload }) =>
      approveCashYearEnd(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  runCashMethodYearEnd: defineHttpOperation(
    Api.groups.cashMethod.endpoints.runCashMethodYearEnd,
    (token, { params, headers, payload }) =>
      prepareCashYearEnd(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  recognizeCashPayment: defineHttpOperation(
    Api.groups.cashMethod.endpoints.recognizeCashPayment,
    (token, { params, headers, payload }) =>
      recognizeCashPayment(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  registerCashMethodLine: defineHttpOperation(
    Api.groups.cashMethod.endpoints.registerCashMethodLine,
    (token, { params, headers, payload }) =>
      registerCashMethodLine(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  admitCashMethodInvoice: defineHttpOperation(
    Api.groups.cashMethod.endpoints.admitCashMethodInvoice,
    (token, { params, headers, payload }) =>
      admitCashMethodInvoice(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
