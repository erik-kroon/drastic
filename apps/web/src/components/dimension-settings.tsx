import { useState } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Dimensions from "@open-erp/contracts/dimensions";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

type Item = typeof Dimensions.SaveDimension.Type;
type Value = typeof Dimensions.SaveDimensionValue.Type;
const empty: Item = { code: "", name: "", effectiveFrom: "", effectiveTo: null, archived: false };

export function DimensionSettings({ book, locale }: { book: typeof Accounting.Book.Type; locale: Locale }) {
  const queryClient = useQueryClient();
  const [dimension, setDimension] = useState<Item>(empty);
  const [value, setValue] = useState<Value>({ ...empty, dimensionCode: "" });
  const [saved, setSaved] = useState(false);
  const [keys] = useState(() => new Map<string, string>());
  const path = `${bookPath(book)}/dimensions`;
  const key = [...bookKey(book), "dimensions"];
  const list = useQuery(queryOptions({ queryKey: key, queryFn: ({ signal }) =>
    readAccounting(path, Dimensions.DimensionList, { signal }),
  }));
  const save = useMutation({
    mutationFn: async ({ kind, item }: { kind: "dimension"; item: Item } | { kind: "value"; item: Value }) => {
      const target = kind === "dimension" ? path : `${path}/values`;
      const body = JSON.stringify(item);
      return readAccounting(target, kind === "dimension" ? Dimensions.DimensionSaved : Dimensions.DimensionValueSaved,
        mutationOptions(target, body, keys));
    },
    onSuccess: async () => { setSaved(true); await queryClient.invalidateQueries({ queryKey: key }); },
    onError: () => setSaved(false),
  });
  const sv = locale === "sv";
  const dimensions = list.data?.dimensions ?? [];
  return <RecordSection title={sv ? "Dimensioner" : "Dimensions"}>
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>{sv ? "Koder finns kvar när du arkiverar en dimension eller ett värde. Bokförda rader ändras inte." : "Archiving a dimension or value keeps its code. Posted lines do not change."}</Text>
      <AccountingStatus error={list.error} pending={list.isPending} locale={locale} />
      <DimensionEntries dimensions={dimensions} locale={locale} loading={list.isPending} error={list.error} onDimension={setDimension} onValue={setValue} />
      <form onSubmit={(event) => { event.preventDefault(); setSaved(false); save.mutate({ kind: "dimension", item: dimension }); }}>
        <Box display="grid" gap="sm">
          <Text>{sv ? "Skapa eller ändra dimension" : "Create or update dimension"}</Text>
          <InputField label={sv ? "Kod" : "Code"} required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" value={dimension.code} onChange={(event) => setDimension({ ...dimension, code: event.target.value })} />
          <InputField label={sv ? "Namn" : "Name"} required maxLength={120} value={dimension.name} onChange={(event) => setDimension({ ...dimension, name: event.target.value })} />
          <InputField label={sv ? "Gäller från" : "Effective from"} type="date" required value={dimension.effectiveFrom} onChange={(event) => setDimension({ ...dimension, effectiveFrom: event.target.value })} />
          <InputField label={sv ? "Gäller till (valfritt)" : "Effective to (optional)"} type="date" min={dimension.effectiveFrom} value={dimension.effectiveTo ?? ""} onChange={(event) => setDimension({ ...dimension, effectiveTo: event.target.value || null })} />
          <label><input type="checkbox" checked={dimension.archived} onChange={(event) => setDimension({ ...dimension, archived: event.target.checked })} /> {sv ? "Arkiverad" : "Archived"}</label>
          <Box display="flex" gap="sm"><Button type="submit" disabled={save.isPending}>{sv ? "Spara dimension" : "Save dimension"}</Button>
          <Button variant="outline" type="button" onClick={() => setDimension(empty)}>{sv ? "Ny dimension" : "New dimension"}</Button></Box>
        </Box>
      </form>
      <form onSubmit={(event) => { event.preventDefault(); setSaved(false); save.mutate({ kind: "value", item: value }); }}>
        <Box display="grid" gap="sm">
          <Text>{sv ? "Skapa eller ändra värde" : "Create or update value"}</Text>
          <label>{sv ? "Dimension" : "Dimension"}<select required value={value.dimensionCode} onChange={(event) => setValue({ ...value, dimensionCode: event.target.value })}>
            <option value="">{sv ? "Välj dimension" : "Select dimension"}</option>
            {dimensions.map((entry) => <option key={entry.code} value={entry.code}>{entry.code} — {entry.name}</option>)}
          </select></label>
          <InputField label={sv ? "Värdekod" : "Value code"} required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" value={value.code} onChange={(event) => setValue({ ...value, code: event.target.value })} />
          <InputField label={sv ? "Namn" : "Name"} required maxLength={120} value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} />
          <InputField label={sv ? "Gäller från" : "Effective from"} type="date" required value={value.effectiveFrom} onChange={(event) => setValue({ ...value, effectiveFrom: event.target.value })} />
          <InputField label={sv ? "Gäller till (valfritt)" : "Effective to (optional)"} type="date" min={value.effectiveFrom} value={value.effectiveTo ?? ""} onChange={(event) => setValue({ ...value, effectiveTo: event.target.value || null })} />
          <label><input type="checkbox" checked={value.archived} onChange={(event) => setValue({ ...value, archived: event.target.checked })} /> {sv ? "Arkiverat" : "Archived"}</label>
          <Box display="flex" gap="sm"><Button type="submit" disabled={save.isPending}>{sv ? "Spara värde" : "Save value"}</Button>
          <Button variant="outline" type="button" onClick={() => setValue({ ...empty, dimensionCode: value.dimensionCode })}>{sv ? "Nytt värde" : "New value"}</Button></Box>
        </Box>
      </form>
      <AccountingStatus error={save.error} pending={save.isPending} locale={locale} write />
      {saved ? <Text role="status">{sv ? "Dimensionen har sparats." : "Dimension saved."}</Text> : null}
    </Box>
  </RecordSection>;
}

