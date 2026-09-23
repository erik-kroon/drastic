import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Reversal from "@open-erp/contracts/bank-match-reversals";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { bankUnmatchCopy } from "./copy";
import { BankUnmatchReview } from "./review";

export function BankMatchReversals({ book, locale }: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const copy = bankUnmatchCopy(locale);
  const client = useQueryClient();
  const [kind, setKind] = useState("allocation");
  const [planId, setPlanId] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const keys = useRef(new Map<string, string>());
  const base = `${bookPath(book)}/bank-match-reversal-plans`;
  const saved = useQuery({
    queryKey: [...bookKey(book), "bank-match-reversals", after],
    queryFn: ({ signal }) => readAccounting(
      `${base}${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      Reversal.BankMatchReversalList, { signal },
    ),
    retry: false,
  });
  const prepare = useMutation({
    mutationFn: (input: typeof Reversal.PrepareBankMatchReversal.Type) =>
      readAccounting(base, Reversal.BankMatchReversalPlan, mutationOptions(base, JSON.stringify(input), keys.current)),
    onSuccess: (plan) => {
      setPlanId(plan.id);
      setAfter(null);
      void client.invalidateQueries({ queryKey: [...bookKey(book), "bank-match-reversals"] });
    },
  });
  return (
    <details>
      <summary>{copy.title}</summary>
      <Box display="grid" gap="2xl" paddingBlock="xl" minWidth="zero">
        <Heading>{copy.title}</Heading>
        <Text>{copy.help}</Text>
        <Text>{copy.legacyHelp}</Text>
        <Box as="form" display="grid" gap="md" onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const target = kind === "allocation"
            ? { kind, allocationPlanId: fields.get("allocationPlanId") }
            : { kind, statementId: fields.get("statementId"), rowOrdinal: Number(fields.get("rowOrdinal")) };
          const decoded = Schema.decodeUnknownOption(Reversal.PrepareBankMatchReversal)({ target, reason: fields.get("reason") });
          if (decoded._tag === "None") { setInvalid(true); return; }
          setInvalid(false);
          prepare.mutate(decoded.value);
        }}>
          <Box as="fieldset" display="grid" gap="md" borderWidth="none" padding="none" margin="none"
            minWidth="zero" disabled={prepare.isPending || prepare.isSuccess}>
            <SelectField label={copy.target} value={kind} onValueChange={(value) => setKind(value ?? "allocation")}
              options={[{ value: "allocation", label: copy.allocation }, { value: "legacy_exact", label: copy.legacy }]} />
            {kind === "allocation" ? (
              <InputField label={copy.allocationId} name="allocationPlanId" required pattern="[a-z][a-z0-9_\-]{2,127}" />
            ) : (
              <>
                <InputField label={copy.statement} name="statementId" required pattern="[a-z][a-z0-9_\-]{2,127}" />
                <InputField label={copy.ordinal} name="rowOrdinal" type="number" min={1} max={10000} step={1} required />
              </>
            )}
            <InputField label={copy.reason} name="reason" maxLength={2000} required />
            <Box><Button type="submit" size="xl">{copy.prepare}</Button></Box>
          </Box>
          <Text role="alert">{invalid ? copy.invalid : ""}</Text>
          <AccountingStatus locale={locale} pending={prepare.isPending} error={prepare.error} write />
          {prepare.isSuccess ? <Box><Button type="button" variant="outline" onClick={() => {
            prepare.reset(); keys.current.clear();
          }}>{copy.newPlan}</Button></Box> : null}
        </Box>
        <Box as="form" display="grid" gap="md" onSubmit={(event) => {
          event.preventDefault();
          const id = new FormData(event.currentTarget).get("id");
          if (Schema.is(Accounting.Identifier)(id)) setPlanId(id);
        }}>
          <InputField label={copy.planId} name="id" required pattern="[a-z][a-z0-9_\-]{2,127}" />
          <Box><Button type="submit" variant="outline">{copy.load}</Button></Box>
        </Box>
        {planId ? <BankUnmatchReview key={planId} book={book} id={planId} locale={locale} /> : null}
        <Box as="section" display="grid" gap="md" minWidth="zero">
          <Heading>{copy.saved}</Heading>
          <Text>{copy.historyHelp}</Text>
          <Box display="flex" gap="md" flexWrap="wrap">
            <Button type="button" variant="outline" disabled={saved.isFetching} onClick={() => { void saved.refetch(); }}>{copy.refresh}</Button>
            <Button type="button" variant="outline" disabled={!after || saved.isFetching} onClick={() => setAfter(null)}>{copy.first}</Button>
            <Button type="button" variant="outline" disabled={!saved.data?.next || saved.isFetching} onClick={() => setAfter(saved.data?.next ?? null)}>{copy.next}</Button>
          </Box>
          <AccountingStatus locale={locale} pending={saved.isPending} error={saved.error} />
          {saved.data?.items.length === 0 ? <Text>{copy.empty}</Text> : null}
          {saved.data?.items.map((item) => <Box key={item.id} display="grid" gap="sm" minWidth="zero">
            <Text>{item.reason} · {item.createdAt}</Text>
            <Text>{copy.planId}: {item.id}</Text>
            {item.execution ? <Text>{copy.receipt}: {item.execution.receipt.key}</Text> : null}
            <Box><Button type="button" variant="outline" onClick={() => setPlanId(item.id)}>{copy.open}</Button></Box>
          </Box>)}
        </Box>
      </Box>
    </details>
  );
}
