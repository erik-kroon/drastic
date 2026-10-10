import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useMatch } from "@tanstack/react-router";
import * as Accounting from "@open-erp/contracts/accounting";
import { BookOpen, CheckSquare, Building2 } from "lucide-react";
import { Button } from "@open-erp/ui/components/button";
import { SelectControl } from "@open-erp/ui/components/select";
import { ChoiceField } from "@open-erp/ui/components/choice-field";
import { Link } from "@open-erp/ui/components/link";
import {
  Workspace,
  WorkspaceCompany,
  WorkspaceNavLink,
  WorkspaceAccount,
  WorkspaceMobileNavigation,
} from "@open-erp/ui/kanon/workspace";
import { BookSearch } from "@/components/book-search";
import { NavIcon } from "@open-erp/ui/components/nav-icon";
import { BookNavigation } from "@/components/book-navigation";
import { frontendCopy } from "@/lib/frontend-copy";
import { BookContext, workspacePath } from "@/lib/book-context";
import { audiences, showsDestination, useAudience, type Audience } from "@/lib/audience";
import { themes, useTheme } from "@/lib/theme";
import { AccountingStatus } from "@/components/accounting-status";
import { SignOut } from "@/components/accounting-access";
import { portfolioReturn } from "@/components/firms/portfolio-return";
import { bookKey, bookPath, readAccounting, type Books } from "@/lib/accounting-api";
import { authClient } from "@/lib/auth-client";
import { SetupWorkspace } from "@open-erp/ui/components/setup-workspace";
import { accountingCopy } from "@/lib/accounting-copy";
import { setLocale, type Locale } from "@/paraglide/runtime";

function isHomePath(pathname: string, base: string) {
  return pathname === base || pathname === `${base}/`;
}

function isTodoPath(pathname: string, base: string) {
  return isHomePath(pathname, base) || pathname.endsWith("/work") || pathname.includes("/reviews/");
}

function BookSwitcher({
  book,
  books,
  label,
}: {
  book: typeof Accounting.Book.Type;
  books: typeof Books.Type;
  label: string;
}) {
  const navigate = useNavigate();

  return (
    <SelectControl
      aria-label={label}
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
  );
}

const audienceLabels = {
  sv: { bureau: "Visa som byrå", client: "Visa som klient", founder: "Visa som företagare" },
  en: { bureau: "View as bureau", client: "View as client", founder: "View as founder" },
} satisfies Record<Locale, Record<Audience, string>>;

// Changes which destinations the shell lists. It never changes what the
// signed-in user may read or do (ADR 0019).
function AudienceSwitcher({
  audience,
  locale,
  onChange,
}: {
  audience: Audience;
  locale: Locale;
  onChange: (audience: Audience) => void;
}) {
  return (
    <SelectControl
      aria-label={locale === "sv" ? "Vy" : "View"}
      value={audience}
      options={audiences.map((value) => ({ value, label: audienceLabels[locale][value] }))}
      onValueChange={(value) => {
        const selected = audiences.find((item) => item === value);

        if (selected) onChange(selected);
      }}
    />
  );
}

const themeLabels = {
  sv: { system: "Utseende: system", light: "Utseende: ljust", dark: "Utseende: mörkt" },
  en: { system: "Appearance: system", light: "Appearance: light", dark: "Appearance: dark" },
} satisfies Record<Locale, Record<(typeof themes)[number], string>>;

function ThemeSwitcher({ locale }: { locale: Locale }) {
  const [theme, setTheme] = useTheme();

  return (
    <SelectControl
      aria-label={locale === "sv" ? "Utseende" : "Appearance"}
      value={theme}
      options={themes.map((value) => ({ value, label: themeLabels[locale][value] }))}
      onValueChange={(value) => {
        const selected = themes.find((item) => item === value);

        if (selected) setTheme(selected);
      }}
    />
  );
}

function PortfolioLink({ book, locale }: { book: typeof Accounting.Book.Type; locale: Locale }) {
  const navigate = useNavigate();

  return (
    <Link
      href="/firms"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const destination = portfolioReturn(book);

        if (!destination) return;
        event.preventDefault();
        void navigate({ to: destination });
      }}
    >
      {locale === "sv" ? "Klientlista" : "Client portfolio"}
    </Link>
  );
}

function AccountMenu(props: {
  book: typeof Accounting.Book.Type;
  books: typeof Books.Type;
  locale: Locale;
  audience: Audience;
  onAudienceChange: (audience: Audience) => void;
}) {
  const { book, locale, audience } = props;

  const base = workspacePath(book);
  const labels = frontendCopy(locale);
  const copy = accountingCopy(locale);

  return (
    <>
      {props.books.length > 1 ? (
        <BookSwitcher book={book} books={props.books} label={copy.journal_book} />
      ) : null}
      <AudienceSwitcher audience={audience} locale={locale} onChange={props.onAudienceChange} />
      <ThemeSwitcher locale={locale} />
      <Link href={`${base}/settings`}>{labels.settings}</Link>
      <Link href="/companies">{copy.workspace_switch}</Link>
      {showsDestination(audience, "portfolio") ? (
        <PortfolioLink book={book} locale={locale} />
      ) : null}
      {showsDestination(audience, "tools") ? (
        <Link href={`${base}/tools`}>{labels.tools}</Link>
      ) : null}
    </>
  );
}

