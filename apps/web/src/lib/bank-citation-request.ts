import * as Accounting from "@open-erp/contracts/accounting";
import type * as Candidates from "@open-erp/contracts/bank-match-candidates";
import type * as Schema from "effect/Schema";
import { accountingResponseStatus, readAccounting } from "./accounting-api";

export async function submitBankWithCitationRefresh<
  I extends { readonly presentedSuggestionIds?: readonly string[] },
  O extends Schema.Top & { readonly DecodingServices: never },
>(input: {
  path: string;
  output: O;
  request: { key: string; input: I };
  optionSetDigest: string;
  refreshAllowed?: boolean;
  options?: RequestInit;
  retain: (request: { key: string; input: I }) => void;
  refresh: () => Promise<typeof Candidates.BankMatchCandidates.Type>;
}): Promise<O["Type"]> {
  const send = async (request: { key: string; input: I }) => {
    input.retain(request);

    const headers = new Headers(input.options?.headers);
    headers.set("Idempotency-Key", request.key);

    return readAccounting(input.path, input.output, {
      ...input.options,
      method: "POST",
      body: JSON.stringify(request.input),
      headers,
    });
  };

  try {
    return await send(input.request);
  } catch (error) {
    if (
      input.refreshAllowed === false ||
      !(error instanceof Accounting.AccountingError) ||
      error.code !== "StaleDependency" ||
      accountingResponseStatus(error) !== 409
    )
      throw error;

    input.options?.signal?.throwIfAborted();

    const fresh = await input.refresh();
    input.options?.signal?.throwIfAborted();

    if (fresh.optionSetDigest !== input.optionSetDigest) throw error;

    return send({
      key: crypto.randomUUID(),
      input: { ...input.request.input, presentedSuggestionIds: [fresh.suggestionRecordId] },
    });
  }
}
