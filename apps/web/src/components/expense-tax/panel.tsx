import { Plus, ArrowLeft } from "lucide-react";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { Badge } from "@open-erp/ui/components/badge";
import {
  RecordHeading,
  RecordSummary,
  RecordFact,
  RecordColumns,
  RecordSection,
} from "@open-erp/ui/components/record-layout";
import {
  RegisterSearch,
  RecordToggle,
  PageEmpty,
  PageCaption,
} from "@open-erp/ui/components/accounting-page";
import { ExpenseEditor, ExpenseRevisionEditor } from "./expense-editor";
import { formatMinorAmount } from "@/lib/workspace-api";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Tax from "@open-erp/contracts/expense-tax";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { expenseTaxCopy } from "./copy";
import { ExpenseReviewForm } from "./review-editor";
import { TaxFactsTable, TaxSnapshotEntry } from "./views";

type Props = {
  open?: boolean;
  recordId?: string;
  onOpen?: (id: string) => void;
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onPrepared: (id: string) => void;
};
export function ExpenseTaxPanel(props: Props) {
  const { book, locale, onPrepared } = props;
  const copy = expenseTaxCopy(locale);
  const client = useQueryClient();
  const [localRecord, setLocalRecord] = useState("");
  const selected = props.recordId ?? localRecord;
  const select = props.onOpen ?? setLocalRecord;
  const creating = selected === "new" || selected.startsWith("new:");
  const sourceId = creating ? null : selected;
  const [search, setSearch] = useState("");
  const sv = locale === "sv";
  const inventory = useQuery({
    queryKey: [...bookKey(book), "expense-tax", "inventory"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/expense-tax/sources`, Tax.TaxInventory, { signal }),
    retry: false,
  });
  const sourceSaved = (id: string) => {
    select(id);
    void client.invalidateQueries({ queryKey: [...bookKey(book), "expense-tax"] });
  };
  const rows =
    inventory.data?.sources.filter((row) =>
      row.current.facts.description
        .toLocaleLowerCase(locale)
        .includes(search.toLocaleLowerCase(locale)),
    ) ?? [];
  if (sourceId)
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => select("")}>
            <ArrowLeft size={14} />
            {sv ? "Alla utgifter" : "All expenses"}
          </Button>
        </Box>
        <ExpenseTaxSourceDetail
          book={book}
          locale={locale}
          onPrepared={onPrepared}
          sourceId={sourceId}
          onChanged={() => {
            void client.invalidateQueries({ queryKey: [...bookKey(book), "expense-tax"] });
          }}
        />
      </Box>
    );
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={sv ? "Utgifter" : "Expenses"}
        subtitle={
          sv
            ? "Granska underlag, belopp och momsbehandling."
            : "Review source records, amounts and tax treatment."
        }
        action={
          <Button onClick={() => select("new")}>
            <Plus size={14} />
            {sv ? "Ny utgift" : "New expense"}
          </Button>
        }
      />
      <RegisterSearch
        aria-label={sv ? "Sök utgifter" : "Search expenses"}
        placeholder={sv ? "Sök beskrivning…" : "Search description…"}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <AccountingStatus locale={locale} pending={inventory.isPending} error={inventory.error} />
      {inventory.isSuccess ? (
        rows.length ? (
          <DataTable
            title={sv ? "Utgifter" : "Expenses"}
            narrow="stack"
            columns={[
              { id: "description", label: copy.description },
              { id: "date", label: sv ? "Datum" : "Date" },
              { id: "status", label: "Status" },
              { id: "amount", label: sv ? "Totalt" : "Total", numeric: true },
            ]}
            rows={rows.map((row) => ({
              id: row.current.sourceId,
              cells: [
                <RecordToggle
                  key="open"
                  expanded={false}
                  onClick={() => select(row.current.sourceId)}
                >
                  {row.current.facts.description}
                </RecordToggle>,
                row.current.facts.issuedOn ?? "—",
                <Badge key="status" variant={row.reviewCurrent ? "secondary" : "warning"}>
                  {row.reviewCurrent
                    ? sv
                      ? "Granskad"
                      : "Reviewed"
                    : sv
                      ? "Att granska"
                      : "Needs review"}
                </Badge>,
                row.current.facts.amounts.grossMinor !== null &&
                row.current.facts.currencyScale !== null
                  ? `${formatMinorAmount(row.current.facts.amounts.grossMinor, row.current.facts.currencyScale, locale)} ${row.current.facts.currency ?? ""}`
                  : "—",
              ],
            }))}
          />
        ) : (
          <PageEmpty
            title={sv ? "Inga utgifter här än" : "No expenses here yet"}
            detail={
              sv
                ? "Lägg till uppgifterna från ett underlag för att börja granskningen."
                : "Add the details from a source document to start the review."
            }
          />
        )
      ) : null}
      <PageCaption>
        {sv
          ? "Att spara en utgift bokför eller betalar den inte. Saknade uppgifter behöver granskas."
          : "Saving an expense does not post or pay it. Missing details still need review."}
      </PageCaption>
      <details>
        <summary>{copy.snapshots}</summary>
        <Box paddingBlock="lg">
          <ExpenseTaxSnapshots book={book} locale={locale} />
        </Box>
      </details>
      {creating ? (
        <FormDialog
          title={sv ? "Ny utgift" : "New expense"}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => select("")}
        >
          <ExpenseEditor
            book={book}
            locale={locale}
            sourceId={selected.startsWith("new:") ? selected.slice(4) : undefined}
            onSaved={sourceSaved}
          />
        </FormDialog>
      ) : null}
    </Box>
  );
}

function ExpenseTaxSourceDetail(props: Props & { sourceId: string; onChanged: () => void }) {
  const { book, locale, sourceId } = props;
  const copy = expenseTaxCopy(locale);
  const [editor, setEditor] = useState<"source" | "review" | null>(null);
  const source = useQuery({
    queryKey: [...bookKey(book), "expense-tax", "source", sourceId],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/expense-tax/sources/${sourceId}`, Tax.TaxSourceView, {
        signal,
      }),
    retry: false,
  });
  const saved = () => {
    setEditor(null);
    props.onChanged();
  };
  const view = source.data;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={source.isPending} error={source.error} />
      {view && !source.isError ? (
        <>
          <RecordHeading
            title={view.current.facts.description}
            subtitle={
              locale === "sv" ? "Utgift · underlag och granskning" : "Expense · source and review"
            }
            action={
              <Box display="flex" gap="md">
                <Button
                  variant="outline"
                  disabled={book.role !== "operator"}
                  onClick={() => setEditor("source")}
                >
                  {locale === "sv" ? "Redigera uppgifter" : "Edit details"}
                </Button>
                <Button disabled={book.role !== "operator"} onClick={() => setEditor("review")}>
                  {locale === "sv" ? "Granska moms" : "Review tax treatment"}
                </Button>
              </Box>
            }
          />
          <RecordSummary>
            <RecordFact label={locale === "sv" ? "Totalt" : "Total"}>
              {expenseDisplayAmount(view.current, "grossMinor", locale)}
            </RecordFact>
            <RecordFact label={locale === "sv" ? "Moms" : "Tax"}>
              {expenseDisplayAmount(view.current, "vatMinor", locale)}
            </RecordFact>
            <RecordFact label={locale === "sv" ? "Dokumentdatum" : "Document date"}>
              {view.current.facts.issuedOn ?? "—"}
            </RecordFact>
            <RecordFact label="Status">
              <Badge variant={view.reviewCurrent ? "secondary" : "warning"}>
                {view.reviewCurrent
                  ? locale === "sv"
                    ? "Granskad"
                    : "Reviewed"
                  : locale === "sv"
                    ? "Att granska"
                    : "Needs review"}
              </Badge>
            </RecordFact>
          </RecordSummary>
          <RecordColumns>
            <RecordSection title={locale === "sv" ? "Underlag" : "Source document"}>
              <EvidenceInspector
                book={book}
                locale={locale}
                expanded
                compact
                reference={{
                  evidenceId: view.current.facts.evidenceId,
                  sha256: view.current.evidenceSha256,
                  locator: view.current.facts.sourceLocator,
                }}
              />
            </RecordSection>
            <RecordSection title={locale === "sv" ? "Uppgifter" : "Details"}>
              <TaxFactsTable facts={view.current.facts} locale={locale} />
              <PageCaption>
                {locale === "sv"
                  ? "Sparade uppgifter är inte en bokföring eller betalning."
                  : "Saved details do not constitute a posting or payment."}
              </PageCaption>
              {view.latestReview ? (
                <Box display="grid" gap="sm">
                  <PageCaption>
                    {view.reviewCurrent
                      ? locale === "sv"
                        ? "Granskningsanteckning"
                        : "Review note"
                      : locale === "sv"
                        ? "Tidigare granskning — underlaget har ändrats"
                        : "Previous review — the source has changed"}
                  </PageCaption>
                  <Text>{view.latestReview.facts.rationale}</Text>
                </Box>
              ) : null}
            </RecordSection>
          </RecordColumns>
          {view.current.facts.changeSetId ? (
            <Box>
              <Button
                size="xl"
                variant="outline"
                onClick={() => {
                  if (view.current.facts.changeSetId)
                    props.onPrepared(view.current.facts.changeSetId);
                }}
              >
                {copy.openProposal}
              </Button>
            </Box>
          ) : null}
          {editor ? (
            <FormDialog
              title={
                editor === "source"
                  ? locale === "sv"
                    ? "Redigera utgift"
                    : "Edit expense"
                  : locale === "sv"
                    ? "Granska moms"
                    : "Review tax treatment"
              }
              closeLabel={copy.cancel}
              onClose={() => setEditor(null)}
            >
              {editor === "source" ? (
                <ExpenseRevisionEditor
                  book={book}
                  locale={locale}
                  baseline={view.current}
                  onSaved={saved}
                />
              ) : (
                <ExpenseReviewForm book={book} locale={locale} source={view} onSaved={saved} />
              )}
            </FormDialog>
          ) : null}
          <details>
            <summary>{copy.history}</summary>
            <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
              {view.sourceHistory.map((revision) => (
                <details key={revision.id}>
                  <summary>
                    {copy.sourceRevision} {revision.revision} · {revision.recordedAt}
                  </summary>
                  <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
                    <Text>{revision.digest}</Text>
                    <TaxFactsTable facts={revision.facts} locale={locale} />
                    <EvidenceInspector
                      book={book}
                      locale={locale}
                      reference={{
                        evidenceId: revision.facts.evidenceId,
                        sha256: revision.evidenceSha256,
                        locator: revision.facts.sourceLocator,
                      }}
                    />
                  </Box>
                </details>
              ))}
              {view.reviewHistory.map((review) => (
                <details key={review.id}>
                  <summary>
                    {copy.reviewRevision} {review.revision} · {review.recordedAt}
                  </summary>
                  <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
                    <Text>
                      {copy.reviewedBy}: {review.receipt.actorId}
                    </Text>
                    <Text>{review.sourceDigest}</Text>
                    <Text>{review.digest}</Text>
                    <TaxFactsTable facts={review.facts} locale={locale} />
                    {review.evidenceRefs.map((ref) => (
                      <EvidenceInspector
                        key={ref.evidenceId}
                        book={book}
                        locale={locale}
                        reference={{ ...ref, locator: review.id }}
                      />
                    ))}
                  </Box>
                </details>
              ))}
            </Box>
          </details>
        </>
      ) : null}
    </Box>
  );
}
function expenseDisplayAmount(
  source: typeof Tax.TaxSourceRevision.Type,
  name: "grossMinor" | "vatMinor",
  locale: Locale,
) {
  const amount = source.facts.amounts[name];
  return amount !== null && source.facts.currencyScale !== null
    ? `${formatMinorAmount(amount, source.facts.currencyScale, locale)} ${source.facts.currency ?? ""}`
    : "—";
}

