import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Sources from "@open-erp/contracts/source-intake";
import { ArrowLeft, Upload, FileText } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import {
  PageAction,
  PageCaption,
  PageEmpty,
  TaskRow,
  TaskSection,
} from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { BankReport } from "@/components/bank-report";
import { BankStatementReview } from "@/components/bank-statement";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";

export function BankingWorkspace({
  recordId,
  onOpen,
}: {
  recordId?: string;
  onOpen: (id: string) => void;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const [statement, setStatement] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const period = setup.periods.at(-1);
  const sources = useInfiniteQuery({
    queryKey: [...bookKey(book), "bank-source-register"],
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) =>
      readAccounting(
        `${bookPath(book)}/source-occurrences${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Sources.SourceInventory,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const reconcile = useMutation({
    mutationFn: (input: typeof Bank.ReconcileBank.Type) => {
      const path = `${bookPath(book)}/bank-reconciliations`;
      return readAccounting(
        path,
        Bank.BankReconciliation,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (report) => onOpen(report.id),
  });
  const imported =
    sources.data?.pages.flatMap((page) => page.items).filter((item) => item.admission !== null) ??
    [];
  if (recordId)
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => onOpen("")}>
            <ArrowLeft size={14} />
            {labels.backToReconciliation}
          </Button>
        </Box>
        <BankReport book={book} locale={locale} id={recordId} />
      </Box>
    );
  if (statement)
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => setStatement(null)}>
            <ArrowLeft size={14} />
            {labels.allStatements}
          </Button>
        </Box>
        <BankStatementReview book={book} locale={locale} id={statement} />
      </Box>
    );
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={labels.reconcileYourAccounts}
        subtitle={labels.compareTheBooksWithYour}
        action={
          <PageAction href={`${workspacePath(book)}/accounts?view=imports`}>
            <Upload size={14} />
            {labels.importStatement}
          </PageAction>
        }
      />
      <RecordSection title={labels.runAReconciliation}>
        <Box
          as="form"
          display="grid"
          gap="lg"
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            reconcile.mutate(
              Schema.decodeUnknownSync(Bank.ReconcileBank)({
                accountId: fields.get("accountId"),
                startsOn: fields.get("start"),
                endsOn: fields.get("end"),
              }),
            );
          }}
        >
          <Box display="grid" columns={3} gap="lg">
            <SelectField
              name="accountId"
              label={labels.account}
              required
              options={setup.accounts
                .filter((account) => account.active)
                .map((account) => ({
                  value: account.id,
                  label: `${account.code} · ${account.name}`,
                }))}
            />
            <InputField
              name="start"
              label={labels.from}
              type="date"
              required
              defaultValue={period?.startsOn}
            />
            <InputField
              name="end"
              label={labels.to}
              type="date"
              required
              defaultValue={period?.endsOn}
            />
          </Box>
          <Box>
            <Button type="submit" disabled={reconcile.isPending}>
              {labels.reconcilePeriod}
            </Button>
          </Box>
          <AccountingStatus locale={locale} pending={reconcile.isPending} error={reconcile.error} />
        </Box>
      </RecordSection>
      <TaskSection title={labels.importedStatements}>
        <AccountingStatus locale={locale} pending={sources.isPending} error={sources.error} />
        {sources.isSuccess && !imported.length ? (
          <PageEmpty title={labels.importYourFirstStatement} detail={labels.reviewACsvFileBefore} />
        ) : null}
        {imported.map((item) => (
          <Box key={item.occurrence.id}>
            <TaskRow
              href={`${workspacePath(book)}/accounts?view=imports`}
              icon={<FileText size={15} />}
              title={item.occurrence.filename}
              detail={item.admission?.admittedAt.slice(0, 10) ?? ""}
            />
            <Button
              variant="ghost"
              onClick={() => setStatement(item.admission?.imported.statement.id ?? null)}
            >
              {labels.viewTransactions}
            </Button>
          </Box>
        ))}
        {sources.hasNextPage ? (
          <Button
            variant="outline"
            onClick={() => {
              void sources.fetchNextPage();
            }}
          >
            {labels.loadMore}
          </Button>
        ) : null}
      </TaskSection>
      <PageCaption>{labels.importedBalancesAreNotA}</PageCaption>
    </Box>
  );
}

const english = {
  backToReconciliation: "Back to reconciliation",
  allStatements: "All statements",
  reconcileYourAccounts: "Reconcile your accounts",
  compareTheBooksWithYour: "Compare the books with your imported statements.",
  importStatement: "Import statement",
  runAReconciliation: "Run a reconciliation",
  account: "Account",
  from: "From",
  to: "To",
  reconcilePeriod: "Reconcile period",
  importedStatements: "Imported statements",
  importYourFirstStatement: "Import your first statement",
  reviewACsvFileBefore: "Review a CSV file before adding its transactions.",
  viewTransactions: "View transactions",
  loadMore: "Load more",
  importedBalancesAreNotA:
    "Imported balances are not a live bank feed. Missing coverage is shown in the reconciliation.",
};
const swedish: typeof english = {
  backToReconciliation: "Till avstämning",
  allStatements: "Alla kontoutdrag",
  reconcileYourAccounts: "Stäm av dina konton",
  compareTheBooksWithYour: "Jämför bokföringen med importerade kontoutdrag.",
  importStatement: "Importera kontoutdrag",
  runAReconciliation: "Ny avstämning",
  account: "Konto",
  from: "Från",
  to: "Till",
  reconcilePeriod: "Stäm av perioden",
  importedStatements: "Importerade kontoutdrag",
  importYourFirstStatement: "Importera ditt första kontoutdrag",
  reviewACsvFileBefore: "Granska en CSV-fil innan transaktionerna läggs till.",
  viewTransactions: "Visa transaktioner",
  loadMore: "Läs in fler",
  importedBalancesAreNotA:
    "Importerade saldon är inte ett direktanslutet banksaldo. Saknade underlag visas i avstämningen.",
};
