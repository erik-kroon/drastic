import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Identifiers from "@open-erp/contracts/payment-identifiers";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { checkScope, type CommerceProps } from "./shared";

export function PaymentIdentifierCheck(props: CommerceProps) {
  const sv = props.locale === "sv";

  const [kind, setKind] =
    useState<(typeof Identifiers.PaymentIdentifierInput.Type)["kind"]>("bankgiro");

  const [value, setValue] = useState("");

  const check = useMutation({
    mutationFn: async (input: typeof Identifiers.PaymentIdentifierInput.Type) => {
      const result = await readAccounting(
        (client, requestOptions) =>
          client.paymentIdentifiers.checkPaymentIdentifier(
            httpRequest(
              Api.groups.paymentIdentifiers.endpoints.checkPaymentIdentifier,
              { params: { ...bookScope(props.book) } },
              requestOptions,
            ),
          ),
        Identifiers.PaymentIdentifierView,
        { method: "POST", body: JSON.stringify(input) },
      );

      checkScope(props.book, result.scope);

      return result;
    },
  });

  const result =
    check.data?.result.kind === kind && check.data.result.input === value
      ? check.data.result
      : undefined;

  const labels = {
    valid: sv ? "Korrekt kontrollsiffra" : "Checksum valid",
    invalid: sv
      ? "Ogiltig längd, tecken eller kontrollsiffra"
      : "Invalid length, characters or check digit",
    generated: sv ? "Genererat förslag" : "Generated candidate",
    unsupported: sv
      ? "Inga användbara siffror eller för långt underlag"
      : "No usable digits or source too long",
  };

  return (
    <Disclosure label={sv ? "Kontrollera giro och OCR" : "Check giro and OCR identifiers"}>
      <Box
        as="form"
        display="grid"
        gap="md"
        minWidth="zero"
        onSubmit={(event) => {
          event.preventDefault();
          check.mutate({ kind, value });
        }}
      >
        <PageCaption>
          {sv
            ? "Kontrollen avser endast format och kontrollsiffra, inte mottagarens identitet eller betalningsbehörighet. OCR-förslag skapas av siffrorna i det angivna underlaget."
            : "This checks format and check digits, not payee identity or payment authority. OCR candidates use the digits from the supplied source identifier."}
        </PageCaption>
        <SelectField
          label={sv ? "Typ av identifierare" : "Identifier type"}
          value={kind}
          onValueChange={(nextKind) => {
            if (nextKind === null) return;

            setKind(
              Schema.decodeUnknownSync(Identifiers.PaymentIdentifierInput.fields.kind)(nextKind),
            );
            check.reset();
          }}
          options={[
            { value: "bankgiro", label: "Bankgiro" },
            { value: "plusgiro", label: "Plusgiro" },
            { value: "ocr", label: sv ? "OCR-kontroll" : "OCR validation" },
            {
              value: "check_digit",
              label: sv ? "Beräkna kontrollsiffra" : "Calculate check digit",
            },
            { value: "generate_ocr", label: sv ? "Skapa OCR-förslag" : "Generate OCR candidate" },
          ]}
        />
        <InputField
          label={sv ? "Nummer eller källidentifierare" : "Number or source identifier"}
          value={value}
          maxLength={200}
          onChange={(event) => {
            setValue(event.target.value);
            check.reset();
          }}
        />
        <Box>
          <Button type="submit" variant="outline" disabled={check.isPending}>
            {sv ? "Kontrollera identifierare" : "Check identifier"}
          </Button>
        </Box>
        <AccountingStatus locale={props.locale} pending={check.isPending} error={check.error} />
        {result ? (
          <Box role="status" display="grid" gap="sm">
            <Text>{labels[result.status]}</Text>
            <Text>{result.output}</Text>
          </Box>
        ) : null}
      </Box>
    </Disclosure>
  );
}
