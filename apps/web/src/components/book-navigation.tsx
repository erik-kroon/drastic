import {
  BookOpen,
  CheckSquare,
  Landmark,
  ReceiptText,
  Wallet,
  BarChart3,
  CalendarCheck,
  Percent,
} from "lucide-react";
import {
  WorkspaceNavigation,
  WorkspaceNavLink,
  WorkspaceSubnavigation,
} from "@open-erp/ui/components/workspace";
import { frontendCopy } from "@/lib/frontend-copy";
import type { Locale } from "@/paraglide/runtime";

export function BookNavigation({
  base,
  pathname,
  locale,
}: {
  base: string;
  pathname: string;
  locale: Locale;
}) {
  const copy = frontendCopy(locale);
  const home = pathname === base || pathname === `${base}/`;
  const reviewing = pathname.includes("/reviews/") || pathname.endsWith("/work");
  const bookkeeping = pathname === `${base}/books`;
  return (
    <>
      <WorkspaceNavigation label={copy.todo} showLabel={false}>
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
        <WorkspaceNavLink href={`${base}/accounts`} active={pathname === `${base}/accounts`}>
          <Landmark size={15} strokeWidth={1.5} aria-hidden="true" />
          {copy.accounts}
        </WorkspaceNavLink>
        <WorkspaceNavLink href={`${base}/sales`} active={pathname === `${base}/sales`}>
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
        {bookkeeping ? (
          <WorkspaceSubnavigation>
            <WorkspaceNavLink href={`${base}/books?view=vouchers`}>
              {copy.vouchers}
            </WorkspaceNavLink>
            <WorkspaceNavLink href={`${base}/books?view=accounts`}>{copy.chart}</WorkspaceNavLink>
          </WorkspaceSubnavigation>
        ) : null}
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