function DimensionEntries(props: {
  dimensions: readonly (typeof Dimensions.Dimension.Type)[];
  locale: Locale;
  loading: boolean;
  error: Error | null;
  onDimension: (item: Item) => void;
  onValue: (item: Value) => void;
}) {
  const sv = props.locale === "sv";
  return <>
      {props.dimensions.map((entry) => <Box key={entry.code} display="grid" gap="sm">
        <Text>{entry.code} — {entry.name}{entry.archived ? (sv ? " (arkiverad)" : " (archived)") : ""}</Text>
        <Button variant="outline" type="button" onClick={() => { props.onDimension({ code: entry.code, name: entry.name, effectiveFrom: entry.effectiveFrom, effectiveTo: entry.effectiveTo, archived: entry.archived }); props.onValue({ ...empty, dimensionCode: entry.code }); }}>
          {sv ? "Redigera dimension" : "Edit dimension"}
        </Button>
        {entry.values.map((option) => <Box key={option.code} display="flex" gap="sm" alignItems="center">
          <Text>{option.code} — {option.name}{option.archived ? (sv ? " (arkiverat)" : " (archived)") : ""}</Text>
          <Button variant="outline" type="button" onClick={() => props.onValue({ dimensionCode: entry.code, code: option.code, name: option.name, effectiveFrom: option.effectiveFrom, effectiveTo: option.effectiveTo, archived: option.archived })}>
            {sv ? "Redigera värde" : "Edit value"}
          </Button>
        </Box>)}
      </Box>)}
      {!props.loading && !props.error && !props.dimensions.length ? <Text>{sv ? "Inga dimensioner ännu." : "No dimensions yet."}</Text> : null}
  </>;
}
