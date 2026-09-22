import { createFileRoute } from "@tanstack/react-router";
import { Box } from "@open-erp/ui/components/box";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { WorkspaceHeader, WorkspacePanel } from "@open-erp/ui/components/workspace";
import { useBookWorkspace } from "@/lib/book-context";
import { BookReadiness } from "@/components/book-readiness";
import { accountingCopy } from "@/lib/accounting-copy";
import { WorkList } from "@/components/work-list";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/")({ component: Overview });

function Overview() {
  const { book, setup, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <WorkspaceHeader>
        <Heading level={1}>{copy.workspace_overview}</Heading>
        <Text tone="muted">{copy.workspace_overview_help}</Text>
      </WorkspaceHeader>
      <WorkspacePanel>
        <Heading>{copy.workspace_work}</Heading>
        <Text>{copy.workspace_work_help}</Text>
        <WorkList filters={{ status: "open" }} compact />
      </WorkspacePanel>
      {setup.blockers.map((blocker) => (
        <Text key={blocker} role="alert">
          {blocker}
        </Text>
      ))}
      <BookReadiness book={book} locale={locale} />
    </Box>
  );
}
