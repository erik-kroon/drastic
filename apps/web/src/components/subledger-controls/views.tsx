import { useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Controls from "@open-erp/contracts/subledger-controls";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { controlCopy } from "./copy";

export function BasisDetails({
  basis,
  locale,
}: {
  basis: typeof Controls.SubledgerBasis.Type;
  locale: Locale;
}) {
  const copy = controlCopy(locale);

  return (
    <details>
      <summary>
        {copy.details}: {basis.input.scheduleId}
      </summary>
      <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
        <Text>
          {basis.input.kind === "acquisition" ? copy.acquisition : copy.imported} ·{" "}
          {basis.input.effectiveOn}
        </Text>
        <Text>
          {copy.cost}: {basis.input.originalCostMinor} · {copy.accumulated}:{" "}
          {basis.input.accumulatedMinor} · {copy.carrying}: {basis.input.carryingMinor}
        </Text>
        <Text>
          {basis.input.sourceLocator} · {basis.input.rationale}
        </Text>
        <Text>
          {copy.evidence}: {basis.input.evidenceId} · {basis.sourceSha256}
        </Text>
        <Text>
          {copy.reviewEvidence}: {basis.input.reviewEvidenceId} · {basis.reviewSha256}
        </Text>
        <Text>
          {copy.voucher}: {basis.input.voucherId} · {basis.receipt.actorId} · {basis.createdAt}
        </Text>
        <DataTable
          title={copy.lines}
          narrow="stack"
          columns={[
            { id: "account", label: copy.account },
            { id: "line", label: copy.line },
            { id: "debit", label: copy.debit, numeric: true },
            { id: "credit", label: copy.credit, numeric: true },
          ]}
          rows={basis.lines.map((line) => ({
            id: line.lineId,
            cells: [line.accountId, line.lineId, line.debitMinor, line.creditMinor],
          }))}
        />
      </Box>
    </details>
  );
}

export function ControlInspector({
  book,
  locale,
  id,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  id: string;
}) {
  const copy = controlCopy(locale);

  const saved = useQuery({
    queryKey: [...bookKey(book), "subledger-controls", "snapshot", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/subledger-controls/snapshots/${encodeURIComponent(id)}`,
        Controls.SubledgerControlView,
        { signal },
      );

      const bytes = new TextEncoder().encode(result.artifact.content);

      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");

      const stored = Schema.decodeUnknownSync(Controls.SubledgerControl)(
        JSON.parse(result.artifact.content),
      );

      if (
        result.snapshot.scope.bookId !== book.id ||
        result.snapshot.scope.entityId !== book.entityId ||
        result.snapshot.id !== id ||
        stored.scope.bookId !== book.id ||
        stored.scope.entityId !== book.entityId ||
        stored.id !== id ||
        stored.digest !== result.snapshot.digest ||
        bytes.length !== result.artifact.byteLength ||
        hash !== result.artifact.sha256
      )
        throw new Error(copy.artifactError);

      return { ...result, snapshot: stored };
    },
    retry: false,
  });

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.snapshot}</Heading>
      <Text>{id}</Text>
      <Button
        variant="outline"
        disabled={saved.isFetching}
        onClick={() => {
          void saved.refetch();
        }}
      >
        {copy.refresh}
      </Button>
      <AccountingStatus locale={locale} pending={saved.isPending} error={saved.error} />
      {saved.data ? (
        <Contents
          value={saved.data}
          locale={locale}
          currentnessKnown={
            saved.isSuccess && saved.fetchStatus === "idle" && saved.isFetchedAfterMount
          }
        />
      ) : null}
    </Box>
  );
}

function Contents({
  value,
  locale,
  currentnessKnown,
}: {
  value: typeof Controls.SubledgerControlView.Type;
  locale: Locale;
  currentnessKnown: boolean;
}) {
  const copy = controlCopy(locale);
  const report = value.snapshot;

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text role="status">
        {currentnessKnown
          ? value.dependenciesCurrent
            ? copy.current
            : copy.historical
          : copy.currentnessUnknown}
      </Text>
      <Text>{report.hasReviewGaps ? copy.gaps : copy.noGaps}</Text>
      <Text>{copy.warning}</Text>
      <Text>
        {copy.asOf}: {report.input.asOfDate} · {copy.sequence}: {report.sequence} ·{" "}
        {report.currency} · {report.currencyScale}
      </Text>
      <Text>
        {copy.digest}: {report.digest}
      </Text>
      <Text>
        {report.input.rationale} · {copy.inventory}: {report.input.inventoryEvidenceId} ·{" "}
        {report.inventorySha256}
      </Text>
      <Text>{copy.downloadWarning}</Text>
      <Button
        variant="outline"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob([value.artifact.content], { type: value.artifact.mediaType }),
          );

          const link = document.createElement("a");
          link.href = url;
          link.download = `${report.id}.json`;
          document.body.append(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 0);
        }}
      >
        {copy.download}
      </Button>
      <DataTable
        title={copy.controls}
        narrow="stack"
        columns={[
          { id: "account", label: copy.account },
          { id: "expected", label: copy.expected, numeric: true },
          { id: "ledger", label: copy.ledger, numeric: true },
          { id: "difference", label: copy.difference, numeric: true },
          { id: "unexplained", label: copy.unexplained, numeric: true },
          { id: "missing", label: copy.missing, numeric: true },
        ]}
        rows={report.controls.map((account) => ({
          id: account.accountId,
          cells: [
            `${account.code} · ${account.name}`,
            account.expectedMinor,
            account.ledgerMinor,
            account.differenceMinor,
            account.unexplainedLineCount,
            account.missingEffectCount,
          ],
        }))}
      />
      <details>
        <summary>{copy.schedules}</summary>
        <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
          {report.schedules.map((schedule) => (
            <Box key={schedule.revision.scheduleId} display="grid" gap="md" minWidth="zero">
              <Heading>{schedule.revision.terms.name}</Heading>
              <Text>
                {schedule.revision.scheduleId} · {schedule.revision.digest}
              </Text>
              <Text>
                {copy.recognized}: {schedule.recognizedMinor} · {copy.impairment}:{" "}
                {schedule.impairmentMinor ?? "0"} · {copy.carrying}:{" "}
                {schedule.carryingMinor ?? copy.unavailable}
              </Text>
              {schedule.basisReversed ? <Text>{copy.reversed}</Text> : null}
              {schedule.basis ? (
                <BasisDetails basis={schedule.basis} locale={locale} />
              ) : (
                <Text>{copy.missingBasis}</Text>
              )}
              <DataTable
                title={copy.occurrences}
                narrow="stack"
                columns={[
                  { id: "date", label: copy.date },
                  { id: "state", label: copy.state },
                  { id: "amount", label: copy.effect, numeric: true },
                  { id: "voucher", label: copy.voucher },
                ]}
                rows={schedule.occurrences.map((occurrence) => ({
                  id: String(occurrence.ordinal),
                  cells: [
                    occurrence.postingDate,
                    occurrence.state,
                    occurrence.amountMinor,
                    `${occurrence.voucherId ?? "—"} / ${occurrence.reversalVoucherId ?? "—"}`,
                  ],
                }))}
              />
            </Box>
          ))}
        </Box>
      </details>
      <details>
        <summary>{copy.ledgerLines}</summary>
        <Box paddingBlock="lg" minWidth="zero">
          <DataTable
            title={copy.ledgerLines}
            narrow="stack"
            columns={[
              { id: "voucher", label: copy.voucher },
              { id: "line", label: copy.line },
              { id: "account", label: copy.account },
              { id: "debit", label: copy.debit, numeric: true },
              { id: "credit", label: copy.credit, numeric: true },
              { id: "effect", label: copy.effect, numeric: true },
              { id: "difference", label: copy.difference, numeric: true },
            ]}
            rows={report.ledgerLines.map((line) => ({
              id: `${line.voucherId}:${line.lineId}`,
              cells: [
                `${line.voucherId} · ${line.postingDate}`,
                line.lineId,
                line.accountId,
                line.debitMinor,
                line.creditMinor,
                line.expectedMinor,
                line.unexplainedMinor,
              ],
            }))}
          />
        </Box>
      </details>
    </Box>
  );
}
