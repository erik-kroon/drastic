import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Box } from "@open-erp/ui/components/box";
import { Link } from "@open-erp/ui/components/link";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { WorkspacePanel } from "@open-erp/ui/components/workspace";
import { AccountingAccess, SignOut } from "@/components/accounting-access";
import { LanguagePreference } from "@/components/book-workspace";
import { workspacePath } from "@/lib/book-context";
import { accountingCopy } from "@/lib/accounting-copy";
import { usePageLocale } from "@/lib/use-page-locale";
import { statementCopy } from "@/components/statement-preview/copy";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  const locale = usePageLocale();
  const copy = accountingCopy(locale);
  return (
    <AccountingAccess locale={locale}>
      {(books) => {
        const single = books.length === 1 ? books[0] : undefined;
        if (single)
          return (
            <Navigate
              to="/entities/$entityId/books/$bookId"
              params={{ entityId: single.entityId, bookId: single.id }}
              replace
            />
          );
        return (
          <Box maxWidth="content" centered padding="lg" paddingBlock="2xl" display="grid" gap="xl">
            <Text>OpenERP</Text>
            <Heading level={1}>{copy.workspace_choose}</Heading>
            <Text tone="muted">{copy.workspace_choose_help}</Text>
            {books.length === 0 ? (
              <Text>{copy.journal_no_books}</Text>
            ) : (
              books.map((book) => (
                <WorkspacePanel key={`${book.entityId}/${book.id}`}>
                  <Link href={`${workspacePath(book)}/`}>{book.name}</Link>
                  <Text tone="muted">
                    {book.currency} · {book.entityId} / {book.id}
                  </Text>
                </WorkspacePanel>
              ))
            )}
            <LanguagePreference locale={locale} />
            <Link href="/intake">{statementCopy(locale).title}</Link>
            <SignOut locale={locale} />
          </Box>
        );
      }}
    </AccountingAccess>
  );
}
