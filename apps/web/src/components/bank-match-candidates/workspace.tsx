import { useState } from "react";
import type * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { BankAllocations } from "@/components/settlements";
import { BankMatchReversals } from "@/components/bank-match-reversals/panel";
import { bookKey } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { BankMatchCandidatesPanel, type BankCandidateSelection } from "./panel";
import { bankCandidateCopy } from "./copy";

type Props = {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
};

export function BankMatchingWorkspace(props: Props) {
  return <Workspace key={JSON.stringify(bookKey(props.book))} {...props} />;
}

function Workspace({ book, setup, locale }: Props) {
  const copy = bankCandidateCopy(locale);
  const [candidate, setCandidate] = useState<BankCandidateSelection | null>(null);

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <BankMatchCandidatesPanel book={book} locale={locale} onSelect={setCandidate} />
      {candidate ? <Text role="status">{copy.queued}</Text> : null}
      <BankAllocations book={book} setup={setup} locale={locale} candidate={candidate} />
      <BankMatchReversals book={book} locale={locale} />
    </Box>
  );
}
