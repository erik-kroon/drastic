import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import * as Accounting from "@open-erp/contracts/accounting";
import { BookOpen, CheckSquare, Building2 } from "lucide-react";
import { Button } from "@open-erp/ui/components/button";
import { SelectControl } from "@open-erp/ui/components/select";
import { SelectField } from "@open-erp/ui/components/field";
import { Link } from "@open-erp/ui/components/link";
import {
  Workspace,
  WorkspaceBrand,
  WorkspaceAccount,
  WorkspaceMobileNavigation,
} from "@open-erp/ui/components/workspace";
import { BookNavigation } from "@/components/book-navigation";
import { frontendCopy } from "@/lib/frontend-copy";
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
  const labels = frontendCopy(locale);
  const navigation = <BookNavigation base={base} pathname={pathname} locale={locale} />;
  const account = (
    <WorkspaceAccount
      name={book.name}
      detail={`${book.currency} · ${book.profile === "synthetic-core-v1" ? copy.workspace_synthetic : copy.workspace_book_context}`}
    >
      {books.length > 1 ? (
        <SelectControl
          aria-label={copy.journal_book}
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
      ) : null}
      <Link href={`${base}/settings`}>{labels.settings}</Link>
      <Link href="/companies">{copy.workspace_switch}</Link>
      <Link href={`${base}/tools`}>{labels.tools}</Link>
      <SignOut locale={locale} />
    </WorkspaceAccount>
  );
  return (
    <Workspace
      pageKey={pathname}
      brand={
        <WorkspaceBrand
          icon={<BookOpen aria-hidden="true" size={20} strokeWidth={1.5} />}
          name="OpenERP"
        />
      }
      navigation={navigation}
      footer={account}
      mobileNavigation={
        <WorkspaceMobileNavigation
          label={labels.menu}
          closeLabel={labels.close}
          items={[
            {
              label: labels.todo,
              href: `${base}/`,
              active:
                pathname === base ||
                pathname === `${base}/` ||
                pathname.endsWith("/work") ||
                pathname.includes("/reviews/"),
              icon: <CheckSquare size={20} strokeWidth={1.5} aria-hidden="true" />,
            },
            {
              label: labels.accounts,
              href: `${base}/accounts`,
              active: pathname === `${base}/accounts`,
              icon: <Building2 size={20} strokeWidth={1.5} aria-hidden="true" />,
            },
            {
              label: labels.bookkeeping,
              href: `${base}/books`,
              active: pathname === `${base}/books`,
              icon: <BookOpen size={20} strokeWidth={1.5} aria-hidden="true" />,
            },
          ]}
        >
          {navigation}
          {account}
        </WorkspaceMobileNavigation>
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
