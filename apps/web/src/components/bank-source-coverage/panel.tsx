import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Coverage from "@open-erp/contracts/bank-source-coverage";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { sourceCoverageCopy } from "./copy";
import { BankSourceCoverageInspector } from "./review";

type Props = { book: typeof Accounting.Book.Type; locale: Locale };
export function BankSourceCoveragePanel(props: Props) {
  return <Panel key={JSON.stringify(bookKey(props.book))} {...props} />;
}
function Panel({ book, locale }: Props) {
  const copy = sourceCoverageCopy(locale);
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [id, setId] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const base = `${bookPath(book)}/bank-source-coverage`;
  const saved = useQuery({
    queryKey: [...bookKey(book), "bank-source-coverage", "list"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(base, Coverage.BankSourceCoverageList, { signal });
      if (result.scope.entityId !== book.entityId || result.scope.bookId !== book.id) throw new Error(copy.artifactError);
      return result;
    }, retry: false,
  });
  const capture = useMutation({
    mutationFn: async (input: typeof Coverage.CreateBankSourceCoverage.Type) => {
      const report = await readAccounting(base, Coverage.BankSourceCoverageReport, mutationOptions(base, JSON.stringify(input), keys.current));
      if (report.scope.entityId !== book.entityId || report.scope.bookId !== book.id
        || report.input.inventoryId !== input.inventoryId || report.input.startsOn !== input.startsOn
        || report.input.endsOn !== input.endsOn) throw new Error(copy.artifactError);
      return report;
    },
    onSuccess: (report) => {
      setId(report.id);
      void client.invalidateQueries({ queryKey: [...bookKey(book), "bank-source-coverage"] });
    },
  });
  return <details><summary>{copy.title}</summary>
    <Box display="grid" gap="xl" paddingBlock="xl" minWidth="zero">
      <Heading>{copy.title}</Heading><Text>{copy.help}</Text><Text>{copy.warning}</Text><Text>{copy.limits}</Text>
      <Box as="form" display="grid" gap="md" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const decoded = Schema.decodeUnknownOption(Coverage.CreateBankSourceCoverage)({
          inventoryId: fields.get("inventoryId"), startsOn: fields.get("startsOn"), endsOn: fields.get("endsOn"),
        });
        if (decoded._tag === "None" || decoded.value.startsOn > decoded.value.endsOn) { setInvalid(true); return; }
        setInvalid(false); capture.mutate(decoded.value);
      }}>
        <Box as="fieldset" display="grid" gap="md" borderWidth="none" padding="none" margin="none"
          minWidth="zero" disabled={capture.isPending || capture.isSuccess}>
          <InputField label={copy.inventory} name="inventoryId" required />
          <InputField label={copy.starts} name="startsOn" type="date" required />
          <InputField label={copy.ends} name="endsOn" type="date" required />
          <Box><Button type="submit">{copy.capture}</Button></Box>
        </Box>
        <Text role="alert">{invalid ? copy.invalid : ""}</Text>
        <AccountingStatus locale={locale} pending={capture.isPending} error={capture.error} write />
        {capture.isSuccess ? <Box><Button type="button" variant="outline" onClick={() => {
          capture.reset(); keys.current.clear();
        }}>{copy.another}</Button></Box> : null}
      </Box>
      <Box as="form" display="grid" gap="md" onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get("id");
        if (!Schema.is(Accounting.Identifier)(value)) { setInvalid(true); return; }
        setInvalid(false); setId(value);
      }}>
        <InputField label={copy.reportId} name="id" required />
        <Box><Button type="submit" variant="outline">{copy.open}</Button></Box>
      </Box>
      {id ? <BankSourceCoverageInspector key={id} book={book} locale={locale} id={id} /> : null}
      <Heading>{copy.saved}</Heading>
      <Box><Button type="button" variant="outline" disabled={saved.isFetching} onClick={() => { void saved.refetch(); }}>{copy.refresh}</Button></Box>
      <AccountingStatus locale={locale} pending={saved.isPending} error={saved.error} />
      {saved.data?.items.length === 0 ? <Text>{copy.empty}</Text> : null}
      {saved.data?.items.map((report) => <Box key={report.id} display="grid" gap="sm" minWidth="zero">
        <Text>{report.startsOn} — {report.endsOn} · {report.createdAt}</Text>
        <Text>{copy.sequence}: {report.sequence} · {report.hasReviewGaps ? copy.gaps : copy.noGaps}</Text>
        <Box><Button type="button" variant="outline" onClick={() => setId(report.id)}>{copy.open}: {report.id}</Button></Box>
      </Box>)}
    </Box>
  </details>;
}
