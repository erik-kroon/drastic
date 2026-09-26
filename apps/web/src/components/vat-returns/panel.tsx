import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { ArrowLeft, Plus } from "lucide-react";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { PageEmpty, PageCaption } from "@open-erp/ui/components/accounting-page";
import { vatCopy } from "./copy";
import { VatDraftForm, VatFactForm } from "./forms";
import { VatDraftView, VatFactSummary } from "./views";

type Props = {
  recordId?: string;
  onOpen?: (id: string) => void;
  open?: boolean;
  book: typeof Accounting.Book.Type;
  locale: Locale;
};

export function VatReturnsPanel(props: Props) {
  const { book, locale } = props;
  const copy = vatCopy(locale);
  const sv = locale === "sv";
  const client = useQueryClient();
  const [creating, setCreating] = useState<"fact" | "draft" | null>(null);
  const [localRecord, setLocalRecord] = useState("");
  const record = props.recordId ?? localRecord;
  const select = props.onOpen ?? setLocalRecord;

  const selected = record.startsWith("fact:")
    ? { kind: "fact", id: record.slice(5) }
    : record.startsWith("draft:")
      ? { kind: "draft", id: record.slice(6) }
      : null;

  const basis = useQuery({
    queryKey: [...bookKey(book), "vat-returns", "basis"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/vat-returns/facts`, Vat.VatBasis, { signal }),
    retry: false,
  });

  const drafts = useQuery({
    queryKey: [...bookKey(book), "vat-returns", "drafts"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/vat-returns/drafts`, Vat.VatDraftList, { signal }),
    retry: false,
  });

  const saved = (kind: "fact" | "draft", id: string) => {
    setCreating(null);
    select(`${kind}:${id}`);
    void client.invalidateQueries({ queryKey: [...bookKey(book), "vat-returns"] });
  };

  if (selected)
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => select("")}>
            <ArrowLeft size={14} />
            {sv ? "Alla momsunderlag" : "All VAT work"}
          </Button>
        </Box>
        {selected.kind === "fact" ? (
          <FactDetail
            key={selected.id}
            book={book}
            locale={locale}
            id={selected.id}
            onSaved={(id) => saved("fact", id)}
          />
        ) : (
          <DraftDetail key={selected.id} book={book} locale={locale} id={selected.id} />
        )}
      </Box>
    );

  return (
    <Box display="grid" gap="xl" id="vat-returns">
      <RecordHeading
        title={copy.title}
        subtitle={
          sv
            ? "Samla underlag och granska en period innan nästa steg."
            : "Gather the source records and review a period before the next step."
        }
        action={
          <Button disabled={book.role !== "operator"} onClick={() => setCreating("draft")}>
            <Plus size={14} />
            {copy.prepare}
          </Button>
        }
      />
      <RecordSection title={copy.drafts}>
        <AccountingStatus locale={locale} pending={drafts.isPending} error={drafts.error} />
        {drafts.data ? (
          drafts.data.items.length ? (
            <DataTable
              title={copy.drafts}
              narrow="stack"
              columns={[
                { id: "period", label: "Period" },
                { id: "mode", label: copy.mode },
              ]}
              rows={drafts.data.items.map((draft) => ({
                id: draft.id,
                cells: [
                  <Button key="open" variant="ghost" onClick={() => select(`draft:${draft.id}`)}>
                    {draft.input.startsOn} – {draft.input.endsOn}
                  </Button>,
                  draft.input.mode === "actual_review" ? copy.actual : copy.synthetic,
                ],
              }))}
            />
          ) : (
            <PageEmpty
              title={sv ? "Ingen period förberedd än" : "No period prepared yet"}
              detail={
                sv
                  ? "Välj en period för att samla underlag och se vad som återstår."
                  : "Choose a period to collect its source records and see what remains."
              }
            />
          )
        ) : null}
      </RecordSection>
      <RecordSection title={copy.facts}>
        <Box>
          <Button
            variant="outline"
            disabled={book.role !== "operator"}
            onClick={() => setCreating("fact")}
          >
            <Plus size={14} />
            {copy.create}
          </Button>
        </Box>
        <AccountingStatus locale={locale} pending={basis.isPending} error={basis.error} />
        {basis.data ? (
          basis.data.facts.length ? (
            <DataTable
              title={copy.facts}
              narrow="stack"
              columns={[
                { id: "description", label: copy.description },
                { id: "class", label: copy.recordClass },
              ]}
              rows={basis.data.facts.map(({ fact }) => ({
                id: fact.factId,
                cells: [
                  <Button key="open" variant="ghost" onClick={() => select(`fact:${fact.factId}`)}>
                    {fact.input.description}
                  </Button>,
                  fact.input.recordClass === "synthetic" ? copy.synthetic : copy.actual,
                ],
              }))}
            />
          ) : (
            <Text tone="muted">{copy.empty}</Text>
          )
        ) : null}
      </RecordSection>
      <PageCaption>{copy.boundary}</PageCaption>
      {creating ? (
        <FormDialog
          size={creating === "draft" ? "compact" : "wide"}
          title={creating === "fact" ? copy.create : copy.prepare}
          closeLabel={copy.cancel}
          onClose={() => setCreating(null)}
        >
          {creating === "fact" ? (
            <VatFactForm book={book} locale={locale} onSaved={(id) => saved("fact", id)} />
          ) : (
            <VatDraftForm book={book} locale={locale} onSaved={(id) => saved("draft", id)} />
          )}
        </FormDialog>
      ) : null}
    </Box>
  );
}

