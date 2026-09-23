import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Intake from "@open-erp/contracts/source-intake";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { formatMinorAmount } from "@/lib/workspace-api";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { IntakeProps } from "./index";
import { intakeCopy } from "./copy";
import { downloadIntake } from "./download";

export function PreviewReview(
  props: IntakeProps & {
    id: string;
    occurrenceId: string;
    onEdit: (preview: typeof Intake.SourcePreview.Type) => void;
  },
) {
  const { book, locale, id, occurrenceId } = props;
  const copy = intakeCopy(locale);
  const client = useQueryClient();
  const approvalKeys = useRef(new Map<string, string>());
  const admissionKeys = useRef(new Map<string, string>());
  const [reviewed, setReviewed] = useState(false);
  const [page, setPage] = useState(0);
  const [inputError, setInputError] = useState("");
  const base = `${bookPath(book)}/source-previews/${encodeURIComponent(id)}`;
  const query = useQuery({
    queryKey: [...bookKey(book), "source-preview", id],
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(base, Intake.SourcePreviewView, { signal });
      if (
        result.preview.id !== id ||
        result.preview.occurrenceId !== occurrenceId ||
        result.preview.scope.bookId !== book.id ||
        result.preview.scope.entityId !== book.entityId
      )
        throw new Error("Preview scope mismatch");
      return result;
    },
  });
  const approval = useMutation({
    mutationFn: (input: typeof Intake.ApproveSourcePreview.Type) =>
      readAccounting(
        `${base}/approve`,
        Intake.SourceApproval,
        mutationOptions(`${base}/approve`, JSON.stringify(input), approvalKeys.current),
      ),
    onSuccess: () => {
      approvalKeys.current.clear();
      setReviewed(false);
    },
    onSettled: () => {
      void query.refetch();
    },
  });
  const admission = useMutation({
    mutationFn: (input: typeof Intake.AdmitSourcePreview.Type) =>
      readAccounting(
        `${base}/admit`,
        Intake.SourceAdmission,
        mutationOptions(`${base}/admit`, JSON.stringify(input), admissionKeys.current),
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: bookKey(book) });
    },
  });
  const view = query.data;
  const preview = view?.preview;
  const busy = query.isFetching || approval.isPending || admission.isPending;
  const current = view?.dependenciesCurrent && preview?.ready && !busy && !query.isError;
  const saved = view?.admission ?? admission.data;
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{locale === "sv" ? "Granska transaktionerna" : "Review transactions"}</Heading>
      <Box>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void query.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {preview && view ? (
        <>
          <Text>
            {copy.digest}: {preview.digest}
          </Text>
          <Text>
            {copy.bom}: {preview.hasBom ? copy.yes : copy.no} · {copy.structuralComplete}:{" "}
            {preview.structuralComplete ? copy.yes : copy.no}
          </Text>
          <Text role="status">
            {saved
              ? copy.admitted
              : query.isError || query.isFetching
                ? copy.unknown
                : !view.dependenciesCurrent
                  ? copy.stale
                  : preview.ready
                    ? copy.ready
                    : copy.blocked}
          </Text>
          <Box display="flex" gap="md" flexWrap="wrap">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                downloadIntake(
                  new Blob([JSON.stringify(preview, null, 2)], { type: "application/json" }),
                  `${id}.json`,
                )
              }
            >
              {copy.downloadPreview}
            </Button>
            {!saved ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => props.onEdit(preview)}
              >
                {copy.edit}
              </Button>
            ) : null}
          </Box>
          <DataTable
            title={copy.mapping}
            narrow="stack"
            columns={[
              { id: "field", label: copy.fields },
              { id: "value", label: copy.reason },
            ]}
            rows={Object.entries(preview.mapping).map(([name, value]) => ({
              id: name,
              cells: [
                new Map(Object.entries(copy)).get(name) ?? name,
                typeof value === "object" ? JSON.stringify(value) : String(value),
              ],
            }))}
          />
          <Text>
            {copy.movement}:{" "}
            {formatMinorAmount(preview.movementMinor, preview.mapping.currencyScale, locale)}{" "}
            {preview.mapping.currency}
          </Text>
          <Text>
            {copy.fields}: {JSON.stringify(preview.records[0]?.fields ?? [])}
          </Text>
          <Box display="flex" gap="md" flexWrap="wrap">
            <Button
              type="button"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              {copy.previous}
            </Button>
            <Text role="status">
              {copy.range}: {page + 1} / {Math.max(1, Math.ceil((preview.records.length - 1) / 20))}
            </Text>
            <Button
              type="button"
              variant="outline"
              disabled={(page + 1) * 20 >= preview.records.length - 1}
              onClick={() => setPage(page + 1)}
            >
              {copy.next}
            </Button>
          </Box>
          <DataTable
            title={copy.diagnostics}
            narrow="stack"
            columns={[
              { id: "code", label: copy.code },
              { id: "locator", label: copy.record },
              { id: "message", label: copy.reason },
            ]}
            rows={preview.diagnostics
              .map((diagnostic, index) => ({ diagnostic, index }))
              .filter(
                ({ diagnostic }) =>
                  diagnostic.recordOrdinal === null ||
                  diagnostic.recordOrdinal <= 1 ||
                  Math.floor((diagnostic.recordOrdinal - 2) / 20) === page ||
                  !preview.structuralComplete,
              )
              .map(({ diagnostic, index }) => ({
                id: String(index),
                cells: [
                  `${diagnostic.severity}: ${diagnostic.code}`,
                  `${diagnostic.recordOrdinal ?? "—"} · ${copy.line} ${diagnostic.line ?? "—"} · byte ${diagnostic.byteOffset ?? "—"}`,
                  diagnostic.message,
                ],
              }))}
          />
          <DataTable
            title={copy.original}
            narrow="stack"
            columns={[
              { id: "record", label: copy.record },
              { id: "line", label: copy.line },
              { id: "bytes", label: copy.bytes },
              { id: "fields", label: copy.fields },
            ]}
            rows={preview.records.slice(1 + page * 20, 1 + (page + 1) * 20).map((record) => ({
              id: String(record.recordOrdinal),
              cells: [
                String(record.recordOrdinal),
                `${record.lineStart}–${record.lineEnd}`,
                `${record.byteStart}–${record.byteEnd}`,
                JSON.stringify(record.fields),
              ],
            }))}
          />
          <DataTable
            title={copy.rows}
            narrow="stack"
            columns={[
              { id: "record", label: copy.record },
              { id: "date", label: copy.date },
              { id: "text", label: copy.description },
              { id: "provider", label: copy.provider },
              { id: "amount", label: copy.amount, numeric: true },
            ]}
            rows={preview.rows
              .filter((row) => row.rowOrdinal > page * 20 && row.rowOrdinal <= (page + 1) * 20)
              .map((row) => ({
                id: String(row.rowOrdinal),
                cells: [
                  String(row.rowOrdinal + 1),
                  row.date,
                  row.description,
                  row.providerId ?? "—",
                  formatMinorAmount(row.amountMinor, preview.mapping.currencyScale, locale),
                ],
              }))}
          />
          {saved ? (
            <>
              {saved.previewId !== id ? (
                <Text>
                  {copy.different} {saved.previewId}
                </Text>
              ) : null}
              <Text>
                {copy.receipt}: {saved.receipt.key} · {saved.receipt.actorId} · {saved.admittedAt}
              </Text>
              <Text>
                {copy.statement}: {saved.imported.statement.id} ·{" "}
                {saved.imported.statement.evidenceId}
              </Text>
              <Box>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    downloadIntake(
                      new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }),
                      `${saved.occurrenceId}-admission.json`,
                    )
                  }
                >
                  {copy.downloadReceipt}
                </Button>
              </Box>
            </>
          ) : book.role === "operator" ? (
            <>
              <Text>{copy.approvalHelp}</Text>
              <Box
                as="form"
                display="grid"
                gap="md"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const input = Schema.decodeUnknownOption(Intake.ApproveSourcePreview)({
                    digest: preview.digest,
                    version: 1,
                    rationale: data.get("rationale"),
                  });
                  if (input._tag === "None" || !reviewed) {
                    setInputError(copy.invalid);
                    return;
                  }
                  setInputError("");
                  approval.mutate(input.value);
                }}
              >
                <InputField
                  label={copy.review}
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.currentTarget.checked)}
                  required
                  disabled={!current}
                />
                <InputField
                  label={copy.rationale}
                  name="rationale"
                  maxLength={2000}
                  required
                  disabled={!current}
                />
                <Box>
                  <Button type="submit" size="xl" disabled={!current || !reviewed}>
                    {copy.approve}
                  </Button>
                </Box>
              </Box>
              <Text role="status">{inputError}</Text>
              {view.approval ? (
                <Text>
                  {copy.expires}: {view.approval.expiresAt} · {view.approval.actorId}
                </Text>
              ) : null}
              <Box>
                <Button
                  type="button"
                  size="xl"
                  variant="outline"
                  disabled={!current || !view.approval}
                  onClick={() => {
                    if (view.approval)
                      admission.mutate({
                        digest: preview.digest,
                        version: 1,
                        approvalId: view.approval.id,
                      });
                  }}
                >
                  {copy.admit}
                </Button>
              </Box>
            </>
          ) : (
            <Text>{copy.operator}</Text>
          )}
          <AccountingStatus
            locale={locale}
            pending={approval.isPending}
            error={approval.error}
            write
          />
          <AccountingStatus
            locale={locale}
            pending={admission.isPending}
            error={admission.error}
            write
          />
        </>
      ) : null}
    </Box>
  );
}
