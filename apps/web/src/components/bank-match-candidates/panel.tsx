import { useState } from "react";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Candidates from "@open-erp/contracts/bank-match-candidates";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import type { Locale } from "@/paraglide/runtime";
import { bankCandidateCopy } from "./copy";
import { BankCandidateResults, type BankCandidateSelection } from "./results";

export type { BankCandidateSelection } from "./results";

export function BankMatchCandidatesPanel({ book, locale, onSelect }: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onSelect?: (selection: BankCandidateSelection) => void;
}) {
  const copy = bankCandidateCopy(locale);
  const [source, setSource] = useState<typeof Candidates.BankCandidateSource.Type | null>(null);
  const [invalid, setInvalid] = useState(false);
  return <details>
    <summary>{copy.title}</summary>
    <Box display="grid" gap="xl" paddingBlock="xl" minWidth="zero">
      <Heading>{copy.title}</Heading>
      <Text>{copy.help}</Text>
      <Box as="form" display="grid" gap="md" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const decoded = Schema.decodeUnknownOption(Candidates.BankCandidateSource)({
          statementId: fields.get("statementId"), rowOrdinal: Number(fields.get("rowOrdinal")),
        });
        if (decoded._tag === "None") { setInvalid(true); return; }
        setInvalid(false);
        setSource(decoded.value);
      }}>
        <InputField label={copy.statement} name="statementId" required />
        <InputField label={copy.ordinal} name="rowOrdinal" type="number" min={1} max={10000} step={1} required />
        <Text role="alert">{invalid ? copy.invalid : ""}</Text>
        <Box><Button type="submit">{copy.discover}</Button></Box>
      </Box>
      {source ? <BankCandidateResults key={`${book.entityId}:${book.id}:${source.statementId}:${source.rowOrdinal}`}
        book={book} locale={locale} source={source} onSelect={onSelect} /> : null}
    </Box>
  </details>;
}