function ExpenseTaxSnapshots({ book, locale }: Pick<Props, "book" | "locale">) {
  const client = useQueryClient();
  const copy = expenseTaxCopy(locale);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const keys = useRef(new Map<string, string>());
  const snapshots = useQuery({
    queryKey: [...bookKey(book), "expense-tax", "snapshots", after],
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/expense-tax/snapshots${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Tax.TaxSnapshotPage,
        { signal },
      ),
    retry: false,
  });
  const prepare = useMutation({
    mutationFn: (input: typeof Tax.PrepareTaxSnapshot.Type) => {
      const path = `${bookPath(book)}/expense-tax/snapshots`;
      return readAccounting(
        path,
        Tax.TaxSnapshot,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (snapshot, input) => {
      keys.current.delete(`${bookPath(book)}/expense-tax/snapshots:${JSON.stringify(input)}`);
      setSnapshotId(snapshot.id);
      setAfter(null);
      void client.invalidateQueries({ queryKey: [...bookKey(book), "expense-tax", "snapshots"] });
    },
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.snapshots}</Heading>
      <Box
        as="form"
        display="grid"
        gap="md"
        minWidth="zero"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const decoded = Schema.decodeUnknownOption(Tax.PrepareTaxSnapshot)({
            mode: fields.get("mode"),
            startsOn: fields.get("startsOn"),
            endsOn: fields.get("endsOn"),
          });
          if (decoded._tag === "None") {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          prepare.mutate(decoded.value);
        }}
      >
        <Box
          as="fieldset"
          display="grid"
          gap="md"
          borderWidth="none"
          padding="none"
          margin="none"
          minWidth="zero"
          disabled={prepare.isPending}
        >
          <SelectField
            label={copy.mode}
            name="mode"
            required
            defaultValue=""
            options={[
              { value: "", label: "—" },
              { value: "actual_review", label: copy.actual },
              { value: "synthetic_demonstration", label: copy.synthetic },
            ]}
          />
          <InputField label={copy.startsOn} name="startsOn" type="date" required />
          <InputField label={copy.endsOn} name="endsOn" type="date" required />
          <Box>
            <Button type="submit" size="xl">
              {copy.prepareSnapshot}
            </Button>
          </Box>
        </Box>
        <Text role="status">
          {invalid ? copy.invalid : prepare.isSuccess ? copy.snapshotSaved : ""}
        </Text>
        <AccountingStatus locale={locale} write pending={prepare.isPending} error={prepare.error} />
      </Box>
      <Box display="flex" flexWrap="wrap" gap="md">
        <Button
          size="xl"
          variant="outline"
          disabled={snapshots.isFetching}
          onClick={() => {
            void snapshots.refetch();
          }}
        >
          {copy.refresh}
        </Button>
        {after ? (
          <Button size="xl" variant="ghost" onClick={() => setAfter(null)}>
            {copy.first}
          </Button>
        ) : null}
      </Box>
      <AccountingStatus locale={locale} pending={snapshots.isPending} error={snapshots.error} />
      {snapshots.data?.items.length === 0 ? <Text>{copy.noSnapshots}</Text> : null}
      {snapshots.data?.items.map((snapshot) => (
        <Box key={snapshot.id}>
          <Button size="xl" variant="outline" onClick={() => setSnapshotId(snapshot.id)}>
            {copy.open} · {snapshot.input.startsOn} – {snapshot.input.endsOn} ·{" "}
            {snapshot.recordedAt}
          </Button>
        </Box>
      ))}
      {snapshots.data?.next ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            onClick={() => setAfter(snapshots.data?.next ?? null)}
          >
            {copy.next}
          </Button>
        </Box>
      ) : null}
      {snapshotId ? (
        <ExpenseTaxSnapshotDetail key={snapshotId} book={book} locale={locale} id={snapshotId} />
      ) : null}
    </Box>
  );
}
function ExpenseTaxSnapshotDetail({
  book,
  locale,
  id,
}: Pick<Props, "book" | "locale"> & { id: string }) {
  const copy = expenseTaxCopy(locale);
  const result = useQuery({
    queryKey: [...bookKey(book), "expense-tax", "snapshot", id],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/expense-tax/snapshots/${id}`, Tax.TaxSnapshotView, {
        signal,
      }),
    retry: false,
  });
  const snapshot = result.data?.snapshot;
  const amountNames = [
    "grossMinor",
    "netMinor",
    "vatMinor",
    "deductibleMinor",
    "nonDeductibleMinor",
    "expenseMinor",
  ] as const;
  const amountLabels = {
    grossMinor: copy.gross,
    netMinor: copy.net,
    vatMinor: copy.vat,
    deductibleMinor: copy.deductible,
    nonDeductibleMinor: copy.nonDeductible,
    expenseMinor: copy.expense,
  };
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={result.isPending} error={result.error} />
      <Box>
        <Button
          size="xl"
          variant="outline"
          onClick={() => {
            void result.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      {snapshot ? (
        <>
          <Text>
            {snapshot.id} · {snapshot.recordedAt}
          </Text>
          <Text>{snapshot.digest}</Text>
          <Text>
            {snapshot.input.mode === "actual_review" ? copy.actual : copy.synthetic} ·{" "}
            {snapshot.input.startsOn} – {snapshot.input.endsOn}
          </Text>
          <Text>{result.data?.basisCurrent ? copy.fresh : copy.stale}</Text>
          <Text>{copy.boundary}</Text>
          <Text>
            {copy.included}: {snapshot.includedCount} · {copy.excluded}: {snapshot.excludedCount}
          </Text>
          {snapshot.input.mode === "synthetic_demonstration" ? (
            <DataTable
              title={copy.totals}
              narrow="stack"
              columns={[
                { id: "label", label: copy.amountColumn },
                { id: "amount", label: snapshot.currency, numeric: true },
              ]}
              rows={amountNames.map((name) => ({
                id: name,
                cells: [amountLabels[name], snapshot.syntheticTotals[name]],
              }))}
            />
          ) : (
            <Text>{copy.actualBlocked}</Text>
          )}
          <Box>
            <Button
              size="xl"
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `${snapshot.id}.json`;
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              {copy.download}
            </Button>
          </Box>
          {snapshot.entries.map((entry) => (
            <TaxSnapshotEntry
              key={entry.source.sourceId}
              entry={entry}
              book={book}
              locale={locale}
            />
          ))}
        </>
      ) : null}
    </Box>
  );
}
