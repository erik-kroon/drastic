import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import * as Accounting from "@open-erp/contracts/accounting";
import { BookOpen, CheckSquare, LayoutDashboard, Settings, Layers, Building2 } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectControl } from "@open-erp/ui/components/select";
import { SelectField } from "@open-erp/ui/components/field";
import { Link } from "@open-erp/ui/components/link";
import { Text } from "@open-erp/ui/components/typography";
import {
  Workspace,
  WorkspaceBrand,
  WorkspaceNavigation,
  WorkspaceNavLink,
  WorkspaceScope,
} from "@open-erp/ui/components/workspace";
import { BookContext, workspacePath } from "@/lib/book-context";
import { AccountingStatus } from "@/components/accounting-status";
import { SignOut } from "@/components/accounting-access";
import { bookKey, bookPath, readAccounting, type Books } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import { setLocale, type Locale } from "@/paraglide/runtime";

export function BookWorkspace({
  book,
  books,
  locale,
  children,
}: {
  book: typeof Accounting.Book.Type;
  books: typeof Books.Type;
  locale: Locale;
  children: ReactNode;
}) {
  const copy = accountingCopy(locale);
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const base = workspacePath(book);
  const setup = useQuery({
    queryKey: [...bookKey(book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });
  const navigation = (
    <WorkspaceNavigation label={copy.workspace_navigation} showLabel={false}>
      <WorkspaceNavLink href={`${base}/`} active={pathname === base || pathname === `${base}/`}>
        <LayoutDashboard aria-hidden="true" size={18} strokeWidth={1.5} />
        {copy.workspace_overview}
      </WorkspaceNavLink>
      <WorkspaceNavLink
        href={`${base}/work`}
        active={pathname.includes("/work") || pathname.includes("/reviews/")}
      >
        <CheckSquare aria-hidden="true" size={18} strokeWidth={1.5} />
        {copy.workspace_work}
      </WorkspaceNavLink>
      <WorkspaceNavLink href={`${base}/books`} active={pathname.endsWith("/books")}>
        <BookOpen aria-hidden="true" size={18} strokeWidth={1.5} />
        {copy.workspace_books}
      </WorkspaceNavLink>
      <WorkspaceNavLink href={`${base}/tools`} active={pathname.endsWith("/tools")}>
        <Layers aria-hidden="true" size={18} strokeWidth={1.5} />
        {copy.workspace_legacy}
      </WorkspaceNavLink>
      <WorkspaceNavLink href={`${base}/settings`} active={pathname.endsWith("/settings")}>
        <Settings aria-hidden="true" size={18} strokeWidth={1.5} />
        {copy.workspace_settings}
      </WorkspaceNavLink>
    </WorkspaceNavigation>
  );
  return (
    <Workspace
      brand={
        <WorkspaceBrand
          icon={<BookOpen aria-hidden="true" size={24} />}
          name="OpenERP"
          detail={book.currency}
        />
      }
      navigation={navigation}
      footer={
        <>
          <Link href="/">{copy.workspace_switch}</Link>
          <SignOut locale={locale} />
        </>
      }
      topbar={
        <>
          <WorkspaceScope>
            <Building2 size={18} strokeWidth={1.5} aria-hidden="true" />
            {books.length === 1 ? (
              <Text>{book.name}</Text>
            ) : (
              <SelectControl
                aria-label={copy.journal_book}
                size="comfortable"
                value={`${book.entityId}/${book.id}`}
                options={books.map((item) => ({
                  value: `${item.entityId}/${item.id}`,
                  label: item.name,
                }))}
                onValueChange={(value) => {
                  const selected = books.find((item) => `${item.entityId}/${item.id}` === value);
                  if (selected) void navigate({ to: `${workspacePath(selected)}/` });
                }}
              />
            )}
          </WorkspaceScope>
          <Text tone="muted">
            {book.currency} ·{" "}
            {book.profile === "synthetic-core-v1"
              ? copy.workspace_synthetic
              : copy.workspace_book_context}
          </Text>
        </>
      }
      mobileNavigation={
        <details>
          <summary>{copy.workspace_menu}</summary>
          <Box paddingBlock="md">
            {navigation}
            <Link href="/">{copy.workspace_switch}</Link>
            <SignOut locale={locale} />
          </Box>
        </details>
      }
    >
      <AccountingStatus locale={locale} pending={setup.isPending} error={setup.error} />
      {setup.isError ? (
        <Button
          size="xl"
          variant="outline"
          onClick={() => {
            void setup.refetch();
          }}
        >
          {copy.journal_retry}
        </Button>
      ) : null}
      {setup.data && !setup.isError ? (
        <BookContext value={{ book, setup: setup.data, locale }}>{children}</BookContext>
      ) : null}
    </Workspace>
  );
}

export function LanguagePreference({ locale }: { locale: Locale }) {
  const copy = accountingCopy(locale);
  return (
    <SelectField
      label={copy.language_label}
      value={locale}
      options={[
        { value: "en", label: "English" },
        { value: "sv", label: "Svenska" },
      ]}
      onValueChange={(value) => {
        if (value === "sv" || value === "en") void setLocale(value);
      }}
    />
  );
}
