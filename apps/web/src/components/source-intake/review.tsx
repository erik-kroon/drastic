import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Intake from "@open-erp/contracts/source-intake";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { formatMinorAmount } from "@/lib/workspace-api";
import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { PageAction, PageCaption } from "@open-erp/ui/components/accounting-page";
import { workspacePath } from "@/lib/book-context";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { IntakeProps } from "./index";
import { intakeCopy } from "./copy";
import { downloadIntake } from "./download";

export function PreviewReview(
  props: IntakeProps & {
    id: string;
    occurrenceId: string;
    canEdit: boolean;
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
    staleTime: 0,
    refetchOnMount: "always",
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
  const writesPending = approval.isPending || admission.isPending;
  const busy = query.isFetching || writesPending;
  const known = query.isSuccess && query.fetchStatus === "idle" && query.isFetchedAfterMount;
  const current = known && view?.dependenciesCurrent && preview?.ready && !writesPending;
  const canApprove = current && !approval.isError;
  const saved = view?.admission ?? admission.data;
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <RecordHeading
        title={locale === "sv" ? "Granska transaktionerna" : "Review transactions"}
        action={
          <Button
            static
            variant="ghost"
            disabled={busy}
            onClick={() => {
              void query.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        }
      />
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {preview && view ? (
        <>
          <PreviewStatus
            known={known}
            saved={Boolean(saved)}
            current={view.dependenciesCurrent}
            ready={preview.ready}
            locale={locale}
          />
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
                disabled={!props.canEdit || busy || approval.isError || admission.isError}
                onClick={() => {
                  if (props.canEdit && !busy && !approval.isError && !admission.isError)
                    props.onEdit(preview);
                }}
              >
                {copy.edit}
              </Button>
            ) : null}
          </Box>
          <PreviewSummary preview={preview} setup={props.setup} locale={locale} />
          {preview.records.length > 21 ? (
            <>
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
                  {copy.range}: {page + 1} /{" "}
                  {Math.max(1, Math.ceil((preview.records.length - 1) / 20))}
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
            </>
          ) : null}
          <PreviewDiagnostics preview={preview} page={page} locale={locale} />
          <DataTable
            title={copy.rows}
            narrow="stack"
            columns={[
              { id: "record", label: copy.record },
              { id: "date", label: copy.date },
              { id: "text", label: copy.description },
              { id: "provider", label: copy.provider },
              {
                id: "amount",
                label: `${locale === "sv" ? "Belopp" : "Amount"} · ${preview.mapping.currency}`,
                numeric: true,
              },
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
          <PreviewTechnicalDetails preview={preview} page={page} locale={locale} />
          {saved ? (
            <PreviewReceipt saved={saved} id={id} book={book} locale={locale} />
          ) : book.role === "operator" ? (
            <>
              <Text>{copy.approvalHelp}</Text>
              <Box
                as="form"
                display="grid"
                gap="md"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!canApprove) return;
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
                  disabled={!canApprove}
                />
                <InputField
                  label={copy.rationale}
                  name="rationale"
                  maxLength={2000}
                  required
                  disabled={!canApprove}
                />
                <Box>
                  <Button type="submit" size="xl" disabled={!canApprove || !reviewed}>
                    {copy.approve}
                  </Button>
                </Box>
              </Box>
              <Text role="status">{inputError}</Text>
              {view.approval ? (
                <Text>
                  {copy.expires}:{" "}
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(view.approval.expiresAt))}
                </Text>
              ) : null}
              <Box>
                <Button
                  type="button"
                  size="xl"
                  variant="outline"
                  disabled={!current || !view.approval || admission.isError}
                  onClick={() => {
                    if (current && view.approval && !admission.isError)
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
      <IntakeRequestRecovery
        locale={locale}
        label={copy.approve}
        request={JSON.stringify(approval.variables)}
        requestKey={approvalKeys.current.get(
          `${base}/approve:${JSON.stringify(approval.variables)}`,
        )}
        complete={approval.isSuccess}
        pending={writesPending}
        onRetry={() => {
          if (!writesPending && approval.variables) approval.mutate(approval.variables);
        }}
        onDiscard={() => {
          if (writesPending) return;
          approval.reset();
          approvalKeys.current.clear();
          setReviewed(false);
          setInputError("");
        }}
      />
      <IntakeRequestRecovery
        locale={locale}
        label={copy.admit}
        request={JSON.stringify(admission.variables)}
        requestKey={admissionKeys.current.get(
          `${base}/admit:${JSON.stringify(admission.variables)}`,
        )}
        complete={admission.isSuccess}
        pending={writesPending}
        onRetry={() => {
          if (!writesPending && admission.variables) admission.mutate(admission.variables);
        }}
        onDiscard={() => {
          if (writesPending) return;
          admission.reset();
          admissionKeys.current.clear();
        }}
      />
    </Box>
  );
}

export function IntakeRequestRecovery(props: {
  locale: IntakeProps["locale"];
  label: string;
  request: string | undefined;
  requestKey: string | undefined;
  complete: boolean;
  pending: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  if (!props.request || props.complete) return null;
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>{props.label}</Text>
      <Text>
        {props.locale === "sv"
          ? "Anropet kan ha sparats även om svaret saknas. Återförsök samma anrop eller läs kvittot innan du kastar återförsöksnyckeln."
          : "The request may have committed even if its response is missing. Retry the same request or recover its receipt before discarding the retry key."}
      </Text>
      <Disclosure title={props.locale === "sv" ? "Bevarat anrop" : "Captured request"}>
        <Text>{props.requestKey}</Text>
        <Text>{props.request}</Text>
      </Disclosure>
      <Box display="flex" flexWrap="wrap" gap="md">
        <Button type="button" variant="outline" disabled={props.pending} onClick={props.onRetry}>
          {props.locale === "sv" ? "Återförsök bevarat anrop" : "Retry retained request"} ·{" "}
          {props.label}
        </Button>
        <Button type="button" variant="ghost" disabled={props.pending} onClick={props.onDiscard}>
          {props.locale === "sv"
            ? "Kasta anrop och återförsöksnyckel"
            : "Discard request and retry key"}{" "}
          · {props.label}
        </Button>
      </Box>
    </Box>
  );
}

function PreviewSummary(props: {
  preview: typeof Intake.SourcePreview.Type;
  setup: IntakeProps["setup"];
  locale: IntakeProps["locale"];
}) {
  const { preview, locale } = props;
  const sv = locale === "sv";
  const mapping = preview.mapping;
  const account = props.setup.accounts.find((item) => item.id === mapping.accountId);
  const amount = (value: string) =>
    `${formatMinorAmount(value, mapping.currencyScale, locale)} ${mapping.currency}`;
  return (
    <Box display="grid" gap="md">
      <PageCaption>
        {account
          ? `${account.code} · ${account.name}`
          : sv
            ? "Kontot är inte tillgängligt"
            : "Account unavailable"}{" "}
        · {mapping.startsOn} – {mapping.endsOn}
      </PageCaption>
      <RecordSummary>
        <RecordFact label={sv ? "Ingående saldo" : "Opening balance"}>
          {amount(mapping.openingMinor)}
        </RecordFact>
        <RecordFact label={sv ? "Förändring" : "Movement"}>
          {amount(preview.movementMinor)}
        </RecordFact>
        <RecordFact label={sv ? "Utgående saldo" : "Closing balance"}>
          {amount(mapping.closingMinor)}
        </RecordFact>
        <RecordFact label={sv ? "Transaktioner" : "Transactions"}>{preview.rows.length}</RecordFact>
      </RecordSummary>
      <PageCaption>
        {mapping.completeness.declaredComplete
          ? sv
            ? "Angiven som fullständig"
            : "Declared complete"
          : sv
            ? "Ofullständig täckning"
            : "Partial coverage"}{" "}
        · {mapping.completeness.basis}
      </PageCaption>
    </Box>
  );
}

function PreviewTechnicalDetails({
  preview,
  page,
  locale,
}: {
  preview: typeof Intake.SourcePreview.Type;
  page: number;
  locale: IntakeProps["locale"];
}) {
  const copy = intakeCopy(locale);
  return (
    <Disclosure
      title={
        locale === "sv"
          ? "Filformat, ursprungsrader och tekniska detaljer"
          : "File format, source rows and technical details"
      }
    >
      <Text>
        {copy.digest}: {preview.digest}
      </Text>
      <Text>
        {copy.bom}: {preview.hasBom ? copy.yes : copy.no} · {copy.structuralComplete}:{" "}
        {preview.structuralComplete ? copy.yes : copy.no}
      </Text>
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
    </Disclosure>
  );
}

function PreviewDiagnostics({
  preview,
  page,
  locale,
}: {
  preview: typeof Intake.SourcePreview.Type;
  page: number;
  locale: IntakeProps["locale"];
}) {
  const copy = intakeCopy(locale);
  return (
    <>
      {preview.diagnostics.length ? (
        <>
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
        </>
      ) : null}
    </>
  );
}

function PreviewStatus(props: {
  known: boolean;
  saved: boolean;
  current: boolean;
  ready: boolean;
  locale: IntakeProps["locale"];
}) {
  const copy = intakeCopy(props.locale);
  return (
    <Text role="status">
      {!props.known
        ? copy.unknown
        : props.saved
          ? copy.admitted
          : !props.current
            ? copy.stale
            : props.ready
              ? copy.ready
              : copy.blocked}
    </Text>
  );
}

function PreviewReceipt({
  saved,
  id,
  book,
  locale,
}: {
  saved: typeof Intake.SourceAdmission.Type;
  id: string;
  book: IntakeProps["book"];
  locale: IntakeProps["locale"];
}) {
  const copy = intakeCopy(locale);
  return (
    <>
      {saved.previewId !== id ? (
        <Text>
          {copy.different} {saved.previewId}
        </Text>
      ) : null}
      <PageCaption>
        {locale === "sv" ? "Importerad" : "Imported"}{" "}
        {new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(saved.admittedAt))}
      </PageCaption>
      <PageAction
        href={`${workspacePath(book)}/accounts?view=bank&record=${encodeURIComponent(`statement:${saved.imported.statement.id}`)}`}
      >
        {locale === "sv" ? "Öppna kontoutdrag" : "Open statement"}
      </PageAction>
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
  );
}
