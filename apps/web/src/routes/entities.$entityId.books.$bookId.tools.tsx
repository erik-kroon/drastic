import { createFileRoute } from "@tanstack/react-router";
import { Box } from "@open-erp/ui/components/box";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingWorkspace } from "@/components/accounting-workspace";
import { useBookWorkspace } from "@/lib/book-context";
import { accountingCopy } from "@/lib/accounting-copy";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/tools")({
  component: ExistingTools,
});

function ExistingTools() {
  const { book, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <WorkspaceHeader title={copy.workspace_legacy} />
      <Text tone="muted">{copy.workspace_legacy_help}</Text>
      <AccountingWorkspace book={book} locale={locale} />
    </Box>
  );
}
