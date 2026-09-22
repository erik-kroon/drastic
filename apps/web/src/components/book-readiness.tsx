import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function BookReadiness({
  book,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const [open, setOpen] = useState(false);
  const status = useQuery({
    queryKey: [...bookKey(book), "status"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${bookPath(book)}/status`, Accounting.BookStatus, {
        signal,
      });
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId)
        throw new Error("Book status scope mismatch");
      return result;
    },
    enabled: open,
    retry: false,
  });
  return (
    <details
      id="book-readiness"
      tabIndex={-1}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{copy.readiness_title}</summary>
      <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
        <AccountingStatus locale={locale} pending={open && status.isPending} error={status.error} />
        <Box>
          <Button
            size="xl"
            variant="outline"
            disabled={status.isFetching}
            onClick={() => {
              void status.refetch();
            }}
          >
            {copy.journal_refresh}
          </Button>
        </Box>
        {status.data ? (
          <>
            <Text>{copy.readiness_warning}</Text>
            <Text tone="muted">
              {copy.journal_profile}: {status.data.profile} · {copy.readiness_authority}:{" "}
              {status.data.writerAuthority} · {copy.journal_sequence}: {status.data.sequence}
            </Text>
            <DataTable
              title={copy.readiness_features}
              narrow="stack"
              columns={[
                { id: "feature", label: copy.readiness_feature },
                { id: "installed", label: copy.readiness_installed },
                { id: "available", label: copy.readiness_availability },
                { id: "limitation", label: copy.readiness_limitation },
              ]}
              rows={status.data.features.map((feature) => ({
                id: feature.id,
                cells: [
                  feature.id,
                  feature.installed ? copy.readiness_installed : copy.readiness_missing,
                  feature.available ? copy.readiness_available : copy.readiness_unavailable,
                  feature.limitation,
                ],
              }))}
            />
            <Heading>{copy.readiness_blockers}</Heading>
            {status.data.blockers.length === 0 ? (
              <Text>{copy.readiness_no_blockers}</Text>
            ) : (
              <DataTable
                title={copy.readiness_blockers}
                narrow="stack"
                columns={[
                  { id: "code", label: "Code" },
                  { id: "message", label: copy.journal_description },
                  { id: "inputs", label: copy.readiness_inputs },
                ]}
                rows={status.data.blockers.map((blocker) => ({
                  id: blocker.code,
                  cells: [blocker.code, blocker.message, blocker.requiredInputs.join(", ")],
                }))}
              />
            )}
          </>
        ) : null}
      </Box>
    </details>
  );
}
