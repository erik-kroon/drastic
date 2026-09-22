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
import { TaxEvidenceForm, TaxReviewForm, TaxSourceForm } from "./forms";
import { TaxFactsTable, TaxSnapshotEntry } from "./views";

type Props = {
  open?: boolean;
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onPrepared: (id: string) => void;
};
export function ExpenseTaxPanel({ book, locale, onPrepared, open = false }: Props) {
  const copy = expenseTaxCopy(locale);
  const client = useQueryClient();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const inventory = useQuery({
    queryKey: [...bookKey(book), "expense-tax", "inventory"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/expense-tax/sources`, Tax.TaxInventory, { signal }),
    retry: false,
  });
  const sourceSaved = (id: string) => {
    setSourceId(id);
    setCreating(false);
    void client.invalidateQueries({ queryKey: [...bookKey(book), "expense-tax"] });
  };
  return (
    <details open={open} id="expense-tax" tabIndex={-1}>
      <summary>{copy.title}</summary>
      <Box display="grid" gap="2xl" paddingBlock="xl" minWidth="zero">
        <Heading>{copy.title}</Heading>
        <Box backgroundColor="muted" padding="lg" borderRadius="surface" display="grid" gap="md">
          <Text>{copy.boundary}</Text>
          <Text>{copy.actualBlocked}</Text>
        </Box>
        <TaxEvidenceForm book={book} locale={locale} />
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button size="xl" onClick={() => setCreating(!creating)}>
            {creating ? copy.cancel : copy.createSource}
          </Button>
          <Button
            size="xl"
            variant="outline"
            disabled={inventory.isFetching}
            onClick={() => {
              void inventory.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </Box>
        {creating ? <TaxSourceForm book={book} locale={locale} onSaved={sourceSaved} /> : null}
        <AccountingStatus locale={locale} pending={inventory.isPending} error={inventory.error} />
        {inventory.data ? (
          <>
            <Text>
              {copy.digest}: {inventory.data.basisDigest}
            </Text>
            {inventory.data.sources.length === 0 ? (
              <Text>{copy.empty}</Text>
            ) : (
              <DataTable
                title={copy.inventory}
                narrow="stack"
                columns={[
                  { id: "source", label: copy.sourceKey },
                  { id: "description", label: copy.description },
                  { id: "class", label: copy.sourceClass },
                  { id: "review", label: copy.reviewTitle },
                  { id: "action", label: copy.open },
                ]}
                rows={inventory.data.sources.map((row) => ({
                  id: row.current.sourceId,
                  cells: [
                    row.current.sourceKey,
                    row.current.facts.description,
                    row.current.facts.recordClass === "synthetic" ? copy.synthetic : copy.actual,
                    row.reviewCurrent ? copy.currentReview : copy.staleReview,
                    <Button
                      key="open"
                      size="xl"
                      variant="outline"
                      onClick={() => setSourceId(row.current.sourceId)}
                    >
                      {copy.open} · {row.current.sourceKey}
                    </Button>,
                  ],
                }))}
              />
            )}
          </>
        ) : null}
        {sourceId ? (
          <ExpenseTaxSourceDetail
            key={sourceId}
            book={book}
            locale={locale}
            onPrepared={onPrepared}
            sourceId={sourceId}
            onChanged={() => {
              void client.invalidateQueries({ queryKey: [...bookKey(book), "expense-tax"] });
            }}
          />
        ) : null}
        <ExpenseTaxSnapshots book={book} locale={locale} />
      </Box>
    </details>
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
      <Box>
        <Button
          size="xl"
          variant="outline"
          onClick={() => {
            void source.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      {view ? (
        <>
          <Heading>{view.current.facts.description}</Heading>
          <Text>
            {view.current.sourceKey} · {view.current.digest}
          </Text>
          <Text>{view.reviewCurrent ? copy.currentReview : copy.staleReview}</Text>
          <EvidenceInspector
            book={book}
            locale={locale}
            reference={{
              evidenceId: view.current.facts.evidenceId,
              sha256: view.current.evidenceSha256,
              locator: view.current.facts.sourceLocator,
            }}
          />
          <TaxFactsTable facts={view.current.facts} locale={locale} />
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
          {!editor ? (
            <Box display="flex" flexWrap="wrap" gap="md">
              <Button size="xl" variant="outline" onClick={() => setEditor("source")}>
                {copy.reviseSource}
              </Button>
              {book.role === "operator" ? (
                <Button size="xl" onClick={() => setEditor("review")}>
                  {copy.reviewSource}
                </Button>
              ) : (
                <Text>{copy.operatorOnly}</Text>
              )}
            </Box>
          ) : (
            <Box>
              <Button size="xl" variant="ghost" onClick={() => setEditor(null)}>
                {copy.cancel}
              </Button>
            </Box>
          )}
          {editor === "source" ? (
            <TaxSourceForm book={book} locale={locale} current={view.current} onSaved={saved} />
          ) : null}
          {editor === "review" ? (
            <TaxReviewForm book={book} locale={locale} source={view} onSaved={saved} />
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
