import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Schedules from "@open-erp/contracts/subledgers";
import * as Controls from "@open-erp/contracts/subledger-controls";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { controlCopy } from "./copy";

type Props = { book: typeof Accounting.Book.Type; locale: Locale };
export function BasisForm({ book, locale }: Props) {
  const copy = controlCopy(locale);
  const [selected, setSelected] = useState("");
  const list = useInfiniteQuery({
    queryKey: [...bookKey(book), "control-schedule-selection"],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => readAccounting(
      `${bookPath(book)}/schedules${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
      Schedules.SchedulePage, { signal },
    ),
    getNextPageParam: (last) => last.next ?? undefined,
    retry: false,
  });
  const schedule = useQuery({
    queryKey: [...bookKey(book), "control-schedule", selected],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${bookPath(book)}/schedules/${encodeURIComponent(selected)}`, Schedules.ScheduleView, { signal });
      if (result.current.scheduleId !== selected || result.current.scope.bookId !== book.id || result.current.scope.entityId !== book.entityId) throw new Error("Schedule scope mismatch");
      return result;
    },
    enabled: selected !== "", retry: false,
  });
  if (book.role !== "operator") return <Text>{copy.operator}</Text>;
  return <Box display="grid" gap="lg" minWidth="zero">
    <Text>{copy.basisHelp}</Text>
    <SelectField label={copy.schedule} value={selected} onValueChange={(value) => setSelected(value ?? "")} options={[
      { value: "", label: copy.choose },
      ...(list.data?.pages.flatMap((page) => page.items) ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` })),
    ]} />
    <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
    {list.isError ? <Button variant="outline" onClick={() => { void list.refetch(); }}>{copy.refresh}</Button> : null}
    {list.hasNextPage ? <Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => { void list.fetchNextPage(); }}>{copy.more}</Button> : null}
    {selected ? <AccountingStatus locale={locale} pending={schedule.isPending} error={schedule.error} /> : null}
    {schedule.isSuccess ? <SelectVoucher key={selected} book={book} locale={locale} schedule={schedule.data.current} /> : null}
  </Box>;
}
function SelectVoucher({ book, locale, schedule }: Props & { schedule: typeof Schedules.ScheduleRevision.Type }) {
  const copy = controlCopy(locale);
  const [id, setId] = useState("");
  const [invalid, setInvalid] = useState(false);
  const voucher = useQuery({
    queryKey: [...bookKey(book), "control-basis-voucher", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${bookPath(book)}/vouchers/${encodeURIComponent(id)}`, Accounting.Voucher, { signal });
      if (result.id !== id) throw new Error("Voucher identity mismatch");
      return result;
    }, enabled: id !== "", retry: false,
  });
  return <Box display="grid" gap="lg" minWidth="zero">
    <Box as="form" display="grid" gap="md" onSubmit={(event) => {
      event.preventDefault(); const value = new FormData(event.currentTarget).get("voucherId");
      if (!Schema.is(Accounting.Identifier)(value)) { setInvalid(true); return; }
      setInvalid(false); setId(value); if (value === id) void voucher.refetch();
    }}>
      <InputField name="voucherId" label={copy.voucher} required />
      <Button type="submit" variant="outline">{copy.loadVoucher}</Button>
      <Text role="status">{invalid ? copy.invalid : ""}</Text>
    </Box>
    {id ? <AccountingStatus locale={locale} pending={voucher.isPending} error={voucher.error} /> : null}
    {voucher.isSuccess ? <RecordBasis key={`${schedule.digest}:${id}`} book={book} locale={locale} schedule={schedule} voucher={voucher.data} /> : null}
  </Box>;
}
function RecordBasis({ book, locale, schedule, voucher }: Props & { schedule: typeof Schedules.ScheduleRevision.Type; voucher: typeof Accounting.Voucher.Type }) {
  const copy = controlCopy(locale);
  const keys = useRef(new Map<string, string>());
  const [invalid, setInvalid] = useState(false);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async (input: typeof Controls.RecordSubledgerBasis.Type) => {
      const path = `${bookPath(book)}/subledger-controls/bases`;
      const result = await readAccounting(path, Controls.SubledgerBasis, mutationOptions(path, JSON.stringify(input), keys.current));
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId || result.input.scheduleId !== schedule.scheduleId) throw new Error("Basis identity mismatch");
      return result;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [...bookKey(book), "subledger-controls"] }),
  });
  return <Box as="form" display="grid" gap="lg" minWidth="zero" onSubmit={(event) => {
    event.preventDefault(); const fields = new FormData(event.currentTarget);
    const decoded = Schema.decodeUnknownOption(Controls.RecordSubledgerBasis)({
      scheduleId: schedule.scheduleId, expectedDigest: schedule.digest, voucherId: voucher.id,
      kind: fields.get("kind"), effectiveOn: fields.get("effectiveOn"), evidenceId: fields.get("evidenceId"),
      sourceLocator: fields.get("sourceLocator"), reviewEvidenceId: fields.get("reviewEvidenceId"), rationale: fields.get("rationale"),
      originalCostMinor: fields.get("originalCostMinor"), accumulatedMinor: fields.get("accumulatedMinor"),
      carryingMinor: schedule.terms.costMinor, lineIds: fields.getAll("lineIds"),
    });
    if (decoded._tag === "None") { setInvalid(true); return; }
    setInvalid(false); save.mutate(decoded.value);
  }}>
    <Text>{copy.amounts}</Text>
    <Text>{copy.carrying}: {schedule.terms.costMinor} · {schedule.currency} · {schedule.currencyScale}</Text>
    <Box as="fieldset" disabled={save.isPending || save.isSuccess} display="grid" gap="lg" minWidth="zero" padding="none" margin="none" borderWidth="none">
      <SelectField name="kind" label={copy.kind} required defaultValue="" options={[
        { value: "", label: "—" }, { value: "acquisition", label: copy.acquisition }, { value: "imported_opening", label: copy.imported },
      ]} />
      <InputField name="effectiveOn" type="date" label={copy.date} defaultValue={voucher.action.postingDate} required />
      <SelectField name="evidenceId" label={copy.evidence} required defaultValue="" options={[
        { value: "", label: "—" }, ...voucher.action.evidenceRefs.map((evidence) => ({ value: evidence.evidenceId, label: `${evidence.evidenceId} · ${evidence.locator}` })),
      ]} />
      <InputField name="sourceLocator" label={copy.locator} maxLength={256} required />
      <InputField name="reviewEvidenceId" label={copy.reviewEvidence} required />
      <InputField name="rationale" label={copy.rationale} maxLength={2000} required />
      <InputField name="originalCostMinor" label={copy.cost} inputMode="numeric" pattern="(0|[1-9][0-9]{0,37})" required />
      <InputField name="accumulatedMinor" label={copy.accumulated} inputMode="numeric" pattern="(0|[1-9][0-9]{0,37})" required />
      <Box as="fieldset" display="grid" gap="md" minWidth="zero" padding="md" borderWidth="thin" borderColor="default" borderRadius="control">
        <legend>{copy.lines}</legend>
        {voucher.action.lines.map((line) => <Box as="label" key={line.lineId} display="flex" gap="md" paddingBlock="md" alignItems="center">
          <input name="lineIds" type="checkbox" value={line.lineId} />
          <Text>{line.accountId} · {line.lineId} · {copy.debit}: {line.debitMinor} · {copy.credit}: {line.creditMinor} · {line.description}</Text>
        </Box>)}
      </Box>
      <Text>{copy.retry}</Text>
      <Button type="submit" size="xl">{copy.saveBasis}</Button>
    </Box>
    <Text role="status">{invalid ? copy.invalid : save.isSuccess ? copy.savedBasis : ""}</Text>
    <AccountingStatus write locale={locale} pending={save.isPending} error={save.error} />
  </Box>;
}
