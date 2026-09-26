import {
  BookOpen,
  LayoutDashboard,
  CheckSquare,
  Landmark,
  ReceiptText,
  Wallet,
  BarChart3,
  CalendarCheck,
  Percent,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import {
  WorkspaceNavigation,
  WorkspaceNavLink,
  WorkspaceSubnavigation,
} from "@open-erp/ui/components/workspace";
import { frontendCopy } from "@/lib/frontend-copy";
import type { Locale } from "@/paraglide/runtime";

export function BookNavigation(props: {
  base: string;
  pathname: string;
  locale: Locale;
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type | undefined;
}) {
  const { base, pathname, locale } = props;
  const client = useQueryClient();
  const copy = frontendCopy(locale);
  const home = pathname === base || pathname === `${base}/`;
  const reviewing = pathname.includes("/reviews/") || pathname.endsWith("/work");
  const bookkeeping = pathname === `${base}/books`;

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

  return (
    <>
      <WorkspaceNavigation label={copy.todo} showLabel={false}>
        <WorkspaceNavLink href={`${base}/overview`} active={pathname === `${base}/overview`}>
          <LayoutDashboard size={15} strokeWidth={1.5} aria-hidden="true" />
          {locale === "sv" ? "Översikt" : "Overview"}
        </WorkspaceNavLink>
        <WorkspaceNavLink href={`${base}/`} active={home || reviewing} current={home}>
          <CheckSquare size={15} strokeWidth={1.5} aria-hidden="true" />
          {copy.todo}
        </WorkspaceNavLink>
        {home || reviewing ? (
          <WorkspaceSubnavigation>
            <WorkspaceNavLink
              href={`${base}/work`}
              active={reviewing}
              current={pathname.endsWith("/work")}
            >
              {copy.proposals}
            </WorkspaceNavLink>
          </WorkspaceSubnavigation>
        ) : null}
      </WorkspaceNavigation>
      <WorkspaceNavigation label={copy.company}>
        <WorkspaceNavLink
          href={`${base}/accounts`}
          active={pathname === `${base}/accounts`}
          onPointerEnter={preloadAccounts}
          onFocus={preloadAccounts}
        >
          <Landmark size={15} strokeWidth={1.5} aria-hidden="true" />
          {copy.accounts}
        </WorkspaceNavLink>
        <WorkspaceNavLink
          href={`${base}/sales`}
          active={pathname === `${base}/sales`}
          onPointerEnter={preloadSales}
          onFocus={preloadSales}
        >
          <ReceiptText size={15} strokeWidth={1.5} aria-hidden="true" />
          {copy.sales}
        </WorkspaceNavLink>
        <WorkspaceNavLink href={`${base}/purchases`} active={pathname === `${base}/purchases`}>
          <Wallet size={15} strokeWidth={1.5} aria-hidden="true" />
          {copy.purchases}
        </WorkspaceNavLink>
        <WorkspaceNavLink href={`${base}/books`} active={bookkeeping}>
          <BookOpen size={15} strokeWidth={1.5} aria-hidden="true" />
          {copy.bookkeeping}
        </WorkspaceNavLink>

        <WorkspaceNavLink href={`${base}/tax`} active={pathname === `${base}/tax`}>
          <Percent size={15} strokeWidth={1.5} aria-hidden="true" />
          {copy.tax}
        </WorkspaceNavLink>
        <WorkspaceNavLink href={`${base}/reports`} active={pathname === `${base}/reports`}>
          <BarChart3 size={15} strokeWidth={1.5} aria-hidden="true" />
          {copy.reports}
        </WorkspaceNavLink>
        <WorkspaceNavLink href={`${base}/closing`} active={pathname === `${base}/closing`}>
          <CalendarCheck size={15} strokeWidth={1.5} aria-hidden="true" />
          {copy.closing}
        </WorkspaceNavLink>
      </WorkspaceNavigation>
    </>
  );
}
