import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Controls from "@open-erp/contracts/subledger-controls";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { BasisForm } from "./basis-form";
import { ControlInspector, BasisDetails } from "./views";
import { controlCopy } from "./copy";

type Props = { book: typeof Accounting.Book.Type; setup: typeof Accounting.BookSetup.Type; locale: Locale };
export function SubledgerControlsPanel(props: Props) {
  return <Panel key={JSON.stringify(bookKey(props.book))} {...props} />;
}
function Panel({ book, setup, locale }: Props) {
  const copy = controlCopy(locale);
  const [id, setId] = useState("");
  const [invalid, setInvalid] = useState(false);
  const base = `${bookPath(book)}/subledger-controls`;
  const bases = useQuery({
    queryKey: [...bookKey(book), "subledger-controls", "bases"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${base}/bases`, Controls.SubledgerBasisList, { signal });
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId || result.items.some((basis) => basis.scope.bookId !== book.id || basis.scope.entityId !== book.entityId)) throw new Error("Basis inventory scope mismatch");
      return result;
    }, retry: false,
  });
  const snapshots = useQuery({
    queryKey: [...bookKey(book), "subledger-controls", "snapshots"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${base}/snapshots`, Controls.SubledgerControlList, { signal });
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId) throw new Error("Control inventory scope mismatch");
      return result;
    }, retry: false,
  });
  return <Box display="grid" gap="2xl" minWidth="zero">
    <Heading>{copy.title}</Heading>
    <Text>{copy.intro}</Text><Text>{copy.warning}</Text>
    <details><summary>{copy.basis}</summary><Box paddingBlock="lg"><BasisForm book={book} locale={locale} /></Box></details>
    <details><summary>{copy.savedBases}</summary><Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={bases.isPending} error={bases.error} />
      {bases.isSuccess && bases.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
      {bases.data?.items.map((basis) => <BasisDetails key={basis.input.scheduleId} basis={basis} locale={locale} />)}
    </Box></details>
    <details><summary>{copy.snapshot}</summary><Box paddingBlock="lg"><CaptureControl book={book} setup={setup} locale={locale} onSaved={setId} /></Box></details>
    <Box display="flex" flexWrap="wrap" gap="md"><Button variant="outline" disabled={bases.isFetching || snapshots.isFetching} onClick={() => { void bases.refetch(); void snapshots.refetch(); }}>{copy.refresh}</Button></Box>
    <Heading>{copy.saved}</Heading>
    <AccountingStatus locale={locale} pending={snapshots.isPending} error={snapshots.error} />
    {snapshots.isSuccess && snapshots.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
    {snapshots.data?.items.map((snapshot) => <Box key={snapshot.id} display="grid" gap="sm" minWidth="zero">
      <Text>{snapshot.asOfDate} · {copy.sequence}: {snapshot.sequence} · {snapshot.createdAt}</Text>
      <Button variant="outline" onClick={() => setId(snapshot.id)}>{copy.open}: {snapshot.id}</Button>
    </Box>)}
    <Box as="form" display="grid" gap="md" onSubmit={(event) => {
      event.preventDefault(); const value = new FormData(event.currentTarget).get("id");
      if (!Schema.is(Accounting.Identifier)(value)) { setInvalid(true); return; }
      setInvalid(false); setId(value);
    }}>
      <InputField name="id" label={copy.open} required />
      <Button type="submit" variant="outline">{copy.open}</Button>
      <Text role="status">{invalid ? copy.invalid : ""}</Text>
    </Box>
    {id ? <ControlInspector key={id} book={book} locale={locale} id={id} /> : null}
  </Box>;
}
function CaptureControl({ book, setup, locale, onSaved }: Props & { onSaved: (id: string) => void }) {
  const copy = controlCopy(locale);
  const [invalid, setInvalid] = useState(false);
  const keys = useRef(new Map<string, string>());
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async (input: typeof Controls.CreateSubledgerControl.Type) => {
      const path = `${bookPath(book)}/subledger-controls/snapshots`;
      const result = await readAccounting(path, Controls.SubledgerControl, mutationOptions(path, JSON.stringify(input), keys.current));
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId) throw new Error("Control snapshot scope mismatch");
      return result;
    },
    onSuccess: async (result) => {
      onSaved(result.id);
      await client.invalidateQueries({ queryKey: [...bookKey(book), "subledger-controls"] });
    },
  });
  return <Box as="form" display="grid" gap="lg" minWidth="zero" onSubmit={(event) => {
    event.preventDefault(); const fields = new FormData(event.currentTarget);
    const decoded = Schema.decodeUnknownOption(Controls.CreateSubledgerControl)({
      asOfDate: fields.get("asOfDate"), accountIds: fields.getAll("accountIds"),
      inventoryEvidenceId: fields.get("inventoryEvidenceId"), rationale: fields.get("rationale"),
    });
    if (decoded._tag === "None") { setInvalid(true); return; }
    setInvalid(false); save.mutate(decoded.value);
  }}>
    <Text>{copy.accountsHelp}</Text>
    <Box as="fieldset" disabled={save.isPending} display="grid" gap="lg" minWidth="zero" borderWidth="none" margin="none" padding="none">
      <InputField name="asOfDate" label={copy.asOf} type="date" required />
      <InputField name="inventoryEvidenceId" label={copy.inventory} required />
      <InputField name="rationale" label={copy.rationale} maxLength={2000} required />
      <Box as="fieldset" display="grid" gap="md" minWidth="zero" padding="md" borderWidth="thin" borderColor="default" borderRadius="control">
        <legend>{copy.accounts}</legend>
        {setup.accounts.map((account) => <Box as="label" key={account.id} display="flex" gap="md" alignItems="center" paddingBlock="md">
          <input name="accountIds" type="checkbox" value={account.id} /><Text>{account.code} · {account.name} · {account.id}</Text>
        </Box>)}
      </Box>
      <Text>{copy.retry}</Text>
      <Button type="submit" size="xl">{copy.capture}</Button>
    </Box>
    <Text role="status">{invalid ? copy.invalid : save.isSuccess ? copy.savedSnapshot : ""}</Text>
    {save.isSuccess ? <Button type="button" variant="outline" onClick={() => { keys.current.clear(); save.reset(); }}>{copy.newSnapshot}</Button> : null}
    <AccountingStatus write locale={locale} pending={save.isPending} error={save.error} />
  </Box>;
}
