import { Api } from "@open-erp/contracts/api";
import { bookScope, httpQuery } from "@/lib/contract-client";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import * as Peppol from "@open-erp/contracts/peppol-exchange";
import { Box } from "@open-erp/ui/components/box";
import { InputField } from "@open-erp/ui/components/field";
import { Link } from "@open-erp/ui/components/link";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { checkScope, CommandForm } from "./shared";

type CreditDecision = { evidence: typeof Accounting.Evidence.Type; reason: string };

export function PeppolCreditRecovery(props: {
  review: typeof Peppol.Review.Type;
  creditId?: string;
}) {
  const { book, locale, setup } = useBookWorkspace();
  const navigate = useNavigate();
  const base = `${bookPath(book)}/commerce`;
  const [decision, setDecision] = useState<CreditDecision | null>(null);
  const [creditDate, setCreditDate] = useState(setup.today);

  const period = setup.periods.find(
    (item) => !item.locked && item.startsOn <= creditDate && item.endsOn >= creditDate,
  );

  const issue = useQuery({
    queryKey: [...bookKey(book), "peppol-credit-original", props.review.source.reference.id],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        (client) =>
          client.arLegalIssue.getArLegalIssue({
            params: { ...bookScope(book), id: props.review.source.reference.id },
          }),
        Ar.ArLegalIssueReceipt,
        { signal },
      );

      checkScope(book, result.scope);

      if (
        result.id !== props.review.source.reference.id ||
        result.digest !== props.review.source.digest
      )
        throw new Error("Credit source mismatch");

      return result;
    },
  });

  const capacity = useQuery({
    queryKey: [...bookKey(book), "peppol-credit-capacity", issue.data?.id, period?.id, creditDate],
    enabled: issue.isSuccess && !!period && !props.creditId,
    retry: false,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({
        accountingProfileId: issue.data?.accountingProfileId ?? "",
        accountingPeriodId: period?.id ?? "",
        creditDate,
      });

      const result = await readAccounting(
        (client) =>
          client.customerCreditNotes.getCustomerCreditCapacity({
            params: { ...bookScope(book), id: props.review.source.reference.id },
            query: httpQuery(
              Api.groups.customerCreditNotes.endpoints.getCustomerCreditCapacity,
              `${query.toString()}`,
            ),
          }),
        Credits.CustomerCreditCapacity,
        { signal },
      );

      checkScope(book, result.scope);

      if (
        result.originalLegalIssueId !== props.review.source.reference.id ||
        result.originalIssueDigest !== props.review.source.digest ||
        result.accountingProfileId !== issue.data?.accountingProfileId
      )
        throw new Error("Credit capacity mismatch");

      return result;
    },
  });

  const credit = useQuery({
    queryKey: [...bookKey(book), "peppol-credit-review", props.creditId],
    enabled: !!props.creditId,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        (client) =>
          client.customerCreditNotes.getCustomerCreditReview({
            params: { ...bookScope(book), id: props.creditId ?? "" },
          }),
        Credits.CustomerCreditView,
        { signal },
      );

      checkScope(book, result.review.scope);

      if (
        result.review.id !== props.creditId ||
        result.review.originalSnapshot.id !== props.review.source.reference.id ||
        result.review.originalSnapshot.digest !== props.review.source.digest
      )
        throw new Error("Credit review mismatch");

      return result;
    },
  });

  if (props.creditId)
    return (
      <Box display="grid" gap="md">
        <AccountingStatus locale={locale} pending={credit.isPending} error={credit.error} />
        {credit.data && !credit.isError ? (
          <>
            <Text>Kreditutkast</Text>
            <Text>
              {formatMinorAmount(
                credit.data.review.totals.grossMinor,
                props.review.source.scale,
                locale,
              )}{" "}
              {props.review.source.currency}
            </Text>
            <Text>Originalfakturan ändras inte.</Text>
            <Link href={`${workspacePath(book)}/sales?view=drafts`}>Förbered en ny faktura</Link>
          </>
        ) : null}
      </Box>
    );

  const capacityVisible =
    issue.isSuccess && !issue.isError && !!period && capacity.isSuccess && !capacity.isError;

  const available =
    capacityVisible &&
    capacity.isSuccess &&
    !capacity.data.completelyExhausted &&
    !capacity.data.unpaidCapacity.blocked;

  return (
    <Box display="grid" gap="md">
      <Text>Kreditera {props.review.source.legalNumber}</Text>
      <Text>Originalfakturan ändras inte.</Text>
      <InputField
        type="date"
        name="creditDate"
        label="Datum"
        value={creditDate}
        onChange={(event) => setCreditDate(event.target.value)}
      />
      <AccountingStatus
        locale={locale}
        pending={issue.isPending || (!!period && capacity.isPending)}
        error={issue.error ?? capacity.error}
      />
      {!period ? <Text role="alert">Bokföringsperioden är stängd eller saknas.</Text> : null}
      {capacityVisible && capacity.data ? (
        <>
          <Text>Hela fakturan</Text>
          {capacity.data.lines.map((line) => (
            <Text key={line.originalLineId}>
              {line.description}, −
              {formatMinorAmount(line.remainingGrossMinor, props.review.source.scale, locale)}
            </Text>
          ))}
          <Text>
            −
            {formatMinorAmount(
              capacity.data.totals.remainingGrossMinor,
              props.review.source.scale,
              locale,
            )}{" "}
            {props.review.source.currency}
          </Text>
        </>
      ) : null}
      {!decision ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${bookPath(book)}/evidence`}
          schema={Accounting.CreateEvidence}
          output={Accounting.Evidence}
          label="Spara anledning"
          canSubmit={available}
          input={(fields) => ({
            title: formText(fields, "reason"),
            content: formText(fields, "reason"),
            mediaType: "text/plain",
            origin: `Kreditbeslut för ${props.review.source.legalNumber}`,
          })}
          onSuccess={(evidence) => setDecision({ evidence, reason: evidence.title })}
        >
          <InputField name="reason" label="Anledning" required />
        </CommandForm>
      ) : null}
      {decision && available && period && issue.data ? (
        <CommandForm
          book={book}
          locale={locale}
          path={`${base}/customer-credit-reviews`}
          schema={Credits.PrepareCustomerCredit}
          output={Credits.CustomerCreditReview}
          label="Skapa kreditutkast"
          canSubmit={!capacity.isFetching}
          input={() => ({
            profile: "se-domestic-b2b-sek-25-accrual-credit-v1",
            originalLegalIssueId: issue.data?.id,
            originalIssueDigest: issue.data?.digest,
            accountingProfileId: capacity.data?.accountingProfileId,
            accountingProfileDigest: capacity.data?.accountingProfileDigest,
            accountingPeriodId: period.id,
            voucherSeries: "A",
            creditEvidenceId: decision.evidence.id,
            creditDate,
            reason: decision.reason,
            selectedLines: capacity.data?.lines
              .filter((line) => !line.exhausted)
              .map((line) => ({
                originalLineId: line.originalLineId,
                creditedNetMinor: line.remainingNetMinor,
                creditedTaxMinor: line.remainingTaxMinor,
              })),
            acknowledgeNoRefundOrCreditBalance: true,
            acknowledgeVatReturnConsequenceUnobserved: true,
          })}
          onSuccess={(result) => {
            void navigate({
              to: "/entities/$entityId/books/$bookId/sales",
              params: { entityId: book.entityId, bookId: book.id },
              search: {
                view: "peppol",
                record: props.review.source.reference.id,
                review: props.review.id,
                credit: result.id,
              },
            });
          }}
        />
      ) : null}
    </Box>
  );
}

function formText(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" ? value.trim() : "";
}
