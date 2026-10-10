import { useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import { NavIcon } from "@open-erp/ui/components/nav-icon";
import { WorkspaceNavigation, WorkspaceNavLink } from "@open-erp/ui/kanon/workspace";
import { attentionQueryOptions } from "@/lib/attention";
import { type Audience, type NavDestination, showsDestination } from "@/lib/audience";
import { frontendCopy } from "@/lib/frontend-copy";
import type { Locale } from "@/paraglide/runtime";

export function BookNavigation(props: {
  base: string;
  pathname: string;
  search: string;
  locale: Locale;
  audience: Audience;
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type | undefined;
}) {
  const { base, pathname, locale } = props;
  const shows = (destination: NavDestination) => showsDestination(props.audience, destination);
  const client = useQueryClient();
  const copy = frontendCopy(locale);
  const home = pathname === base || pathname === `${base}/`;
  const reviewing = pathname.includes("/reviews/") || pathname.endsWith("/work");
  const documents = new URLSearchParams(props.search).get("view") === "documents";

  const adoption =
    pathname === `${base}/history` && new URLSearchParams(props.search).has("adoption");

  const bookkeeping = pathname === `${base}/books` || adoption;

  const waiting = useQuery({
    ...attentionQueryOptions(props.book, { status: "open" }),
    enabled: Boolean(props.setup),
  });

  const preloadAccounts = () => {
    const setup = props.setup;

    if (pathname === `${base}/accounts` || !setup) return;
    void import("@/components/bank-account-workspace")
      .then((module) =>
        client.prefetchQuery(
          module.bankWorkspaceOptions(props.book, module.bankWorkspaceParams(setup, {})),
        ),
      )
      .catch(() => undefined);
  };

  const preloadSales = () => {
    if (pathname === `${base}/sales` || !props.setup) return;
    void import("@/components/commerce/sales-workspace")
      .then((module) =>
        client.prefetchQuery(
          module.salesRegisterOptions(
            props.book,
            new URLSearchParams({ status: "all", sort: "newest", page: "1", q: "" }),
          ),
        ),
      )
      .catch(() => undefined);
  };

  const work = (["bank", "sales", "purchases", "documents"] as const).some(shows);
  const accounting = (["bookkeeping", "tax", "reports", "closing"] as const).some(shows);

  return (
    <>
      <WorkspaceNavigation label={copy.todo} showLabel={false}>
        <WorkspaceNavLink
          href={`${base}/`}
          active={home || reviewing}
          current={home}
          count={waiting.data?.items.length}
        >
          <NavIcon name="todo" />
          {copy.todo}
        </WorkspaceNavLink>
        <WorkspaceNavLink href={`${base}/overview`} active={pathname === `${base}/overview`}>
          <NavIcon name="overview" />
          {locale === "sv" ? "Översikt" : "Overview"}
        </WorkspaceNavLink>
      </WorkspaceNavigation>
      {work && (
        <WorkspaceNavigation label={locale === "sv" ? "Arbete" : "Work"}>
          {shows("bank") && (
            <WorkspaceNavLink
              href={`${base}/accounts`}
              aria-label={`Bank, ${props.book.name.trim() || (locale === "sv" ? "aktuell bok" : "current book")}`}
              active={pathname === `${base}/accounts`}
              onPointerEnter={preloadAccounts}
              onFocus={preloadAccounts}
            >
              <NavIcon name="bank" />
              Bank
            </WorkspaceNavLink>
          )}
          {shows("sales") && (
            <WorkspaceNavLink
              href={`${base}/sales`}
              active={pathname === `${base}/sales`}
              onPointerEnter={preloadSales}
              onFocus={preloadSales}
            >
              <NavIcon name="sales" />
              {locale === "sv" ? "Försäljning" : "Sales"}
            </WorkspaceNavLink>
          )}
          {shows("purchases") && (
            <WorkspaceNavLink
              href={`${base}/purchases`}
              active={pathname === `${base}/purchases` && !documents}
            >
              <NavIcon name="purchases" />
              {copy.purchases}
            </WorkspaceNavLink>
          )}
          {shows("documents") && (
            <WorkspaceNavLink
              href={`${base}/purchases?view=documents`}
              active={pathname === `${base}/purchases` && documents}
            >
              <NavIcon name="documents" />
              {locale === "sv" ? "Dokument" : "Documents"}
            </WorkspaceNavLink>
          )}
        </WorkspaceNavigation>
      )}
      {accounting && (
        <AccountingNavigation
          base={base}
          pathname={pathname}
          locale={locale}
          shows={shows}
          bookkeeping={bookkeeping}
        />
      )}
    </>
  );
}

function AccountingNavigation(props: {
  base: string;
  pathname: string;
  locale: Locale;
  shows: (destination: NavDestination) => boolean;
  bookkeeping: boolean;
}) {
  const { base, pathname, locale } = props;
  const copy = frontendCopy(locale);

  return (
    <WorkspaceNavigation label={locale === "sv" ? "Redovisning" : "Accounting"}>
      {props.shows("bookkeeping") && (
        <WorkspaceNavLink href={`${base}/books`} active={props.bookkeeping}>
          <NavIcon name="bookkeeping" />
          {copy.bookkeeping}
        </WorkspaceNavLink>
      )}
      {props.shows("tax") && (
        <WorkspaceNavLink href={`${base}/tax`} active={pathname === `${base}/tax`}>
          <NavIcon name="tax" />
          {locale === "sv" ? "Skatt och löner" : "Tax and payroll"}
        </WorkspaceNavLink>
      )}
      {props.shows("reports") && (
        <WorkspaceNavLink href={`${base}/reports`} active={pathname === `${base}/reports`}>
          <NavIcon name="reports" />
          {copy.reports}
        </WorkspaceNavLink>
      )}
      {props.shows("closing") && (
        <WorkspaceNavLink href={`${base}/closing`} active={pathname === `${base}/closing`}>
          <NavIcon name="closing" />
          {copy.closing}
        </WorkspaceNavLink>
      )}
    </WorkspaceNavigation>
  );
}
