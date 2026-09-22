import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Label } from "@open-erp/ui/components/label";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function EvidenceInspector({
  book,
  reference,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  reference: (typeof Accounting.PostingAction.Type)["evidenceRefs"][number];
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const contentId = `${panelId}-content`;
  const evidence = useQuery({
    queryKey: [...bookKey(book), "evidence", reference.evidenceId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/evidence/${encodeURIComponent(reference.evidenceId)}`,
        Accounting.EvidenceContent,
        { signal },
      );
      if (result.id !== reference.evidenceId || result.sha256 !== reference.sha256)
        throw new Error("Evidence reference mismatch");
      return result;
    },
    enabled: open,
    retry: false,
  });
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text tone="muted">
        {reference.evidenceId} · {reference.sha256} · {reference.locator}
      </Text>
      <Box>
        <Button
          size="xl"
          variant="outline"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          {open ? copy.journal_hide_evidence : copy.journal_inspect_evidence}
        </Button>
      </Box>
      <Box
        id={panelId}
        hidden={!open}
        display={open ? "grid" : "none"}
        gap="md"
        minWidth="zero"
        padding="lg"
        borderWidth="thin"
        borderColor="default"
        borderRadius="surface"
      >
        <AccountingStatus
          locale={locale}
          pending={open && evidence.isPending}
          error={evidence.error}
        />
        {evidence.isError ? (
          <Box>
            <Button
              size="xl"
              variant="outline"
              disabled={evidence.isFetching}
              onClick={() => {
                void evidence.refetch();
              }}
            >
              {copy.journal_retry}
            </Button>
          </Box>
        ) : null}
        {evidence.data ? (
          <>
            <Text>
              {copy.journal_title_field}: {evidence.data.title}
            </Text>
            <Text>
              {copy.journal_origin}: {evidence.data.origin}
            </Text>
            <Text tone="muted">
              {copy.journal_evidence_format}: {evidence.data.mediaType} ·{" "}
              {copy.journal_evidence_created}: {evidence.data.createdAt}
            </Text>
            <Text tone="muted">SHA-256: {evidence.data.sha256}</Text>
            <Label htmlFor={contentId}>{copy.journal_content}</Label>
            <Box
              display="grid"
              minWidth="zero"
              borderWidth="thin"
              borderColor="default"
              borderRadius="control"
              backgroundColor="surface"
              padding="md"
            >
              <textarea id={contentId} value={evidence.data.content} readOnly rows={8} cols={16} />
            </Box>
          </>
        ) : null}
      </Box>
    </Box>
  );
}
