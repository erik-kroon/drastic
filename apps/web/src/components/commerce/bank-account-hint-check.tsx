import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Identifiers from "@open-erp/contracts/payment-identifiers";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { checkScope, type CommerceProps } from "./shared";

export function BankAccountHintCheck(props: CommerceProps) {
  const sv = props.locale === "sv";
  const [clearing, setClearing] = useState("");
  const [account, setAccount] = useState("");

  const check = useMutation({
    mutationFn: async (input: typeof Identifiers.BankAccountHintInput.Type) => {
      const response = await readAccounting(
        (client, requestOptions) =>
          client.paymentIdentifiers.checkBankAccountHint(
            httpRequest(
              Api.groups.paymentIdentifiers.endpoints.checkBankAccountHint,
              { params: { ...bookScope(props.book) } },
              requestOptions,
            ),
          ),
        Identifiers.BankAccountHintView,
        { method: "POST", body: JSON.stringify(input) },
      );

      checkScope(props.book, response.scope);

      return response;
    },
  });

  const result =
    check.data?.result.clearing === clearing && check.data.result.account === account
      ? check.data.result
      : undefined;

  const labels = {
    valid: sv
      ? "Kontrollsiffran stämmer (referensregler)"
      : "Account checksum valid (reference rules)",
    invalid: sv
      ? "Kontrollsiffran stämmer inte (referensregler)"
      : "Account checksum invalid (reference rules)",
    unknown: sv ? "Ingen bedömning av dessa uppgifter" : "No opinion for these details",
  };

  return (
    <Disclosure
      label={sv ? "Kontrollera clearing och kontonummer" : "Check clearing and account number"}
    >
      <Box
        as="form"
        display="grid"
        gap="md"
        minWidth="zero"
        onSubmit={(event) => {
          event.preventDefault();
          check.mutate({ profile: "reference_r2_v1", clearing, account });
        }}
      >
        <PageCaption>
          {sv
            ? "Referensregler R2 ger endast en icke-blockerande formathint, inte en bankverifiering. Ange clearing och konto separat utan bindestreck; blanksteg ignoreras."
            : "Reference R2 rules provide only a non-blocking format hint, not bank verification. Enter clearing and account separately without hyphens; spaces are ignored."}
        </PageCaption>
        <InputField
          label={sv ? "Clearingnummer" : "Clearing number"}
          value={clearing}
          inputMode="numeric"
          maxLength={20}
          onChange={(event) => {
            setClearing(event.target.value);
            check.reset();
          }}
        />
        <InputField
          label={sv ? "Kontonummer" : "Account number"}
          value={account}
          inputMode="numeric"
          maxLength={20}
          onChange={(event) => {
            setAccount(event.target.value);
            check.reset();
          }}
        />
        <Box>
          <Button type="submit" variant="outline" disabled={check.isPending}>
            {sv ? "Kontrollera kontots kontrollsiffra" : "Check account checksum"}
          </Button>
        </Box>
        <AccountingStatus locale={props.locale} pending={check.isPending} error={check.error} />
        <Box role="status" display="grid" gap="sm">
          {result ? (
            <>
              <Text>{labels[result.status]}</Text>
              <PageCaption>
                {result.rule ??
                  (sv ? "Ingen regel för clearingnumret" : "No rule for this clearing")}
              </PageCaption>
            </>
          ) : null}
        </Box>
      </Box>
    </Disclosure>
  );
}
