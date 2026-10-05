import { createFileRoute, defaultStringifySearch } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { RecurringDraftRecovery } from "@/components/commerce/recurring-draft-recovery";
import { RecurringRegister } from "@/components/commerce/recurring-register";
import * as Sales from "@open-erp/contracts/sales-register";
import { SalesWorkspace } from "@/components/commerce/sales-workspace";
import { PeppolReviewWorkspace } from "@/components/commerce/peppol-review";
import { CollectionsWorkspace } from "@/components/commerce/collections";
import { ReminderRetainedWorkspace } from "@/components/commerce/reminder-retained-review";
import { SalesOrders } from "@/components/commerce/sales-orders";
import { SalesNavigation } from "@/components/commerce/sales-navigation";
import { CatalogArticles } from "@/components/commerce/catalog-articles";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { WorkReturnSearch, OwnerReturnSearch } from "@/lib/work-return";
import { Link } from "@open-erp/ui/components/link";
import { PageContent } from "@open-erp/ui/components/accounting-page";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/sales")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({
      ...Sales.SalesQuery.fields,
      page: Schema.optional(
        Schema.Union([
          Sales.SalesQuery.fields.page,
          Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999999 })),
        ]),
      ),
      view: Schema.optional(Schema.String),
      record: Schema.optional(Schema.String),
      reminder: Schema.optional(Accounting.Identifier),
      job: Schema.optional(Accounting.Identifier),
      work: WorkReturnSearch,
      returnTo: OwnerReturnSearch,
      kind: Schema.optional(Schema.Literals(["draft", "invoice"])),
      stage: Schema.optional(Schema.Literals(["review", "payments"])),
      review: Schema.optional(Schema.String),
      credit: Schema.optional(Accounting.Identifier),
      allocation: Schema.optional(Schema.String),
      release: Schema.optional(Schema.String),
      paymentPage: Schema.optional(
        Schema.Union([
          Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/)),
          Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999999 })),
        ]),
      ),
      paymentHistoryPage: Schema.optional(
        Schema.Union([
          Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,5}$/)),
          Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999999 })),
        ]),
      ),
    }),
  ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();

  if (search.view === "peppol")
    return (
      <PeppolReviewWorkspace
        issueId={search.record}
        reviewId={search.review}
        creditId={search.credit}
      />
    );

  if (search.view === "recurring") return <RecurringPage />;

  if (search.view === "orders") return <OrdersPage />;

  if (search.view === "articles") return <CatalogPage />;

  if (search.view === "collections" && search.reminder)
    return <ReminderRetainedWorkspace id={search.reminder} />;

  if (search.view === "collections") return <CollectionsPage />;

  return (
    <SalesWorkspace
      search={{
        ...search,
        page: search.page === undefined ? undefined : String(search.page),
        paymentPage: search.paymentPage === undefined ? undefined : String(search.paymentPage),
        paymentHistoryPage:
          search.paymentHistoryPage === undefined ? undefined : String(search.paymentHistoryPage),
        work: search.work,
      }}
    />
  );
}

function OrdersPage() {
  const { book, locale } = useBookWorkspace();
  const search = Route.useSearch();

  return (
    <SalesOrders
      book={book}
      locale={locale}
      navigation={<SalesNavigation view="orders" work={search.work} returnTo={search.returnTo} />}
    />
  );
}

function CatalogPage() {
  const { book, locale } = useBookWorkspace();
  const search = Route.useSearch();

  return (
    <CatalogArticles
      book={book}
      locale={locale}
      navigation={<SalesNavigation view="articles" work={search.work} returnTo={search.returnTo} />}
    />
  );
}

function CollectionsPage() {
  const { book, locale } = useBookWorkspace();
  const search = Route.useSearch();

  return (
    <PageContent>
      <Link
        href={`${workspacePath(book)}/sales${defaultStringifySearch({ ...search, view: undefined, record: undefined })}`}
      >
        {locale === "sv" ? "Till fakturor" : "Back to invoices"}
      </Link>
      <CollectionsWorkspace book={book} locale={locale} reminderId={search.reminder} />
    </PageContent>
  );
}

function RecurringPage() {
  const { book, locale } = useBookWorkspace();
  const search = Route.useSearch();

  if (!search.record) return <RecurringRegister work={search.work} returnTo={search.returnTo} />;

  return (
    <PageContent>
      <RecurringDraftRecovery
        book={book}
        locale={locale}
        agreementId={search.record}
        jobId={search.job}
      />
    </PageContent>
  );
}
