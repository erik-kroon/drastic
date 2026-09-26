import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Closing from "@open-erp/contracts/closing";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { closingCopy } from "./copy";

export function ClosingFacts({
  basis,
  locale,
}: {
  basis: typeof Closing.ClosingReadiness.Type;
  locale: Locale;
}) {
  const copy = closingCopy(locale);

  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>{basis.inventoryScope ? copy.familyScope : copy.bankOnlyFamilyScope}</Text>
      <Heading>{copy.checks}</Heading>
      <DataTable
        title={copy.checks}
        narrow="stack"
        columns={[
          { id: "check", label: copy.check },
          { id: "passed", label: copy.passed },
          { id: "detail", label: copy.detail },
        ]}
        rows={basis.checks.map((check) => ({
          id: check.code,
          cells: [check.code, check.passed ? copy.passed : copy.blocked, check.detail],
        }))}
      />
      {basis.inventory ? (
        <>
          <Text>
            {copy.inventorySaved}: {basis.inventory.bankAccountIds.join(", ") || copy.none}
          </Text>
          <Text>
            {copy.evidence}: {basis.inventory.evidenceId} · {basis.inventory.actorId}
          </Text>
        </>
      ) : (
        <Text>{copy.missingInventory}</Text>
      )}
      <Heading>{copy.familyInventory}</Heading>
      {basis.families ? (
        basis.families.map((family) => (
          <details key={family.family}>
            <summary>
              {copy.familyLabels[family.family]} · {family.passed ? copy.passed : copy.blocked}
            </summary>
            <Box display="grid" gap="sm" paddingBlock="md" minWidth="zero">
              <Text>
                {family.declaration
                  ? copy.familyStatuses[family.declaration.status]
                  : copy.familyMissing}
              </Text>
              {family.declaration ? (
                <>
                  <Text>
                    {copy.familyDate}: {family.declaration.reviewedOn} · {basis.inventory?.actorId}
                  </Text>
                  <Text>
                    {copy.familyEvidence}: {family.declaration.evidenceId}
                  </Text>
                  <Text>{family.declaration.rationale}</Text>
                </>
              ) : null}
              <DataTable
                title={copy.familyLabels[family.family]}
                narrow="stack"
                columns={[
                  { id: "check", label: copy.check },
                  { id: "status", label: copy.passed },
                  { id: "detail", label: copy.detail },
                ]}
                rows={family.checks.map((check) => ({
                  id: check.code,
                  cells: [
                    check.code,
                    check.status === "unavailable"
                      ? copy.familyUnavailable
                      : check.status === "passed"
                        ? copy.passed
                        : copy.blocked,
                    check.detail,
                  ],
                }))}
              />
            </Box>
          </details>
        ))
      ) : (
        <Text>{copy.bankOnlyFamilyScope}</Text>
      )}
      {basis.inventory?.revision ? (
        <Text>
          {copy.familyRevision}: {basis.inventory.revision}
        </Text>
      ) : null}
      <details>
        <summary>{copy.dependencies}</summary>
        <DataTable
          title={copy.dependencies}
          narrow="stack"
          columns={[
            { id: "field", label: copy.check },
            { id: "value", label: copy.detail },
          ]}
          rows={Object.entries(basis.dependencies).map(([field, value]) => ({
            id: field,
            cells: [
              field,
              typeof value === "object" && value !== null ? JSON.stringify(value) : (value ?? "—"),
            ],
          }))}
        />
      </details>
      <Heading>{copy.ownerTax}</Heading>
      {basis.ownerTaxStatus ? (
        <>
          <Text>
            {copy.ownerReviewCounts}: {basis.ownerTaxStatus.owners.unresolvedReviewCount} /{" "}
            {basis.ownerTaxStatus.owners.unlinkedRecordCount}
          </Text>
          <Text>
            {copy.expenseReviewCount}: {basis.ownerTaxStatus.expenseTax.missingOrStaleReviewCount}
          </Text>
          <Text>
            {copy.expenseKnownCount}: {basis.ownerTaxStatus.expenseTax.sourceCount}
          </Text>
          <Text>{copy.unpaidAllowed}</Text>
          {basis.ownerTaxStatus.vatReturns ? (
            <>
              <Text>
                {copy.vatReviewCounts}: {basis.ownerTaxStatus.vatReturns.sourceCount} /{" "}
                {basis.ownerTaxStatus.vatReturns.draftCount}
              </Text>
              <Text>
                {copy.vatDependency}: {basis.ownerTaxStatus.vatReturns.basisDigest}
              </Text>
              <Text>{copy.vatBoundary}</Text>
            </>
          ) : (
            <Text>{copy.missingVatScope}</Text>
          )}
        </>
      ) : (
        <Text>{copy.missingProviderScope}</Text>
      )}
      <Heading>{copy.statutory}</Heading>
      <Box as="ul" display="grid" gap="sm">
        {basis.statutoryBlockers.map((blocker) => (
          <Box as="li" key={blocker}>
            {blocker}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function ClosingReview({
  book,
  id,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
}) {
  const copy = closingCopy(locale);
  const keys = useRef(new Map<string, string>());
  const queryClient = useQueryClient();
  const path = `${bookPath(book)}/closing-proposals/${encodeURIComponent(id)}`;

  const view = useQuery({
    queryKey: [...bookKey(book), "closing-proposal", id],
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Closing.ClosingProposalView, { signal });

      if (
        result.proposal.id !== id ||
        result.proposal.scope.bookId !== book.id ||
        result.proposal.scope.entityId !== book.entityId
      )
        throw new Error("Closing proposal scope mismatch");

      return result;
    },
  });

  const approve = useMutation({
    mutationFn: (digest: string) => {
      const endpoint = `${path}/approvals`;

      return readAccounting(
        endpoint,
        Closing.ClosingApproval,
        mutationOptions(endpoint, JSON.stringify({ digest }), keys.current),
      );
    },
  });

  const execute = useMutation({
    mutationFn: (input: typeof Closing.ExecuteClosing.Type) => {
      const endpoint = `${path}/executions`;

      return readAccounting(
        endpoint,
        Closing.ClosingReceipt,
        mutationOptions(endpoint, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookKey(book) }),
  });

  const busy = approve.isPending || execute.isPending;
  const proposal = view.data?.proposal;
  const receipt = view.data?.receipt ?? execute.data;

  const currentnessKnown =
    view.isSuccess && view.fetchStatus === "idle" && view.isFetchedAfterMount;

  const ready = currentnessKnown && view.data?.dependenciesCurrent && !receipt;
  const approvalRetry = approve.isError ? approve.variables : undefined;
  const executionRetry = execute.isError ? execute.variables : undefined;
  const approvalRequired = closingApprovalRequired(execute.error);

  const canApprove =
    (ready || approvalRetry !== undefined) && (!execute.isError || approvalRequired);

  const approvalDisabled = !canApprove || busy;

  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.review}</Heading>
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      <Box>
        <Button
          variant="outline"
          size="xl"
          disabled={view.isFetching || busy}
          onClick={() => {
            void view.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      {proposal ? (
        <>
          <ClosingProposalDetails proposal={proposal} locale={locale} />
          <ClosingCurrentness
            completed={Boolean(receipt)}
            known={currentnessKnown}
            current={view.data?.dependenciesCurrent === true}
            locale={locale}
          />
          {approvalRetry !== undefined || executionRetry ? <Text>{copy.retryRequest}</Text> : null}
          {!receipt && book.role === "operator" ? (
            <Box
              as="form"
              display="grid"
              gap="md"
              onSubmit={(event) => {
                event.preventDefault();

                if (canApprove && !approve.isPending && !execute.isPending) {
                  if (approvalRetry !== undefined) {
                    approve.mutate(approvalRetry);

                    return;
                  }

                  // A definitive rejection permits a new approval; uncertain writes keep their key.
                  if (approvalRequired) {
                    keys.current.delete(
                      `${path}/approvals:${JSON.stringify({ digest: proposal.digest })}`,
                    );
                    execute.reset();
                  }

                  approve.mutate(proposal.digest);
                }
              }}
            >
              <label>
                <input type="checkbox" required disabled={approvalDisabled} /> {copy.confirm}
              </label>
              <Box>
                <Button type="submit" size="xl" disabled={approvalDisabled}>
                  {approvalRetry !== undefined ? copy.retryApproval : copy.approval}
                </Button>
              </Box>
            </Box>
          ) : null}
          <AccountingStatus
            write
            locale={locale}
            pending={approve.isPending}
            error={approve.error}
          />
          {approve.data && !receipt ? (
            <>
              <Text>
                {copy.approvedBy}: {approve.data.actorId} · {copy.expires}: {approve.data.expiresAt}
              </Text>
              <Box>
                <Button
                  size="xl"
                  disabled={(!ready && !executionRetry) || busy}
                  onClick={() => {
                    if (execute.isPending || approve.isPending) return;

                    if (executionRetry) execute.mutate(executionRetry);
                    else if (ready && approve.data)
                      execute.mutate({ digest: proposal.digest, approvalId: approve.data.id });
                  }}
                >
                  {executionRetry ? copy.retryExecution : copy.execute}
                </Button>
              </Box>
            </>
          ) : null}
          <AccountingStatus
            write
            locale={locale}
            pending={execute.isPending}
            error={execute.error}
          />
        </>
      ) : null}
      {receipt ? <ClosingReceiptView book={book} receipt={receipt} locale={locale} /> : null}
    </Box>
  );
}

function ClosingReceiptView({
  book,
  receipt,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  receipt: typeof Closing.ClosingReceipt.Type;
  locale: Locale;
}) {
  const copy = closingCopy(locale);
  const [certificateId, setCertificateId] = useState("");

  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>
        {copy.receipt}: {receipt.id}
      </Text>
      <Text>
        {receipt.action === "close" ? copy.closeAction : copy.reopenAction} · {copy.version}:{" "}
        {receipt.periodVersion} · {receipt.committedAt}
      </Text>
      <Text>
        {copy.approvedBy}: {receipt.approvedBy}
      </Text>
      <Text>
        {copy.invalidated}: {receipt.invalidatedCertificates} / {receipt.invalidatedReports}
      </Text>
      <Text>{copy.immutable}</Text>
      {receipt.certificateId ? (
        <Box>
          <Button
            variant="outline"
            size="xl"
            onClick={() => setCertificateId(receipt.certificateId ?? "")}
          >
            {copy.viewCertificate}
          </Button>
        </Box>
      ) : null}
      {certificateId ? <CertificateView book={book} id={certificateId} locale={locale} /> : null}
    </Box>
  );
}

function CertificateView({
  book,
  id,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
}) {
  const copy = closingCopy(locale);

  const certificate = useQuery({
    queryKey: [...bookKey(book), "closing-certificate", id],
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/closing-certificates/${encodeURIComponent(id)}`,
        Closing.ClosingCertificateView,
        { signal },
      );

      if (
        result.certificate.id !== id ||
        result.certificate.proposal.scope.bookId !== book.id ||
        result.certificate.proposal.scope.entityId !== book.entityId
      )
        throw new Error("Certificate scope mismatch");

      return result;
    },
  });

  return (
    <Box display="grid" gap="sm">
      <Text>
        {copy.certificate}: {id}
      </Text>
      <AccountingStatus locale={locale} pending={certificate.isPending} error={certificate.error} />
      <Button
        variant="outline"
        disabled={certificate.isFetching}
        onClick={() => {
          void certificate.refetch();
        }}
      >
        {copy.refresh}
      </Button>
      <Text>
        {certificate.isSuccess &&
        certificate.fetchStatus === "idle" &&
        certificate.isFetchedAfterMount
          ? certificate.data.current
            ? copy.currentCertificate
            : copy.invalidCertificate
          : copy.currentnessUnknown}
      </Text>
      <Text>{copy.warning}</Text>
    </Box>
  );
}

export function ClosingHistoryPanel({
  book,
  periodId,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  periodId: string;
  locale: Locale;
}) {
  const copy = closingCopy(locale);
  const [after, setAfter] = useState("");

  const history = useQuery({
    queryKey: [...bookKey(book), "closing-history", periodId, after],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/periods/${encodeURIComponent(periodId)}/closing-history${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Closing.ClosingHistory,
        { signal },
      );

      if (
        result.items.some(
          (receipt) =>
            receipt.periodId !== periodId ||
            receipt.scope.bookId !== book.id ||
            receipt.scope.entityId !== book.entityId,
        )
      )
        throw new Error("Closing history scope mismatch");

      return result;
    },
  });

  return (
    <details>
      <summary>{copy.history}</summary>
      <Box display="grid" gap="lg" paddingBlock="lg">
        <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
        {history.data?.items.length === 0 ? <Text>{copy.emptyHistory}</Text> : null}
        {history.data?.items.map((receipt) => (
          <ClosingReceiptView key={receipt.id} book={book} receipt={receipt} locale={locale} />
        ))}
        <Box display="flex" gap="md" flexWrap="wrap">
          {after ? (
            <Button variant="outline" size="xl" onClick={() => setAfter("")}>
              {copy.first}
            </Button>
          ) : null}
          {history.data?.next ? (
            <Button
              variant="outline"
              size="xl"
              disabled={history.isFetching}
              onClick={() => setAfter(history.data?.next ?? "")}
            >
              {copy.next}
            </Button>
          ) : null}
        </Box>
      </Box>
    </details>
  );
}

function ClosingCurrentness({
  known,
  current,
  locale,
  completed,
}: {
  known: boolean;
  current: boolean;
  locale: Locale;
  completed: boolean;
}) {
  const copy = closingCopy(locale);

  if (completed) return null;

  return <Text>{!known ? copy.currentnessUnknown : current ? copy.current : copy.stale}</Text>;
}

function closingApprovalRequired(error: unknown) {
  return error instanceof Accounting.AccountingError && error.code === "ApprovalRequired";
}

function ClosingProposalDetails({
  proposal,
  locale,
}: {
  proposal: typeof Closing.ClosingProposal.Type;
  locale: Locale;
}) {
  const copy = closingCopy(locale);

  return (
    <>
      <Text>
        {proposal.periodId} · {proposal.action === "close" ? copy.closeAction : copy.reopenAction}
      </Text>
      <Text>
        {copy.reason}: {proposal.reason}
      </Text>
      <Text>
        {copy.proposalId}: {proposal.id}
      </Text>
      <Box display="grid" minWidth="zero">
        <textarea aria-label={copy.digest} value={proposal.digest} readOnly rows={2} cols={16} />
      </Box>
      <ClosingFacts basis={proposal.basis} locale={locale} />
      {proposal.action === "reopen" ? <Text>{copy.reopenHelp}</Text> : null}
    </>
  );
}