function mobileItems({
  base,
  pathname,
  labels,
  audience,
}: {
  base: string;
  pathname: string;
  labels: ReturnType<typeof frontendCopy>;
  audience: Audience;
}) {
  const items = [
    {
      label: labels.todo,
      href: `${base}/`,
      active: isTodoPath(pathname, base),
      icon: <CheckSquare size={20} strokeWidth={1.5} aria-hidden="true" />,
    },
  ];

  if (showsDestination(audience, "bank"))
    items.push({
      label: labels.accounts,
      href: `${base}/accounts`,
      active: pathname === `${base}/accounts`,
      icon: <Building2 size={20} strokeWidth={1.5} aria-hidden="true" />,
    });

  if (showsDestination(audience, "bookkeeping"))
    items.push({
      label: labels.bookkeeping,
      href: `${base}/books`,
      active: pathname === `${base}/books`,
      icon: <BookOpen size={20} strokeWidth={1.5} aria-hidden="true" />,
    });

  return items;
}

function useWorkspaceLayout(pathname: string, base: string) {
  const digestReview = useMatch({
    from: "/entities/$entityId/books/$bookId/reviews/$planId/$revision",
    shouldThrow: false,
  });

  const sales = useMatch({ from: "/entities/$entityId/books/$bookId/sales", shouldThrow: false });

  return {
    contentInset:
      isHomePath(pathname, base) ||
      digestReview ||
      sales?.search.view === "articles" ||
      sales?.search.view === "orders" ||
      sales?.search.view === "recurring"
        ? ("none" as const)
        : ("page" as const),
    focused: !digestReview && pathname.startsWith(`${base}/reviews/`),
  };
}

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
  const pathname = useLocation({ select: (location) => location.pathname });
  const search = useLocation({ select: (location) => location.searchStr });

  const layout = useWorkspaceLayout(pathname, workspacePath(book));

  const base = workspacePath(book);
  const [scopeBlocked, setScopeBlocked] = useState(true);
  const [audience, setAudience] = useAudience(book);

  const setup = useQuery({
    queryKey: [...bookKey(book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 60_000,
    refetchOnWindowFocus: "always",
  });

  const scopeUnavailable =
    setup.error instanceof Accounting.AccountingError &&
    ["Unauthorized", "Forbidden", "NotFound"].includes(setup.error.code);

  // A later transient error cannot undo an explicit denial or confirm a new mount.
  if (scopeUnavailable && !scopeBlocked) setScopeBlocked(true);
  else if (
    scopeBlocked &&
    setup.isSuccess &&
    setup.isFetchedAfterMount &&
    setup.fetchStatus === "idle"
  ) {
    setScopeBlocked(false);
  }

  const session = useQuery({
    queryKey: ["auth-session"],
    enabled: !scopeBlocked && !scopeUnavailable,
    queryFn: async () => {
      const result = await authClient.getSession();

      if (result.error) throw new Error(result.error.message ?? "Session unavailable");

      return result.data;
    },
    retry: false,
    staleTime: 60_000,
  });

  const labels = frontendCopy(locale);

  const navigation = (
    <BookNavigation
      base={base}
      pathname={pathname}
      search={search}
      locale={locale}
      audience={audience}
      book={book}
      setup={setup.data && !scopeBlocked && !scopeUnavailable ? setup.data : undefined}
    />
  );

  const account = (
    <WorkspaceAccount
      name={
        session.isSuccess && session.data
          ? session.data.user.name
          : locale === "sv"
            ? "Konto"
            : "Account"
      }
    >
      <AccountMenu
        book={book}
        books={books}
        locale={locale}
        audience={audience}
        onAudienceChange={setAudience}
      />
      <SignOut locale={locale} />
    </WorkspaceAccount>
  );

  const content = (
    <>
      <AccountingStatus
        locale={locale}
        pending={setup.isPending || (scopeBlocked && setup.isFetching)}
        error={setup.error}
      />
      {setup.isError ? (
        <Button
          size="xl"
          variant="outline"
          disabled={setup.isFetching}
          onClick={() => {
            void setup.refetch();
          }}
        >
          {copy.journal_retry}
        </Button>
      ) : null}
      {setup.data && !setup.isError && !scopeBlocked && !scopeUnavailable ? (
        <BookContext value={{ book, setup: setup.data, locale, audience }}>{children}</BookContext>
      ) : null}
    </>
  );

  if (pathname === `${base}/setup`) {
    return (
      <SetupWorkspace
        account={
          !scopeBlocked && !scopeUnavailable && session.isSuccess && session.data ? (
            <>
              <span>{`${session.data.user.name},\u00a0`}</span>
              <SignOut locale={locale} compact />
            </>
          ) : null
        }
      >
        {content}
      </SetupWorkspace>
    );
  }

  return (
    <Workspace
      pageKey={pathname}
      contentInset={layout.contentInset}
      focused={layout.focused}
      brand={
        <>
          <WorkspaceCompany name={book.name} href="/companies" />
          {!scopeBlocked && !scopeUnavailable ? <BookSearch book={book} locale={locale} /> : null}
        </>
      }
      navigation={navigation}
      footer={
        <>
          <WorkspaceNavLink href={`${base}/settings`} active={pathname === `${base}/settings`}>
            <NavIcon name="settings" />
            {labels.settings}
          </WorkspaceNavLink>
          {account}
        </>
      }
      mobileNavigation={
        <WorkspaceMobileNavigation
          label={labels.menu}
          closeLabel={labels.close}
          items={mobileItems({ base, pathname, labels, audience })}
        >
          {navigation}
          {account}
        </WorkspaceMobileNavigation>
      }
    >
      {content}
    </Workspace>
  );
}

export function LanguagePreference({ locale }: { locale: Locale }) {
  const copy = accountingCopy(locale);

  return (
    <ChoiceField
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
