import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { vatCopy } from "./copy";
import { VatDraftForm, VatFactForm } from "./forms";
import { VatDraftView, VatFactSummary } from "./views";

type Props = { open?: boolean; book: typeof Accounting.Book.Type; locale: Locale };
export function VatReturnsPanel({ book, locale, open = false }: Props) {
  const copy = vatCopy(locale);
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [factId, setFactId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const basis = useQuery({ queryKey: [...bookKey(book), "vat-returns", "basis"], queryFn: ({ signal }) => readAccounting(`${bookPath(book)}/vat-returns/facts`, Vat.VatBasis, { signal }), retry: false });
  const drafts = useQuery({ queryKey: [...bookKey(book), "vat-returns", "drafts"], queryFn: ({ signal }) => readAccounting(`${bookPath(book)}/vat-returns/drafts`, Vat.VatDraftList, { signal }), retry: false });
  const refresh = () => { void client.invalidateQueries({ queryKey: [...bookKey(book), "vat-returns"] }); };
  const factSaved = (id: string) => { setCreating(false); setFactId(id); refresh(); };
  return <details open={open} id="vat-returns" tabIndex={-1}>
    <summary>{copy.title}</summary>
    <Box display="grid" gap="2xl" paddingBlock="xl" minWidth="zero">
      <Heading>{copy.title}</Heading><Text>{copy.boundary}</Text>
      <Box display="flex" flexWrap="wrap" gap="md">
        <Button size="xl" variant="outline" onClick={refresh} disabled={basis.isFetching || drafts.isFetching}>{copy.refresh}</Button>
        {book.role === "operator" ? <Button size="xl" onClick={() => setCreating(!creating)}>{creating ? copy.cancel : copy.create}</Button> : <Text>{copy.operator}</Text>}
      </Box>
      {creating ? <VatFactForm book={book} locale={locale} onSaved={factSaved} /> : null}
      <AccountingStatus locale={locale} pending={basis.isPending} error={basis.error} />
      {basis.data ? basis.data.facts.length ? <DataTable title={copy.facts} narrow="stack" columns={[{ id: "description", label: copy.description }, { id: "class", label: copy.recordClass }, { id: "action", label: copy.open }]} rows={basis.data.facts.map(({ fact }) => ({ id: fact.factId, cells: [fact.input.description, fact.input.recordClass === "synthetic" ? copy.synthetic : copy.actual, <Button key="open" size="xl" variant="outline" onClick={() => setFactId(fact.factId)}>{copy.open} · {fact.input.sourceKey}</Button>] }))} /> : <Text>{copy.empty}</Text> : null}
      {factId ? <FactDetail key={factId} book={book} locale={locale} id={factId} onSaved={factSaved} /> : null}
      <Heading>{copy.prepare}</Heading><VatDraftForm book={book} locale={locale} onSaved={(id) => { setDraftId(id); refresh(); }} />
      <AccountingStatus locale={locale} pending={drafts.isPending} error={drafts.error} />
      {drafts.data ? drafts.data.items.length ? <DataTable title={copy.drafts} narrow="stack" columns={[{ id: "period", label: copy.startsOn }, { id: "mode", label: copy.mode }, { id: "action", label: copy.open }]} rows={drafts.data.items.map((draft) => ({ id: draft.id, cells: [`${draft.input.startsOn} – ${draft.input.endsOn}`, draft.input.mode === "actual_review" ? copy.actual : copy.synthetic, <Button key="open" size="xl" variant="outline" onClick={() => setDraftId(draft.id)}>{copy.open} · {draft.id}</Button>] }))} /> : <Text>{copy.noDrafts}</Text> : null}
      {draftId ? <DraftDetail key={draftId} book={book} locale={locale} id={draftId} /> : null}
    </Box>
  </details>;
}
function FactDetail({ book, locale, id, onSaved }: Props & { id: string; onSaved: (id: string) => void }) {
  const copy = vatCopy(locale);
  const [editing, setEditing] = useState<typeof Vat.VatFact.Type | null>(null);
  const result = useQuery({ queryKey: [...bookKey(book), "vat-returns", "fact", id], queryFn: ({ signal }) => readAccounting(`${bookPath(book)}/vat-returns/facts/${id}`, Vat.VatFactView, { signal }), retry: false });
  const view = result.data;
  return <Box display="grid" gap="lg" minWidth="zero">
    <AccountingStatus locale={locale} pending={result.isPending} error={result.error} />
    {view ? <>
      <VatFactSummary book={book} locale={locale} fact={view.current} />
      {book.role === "operator" ? <Box><Button size="xl" variant="outline" onClick={() => setEditing(editing ? null : view.current)}>{editing ? copy.cancel : copy.revise}</Button></Box> : null}
      {editing ? <VatFactForm key={editing.digest} book={book} locale={locale} current={editing} onSaved={(fact) => { setEditing(null); onSaved(fact); }} /> : null}
      <details><summary>{copy.factHistory}</summary><Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
        {view.history.map((fact) => <details key={fact.id}><summary>{fact.revision} · {fact.recordedAt} · {fact.receipt.actorId}</summary><VatFactSummary book={book} locale={locale} fact={fact} /></details>)}
      </Box></details>
    </> : null}
  </Box>;
}
function DraftDetail({ book, locale, id }: Props & { id: string }) {
  const result = useQuery({ queryKey: [...bookKey(book), "vat-returns", "draft", id], queryFn: ({ signal }) => readAccounting(`${bookPath(book)}/vat-returns/drafts/${id}`, Vat.VatDraftView, { signal }), retry: false });
  return <Box display="grid" gap="lg" minWidth="zero">
    <AccountingStatus locale={locale} pending={result.isPending} error={result.error} />
    {result.data ? <VatDraftView book={book} locale={locale} {...result.data} /> : null}
  </Box>;
}
