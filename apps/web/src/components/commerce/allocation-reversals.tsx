import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Reversal from "@open-erp/contracts/commerce-allocation-reversals";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { CommerceAllocationReversalReview } from "./allocation-reversal-review";
import { allocationReversalCopy } from "./allocation-reversal-copy";
import {
  CommandForm,
  Details,
  Facts,
  Field,
  Lookup,
  Pager,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

export function CommerceAllocationReversals(props: CommerceProps & { receiptId?: string }) {
  return (
    <ReversalWorkspace
      key={`${props.book.entityId}:${props.book.id}:${props.receiptId ?? ""}`}
      {...props}
    />
  );
}

function ReversalWorkspace(props: CommerceProps & { receiptId?: string }) {
  const { book, locale } = props;
  const copy = allocationReversalCopy(locale);
  const [receiptId, setReceiptId] = useState(props.receiptId ?? "");
  const [planId, setPlanId] = useState("");
  const [reportId, setReportId] = useState("");
  const [after, setAfter] = useState("");

  const history = useQuery({
    queryKey: [...commerceKey(book), "unallocation-history", after],
    queryFn: ({ signal }) =>
      readAccounting(
        `${commercePath(book)}/allocation-reversal-plans${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Reversal.CommerceAllocationReversalList,
        { signal },
      ),
    retry: false,
  });

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.title}</Heading>
      <Text>{copy.boundary}</Text>
      <Text tone="muted">{copy.impact}</Text>
      <Lookup
        label={copy.receipt}
        onOpen={(id) => {
          setReceiptId(id);
          setPlanId("");
        }}
      />
      {receiptId ? (
        <AllocationReleaseStatus {...props} key={receiptId} id={receiptId} onOpen={setPlanId} />
      ) : null}
      <Lookup label={copy.plan} onOpen={setPlanId} />
      {planId ? <CommerceAllocationReversalReview {...props} key={planId} id={planId} /> : null}
      <Details title={copy.history}>
        <Text>{copy.live}</Text>
        <Box>
          <Button
            variant="outline"
            disabled={history.isFetching}
            onClick={() => {
              void history.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </Box>
        <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
        {history.isSuccess ? (
          <>
            <DataTable
              title={copy.history}
              narrow="stack"
              columns={[
                { id: "id", label: copy.plan },
                { id: "receipt", label: copy.receipt },
                { id: "created", label: copy.created },
                { id: "state", label: copy.state },
              ]}
              rows={history.data.items.map((item) => ({
                id: item.id,
                cells: [
                  <Button key="open" variant="outline" onClick={() => setPlanId(item.id)}>
                    {item.id}
                  </Button>,
                  item.receiptId,
                  item.createdAt,
                  item.execution ? copy.reversed : copy.pending,
                ],
              }))}
            />
            {history.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
            <Pager locale={locale} first={!after} next={history.data.next} onPage={setAfter} />
          </>
        ) : null}
      </Details>
      <Details title={copy.report}>
        <Lookup label={copy.report} onOpen={setReportId} />
        {reportId ? (
          <CommerceRegisterAllocationStatus {...props} key={reportId} id={reportId} />
        ) : null}
      </Details>
    </Box>
  );
}

export function AllocationReleaseStatus(
  props: CommerceProps & { id: string; onOpen?: (id: string) => void },
) {
  const { book, locale, id } = props;
  const copy = allocationReversalCopy(locale);

  const status = useQuery({
    queryKey: [...commerceKey(book), "allocation-release-status", id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/allocation-receipts/${encodeURIComponent(id)}/status`,
        Reversal.CommerceAllocationStatus,
        { signal },
      );

      checkScope(book, result.original.scope);

      if (result.original.id !== id) throw new Error("Allocation receipt identity mismatch");

      if (result.reversal) {
        checkScope(book, result.reversal.scope);

        if (result.reversal.receiptId !== id) throw new Error("Unallocation target mismatch");
      }

      return result;
    },
    retry: false,
  });

  const ready = status.isSuccess && status.isFetchedAfterMount && status.fetchStatus === "idle";

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>
        {copy.receipt}: {id}
      </Heading>
      <Box>
        <Button
          variant="outline"
          disabled={status.isFetching}
          onClick={() => {
            void status.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={status.isPending} error={status.error} />
      {status.data ? (
        <>
          <Text role="status">
            {!ready ? copy.unknown : status.data.active ? copy.active : copy.reversed}
          </Text>
          <Facts title={copy.original} value={status.data.original} />
          {status.data.reversal ? (
            <Facts title={copy.execution} value={status.data.reversal} />
          ) : null}
          {status.data.plans.map((plan) =>
            props.onOpen ? (
              <Box key={plan.id}>
                <Button variant="outline" onClick={() => props.onOpen?.(plan.id)}>
                  {copy.plan}: {plan.id}
                </Button>
                <Text>
                  {plan.reason} · {plan.createdAt}
                </Text>
              </Box>
            ) : (
              <Text key={plan.id}>
                {plan.id} · {plan.reason}
              </Text>
            ),
          )}
          {props.onOpen ? (
            <Details title={copy.prepare}>
              <CommandForm
                {...props}
                path={`${commercePath(book)}/allocation-reversal-plans`}
                schema={Reversal.PrepareCommerceAllocationReversal}
                output={Reversal.CommerceAllocationReversalPlan}
                label={copy.prepare}
                allowed={ready && status.data.active}
                input={(fields) => ({ receiptId: id, reason: fields.get("reason") })}
                onSuccess={(plan) => props.onOpen?.(plan.id)}
              >
                <Field name="reason" label={copy.reason} />
              </CommandForm>
            </Details>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

export function CommerceRegisterAllocationStatus(props: CommerceProps & { id: string }) {
  const { book, locale, id } = props;
  const copy = allocationReversalCopy(locale);

  const status = useQuery({
    queryKey: [...commerceKey(book), "register-allocation-status", id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/register-reports/${encodeURIComponent(id)}/allocation-status`,
        Reversal.CommerceRegisterAllocationStatus,
        { signal },
      );

      if (result.reportId !== id) throw new Error("Register report identity mismatch");

      return result;
    },
    retry: false,
  });

  return (
    <Box display="grid" gap="md">
      <Box>
        <Button
          variant="outline"
          disabled={status.isFetching}
          onClick={() => {
            void status.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={status.isPending} error={status.error} />
      <Text role="status">
        {!status.isSuccess || status.isFetching || !status.isFetchedAfterMount
          ? copy.unknown
          : status.data.allocationDependenciesCurrent
            ? copy.reportCurrent
            : copy.reportStale}
      </Text>
    </Box>
  );
}
