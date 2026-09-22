import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Box } from "@open-erp/ui/components/box";
import { Link } from "@open-erp/ui/components/link";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingAccess } from "@/components/accounting-access";
import { BookWorkspace } from "@/components/book-workspace";

import { accountingCopy } from "@/lib/accounting-copy";
import { usePageLocale } from "@/lib/use-page-locale";

export const Route = createFileRoute("/entities/$entityId/books/$bookId")({
  component: ScopedWorkspace,
});

function ScopedWorkspace() {
  const { entityId, bookId } = Route.useParams();
  const locale = usePageLocale();
  const copy = accountingCopy(locale);
  return (
    <AccountingAccess key={`${entityId}/${bookId}`} locale={locale}>
      {(books) => {
        const book = books.find((item) => item.entityId === entityId && item.id === bookId);
        if (!book)
          return (
            <Box
              maxWidth="content"
              centered
              padding="lg"
              paddingBlock="2xl"
              display="grid"
              gap="lg"
            >
              <Text role="alert">{copy.workspace_scope_denied}</Text>
              <Link href="/">{copy.workspace_switch}</Link>
            </Box>
          );
        return (
          <BookWorkspace key={`${entityId}/${bookId}`} book={book} books={books} locale={locale}>
            <Outlet />
          </BookWorkspace>
        );
      }}
    </AccountingAccess>
  );
}
