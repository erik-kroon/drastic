import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { bindHttpOperation } from "../capabilities/http-operation";

export const BankMatchCandidateOperations = {
  discoverBankMatchCandidates: bindHttpOperation(
    Api.groups.bankMatchCandidates.endpoints.discoverBankMatchCandidates,
    capabilities.bank_discover_match_candidates,
    ({ params, payload }) => ({ scope: scopeFromPath(params), input: payload }),
  ),
};