function FactDetail({
  book,
  locale,
  id,
  onSaved,
}: Props & { id: string; onSaved: (id: string) => void }) {
  const copy = vatCopy(locale);
  const [revision, setRevision] = useState<string | null>(null);
  const [editing, setEditing] = useState<typeof Vat.VatFact.Type | null>(null);

  const result = useQuery({
    queryKey: [...bookKey(book), "vat-returns", "fact", id],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/vat-returns/facts/${id}`, Vat.VatFactView, { signal }),
    retry: false,
  });

  const view = result.data;

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={result.isPending} error={result.error} />
      {view ? (
        <>
          <VatFactSummary
            book={book}
            locale={locale}
            fact={view.current}
            action={
              book.role === "operator" ? (
                <Button variant="outline" onClick={() => setEditing(view.current)}>
                  {copy.revise}
                </Button>
              ) : null
            }
          />
          {editing ? (
            <FormDialog
              title={copy.revise}
              closeLabel={copy.cancel}
              onClose={() => setEditing(null)}
            >
              <VatFactForm
                key={editing.digest}
                book={book}
                locale={locale}
                current={editing}
                onSaved={(fact) => {
                  setEditing(null);
                  onSaved(fact);
                }}
              />
            </FormDialog>
          ) : null}
          <RecordSection title={copy.factHistory}>
            <Box display="flex" gap="sm" flexWrap="wrap">
              {view.history.map((fact) => (
                <Button
                  key={fact.id}
                  variant={revision === fact.id ? "secondary" : "outline"}
                  onClick={() => setRevision(revision === fact.id ? null : fact.id)}
                >
                  {locale === "sv" ? "Version" : "Revision"} {fact.revision} ·{" "}
                  {new Date(fact.recordedAt).toLocaleDateString(locale)}
                </Button>
              ))}
            </Box>
            {view.history
              .filter((fact) => fact.id === revision)
              .map((fact) => (
                <VatFactSummary key={fact.id} book={book} locale={locale} fact={fact} />
              ))}
          </RecordSection>
        </>
      ) : null}
    </Box>
  );
}

function DraftDetail({ book, locale, id }: Props & { id: string }) {
  const result = useQuery({
    queryKey: [...bookKey(book), "vat-returns", "draft", id],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/vat-returns/drafts/${id}`, Vat.VatDraftView, { signal }),
    retry: false,
  });

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={result.isPending} error={result.error} />
      {result.data ? <VatDraftView book={book} locale={locale} {...result.data} /> : null}
    </Box>
  );
}
