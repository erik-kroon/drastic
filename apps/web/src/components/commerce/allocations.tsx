import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { readAccounting } from "@/lib/accounting-api";
import { commerceCopy } from "./copy";
import {
  CommandForm,
  Details,
  Evidence,
  Facts,
  Field,
  Lookup,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

export function Allocations(props: CommerceProps) {
  const { locale } = props;
  const copy = commerceCopy(locale);
  const [payment, setPayment] = useState<typeof Commerce.PaymentReference.Type | null>(null);
  const [planId, setPlanId] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.allocations}</Heading>
      <Text tone="muted">{copy.capacityHelp}</Text>
      <Box
        as="form"
        display="grid"
        gap="lg"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const parsed = Schema.decodeUnknownOption(Commerce.PaymentReference)({
            voucherId: fields.get("voucherId"),
            lineId: fields.get("lineId"),
          });
          setInvalid(parsed._tag === "None");
          if (parsed._tag === "Some") setPayment(parsed.value);
        }}
      >
        <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
          <Field name="voucherId" label={copy.voucher} maxLength={128} />
          <Field name="lineId" label={copy.line} maxLength={128} />
        </Box>
        <Box>
          <Button type="submit" size="xl" variant="outline">
            {copy.capacity}
          </Button>
        </Box>
        <Text role="alert">{invalid ? copy.invalid : ""}</Text>
      </Box>
      {payment ? (
        <PaymentAllocation
          {...props}
          key={`${payment.voucherId}:${payment.lineId}`}
          payment={payment}
          onPrepared={setPlanId}
        />
      ) : null}
      <Lookup label={copy.planId} onOpen={setPlanId} />
      {planId ? <AllocationReview {...props} key={planId} id={planId} /> : null}
    </Box>
  );
}
function PaymentAllocation(
  props: CommerceProps & {
    payment: typeof Commerce.PaymentReference.Type;
    onPrepared: (id: string) => void;
  },
) {
  const { book, locale, payment, onPrepared } = props;
  const copy = commerceCopy(locale);
  const capacity = useQuery({
    queryKey: [...commerceKey(book), "payment", payment.voucherId, payment.lineId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/payments/${encodeURIComponent(payment.voucherId)}/lines/${encodeURIComponent(payment.lineId)}/capacity`,
        Commerce.PaymentCapacity,
        { signal },
      );
      checkScope(book, result.scope);
      if (
        result.voucherId !== payment.voucherId ||
        result.lineId !== payment.lineId ||
        result.currency !== book.currency
      )
        throw new Error("Payment capacity mismatch");
      return result;
    },
    retry: false,
  });
  const [legs, setLegs] = useState([0]);
  const [nextLeg, setNextLeg] = useState(1);
  const ready = capacity.isSuccess && !capacity.isFetching;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.capacity}</Heading>
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={capacity.isFetching}
          onClick={() => {
            void capacity.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={capacity.isPending} error={capacity.error} />
      {!ready ? <Text>{copy.waiting}</Text> : null}
      {capacity.data ? (
        <>
          <Text>
            {copy.units} {capacity.data.currency} · {copy.scale}: {capacity.data.currencyScale}
          </Text>
          <Text>
            {copy.amount}: {capacity.data.amountMinor} · {copy.recordedAllocated}:{" "}
            {capacity.data.allocatedMinor} · {copy.remaining}: {capacity.data.remainingMinor}
          </Text>
          <Facts title={copy.facts} value={capacity.data} />
        </>
      ) : null}
      <Details title={copy.prepare}>
        <CommandForm
          {...props}
          path={`${commercePath(book)}/allocation-plans`}
          schema={Commerce.PrepareAllocation}
          output={Commerce.AllocationPlan}
          label={copy.prepare}
          allowed={ready}
          input={(fields) => ({
            ...payment,
            evidenceId: fields.get("evidenceId"),
            rationale: fields.get("rationale"),
            allocations: legs.map((leg) => ({
              invoiceId: fields.get(`invoice-${leg}`),
              amountMinor: fields.get(`amount-${leg}`),
            })),
          })}
          onSuccess={(plan) => onPrepared(plan.id)}
        >
          <Text>{copy.legsHelp}</Text>
          <Text>
            {copy.units} {book.currency}
          </Text>
          {legs.map((leg, index) => (
            <Box
              as="fieldset"
              key={leg}
              display="grid"
              gap="md"
              minWidth="zero"
              borderWidth="thin"
              borderColor="default"
              padding="md"
              margin="none"
            >
              <legend>
                {copy.invoiceId} {index + 1}
              </legend>
              <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
                <Field name={`invoice-${leg}`} label={copy.invoiceId} maxLength={128} />
                <Field name={`amount-${leg}`} label={copy.amount} maxLength={38} />
              </Box>
              <Box>
                <Button
                  type="button"
                  size="xl"
                  variant="outline"
                  disabled={legs.length === 1}
                  onClick={() => setLegs(legs.filter((item) => item !== leg))}
                >
                  {copy.removeLeg} {index + 1}
                </Button>
              </Box>
            </Box>
          ))}
          <Box>
            <Button
              type="button"
              size="xl"
              variant="outline"
              disabled={legs.length >= 50}
              onClick={() => {
                setLegs([...legs, nextLeg]);
                setNextLeg(nextLeg + 1);
              }}
            >
              {copy.addLeg}
            </Button>
          </Box>
          <Field name="evidenceId" label={copy.evidenceId} maxLength={128} />
          <Field name="rationale" label={copy.reason} />
        </CommandForm>
      </Details>
    </Box>
  );
}
function AllocationReview(props: CommerceProps & { id: string }) {
  const { book, locale, id } = props;
  const copy = commerceCopy(locale);
  const view = useQuery({
    queryKey: [...commerceKey(book), "allocation", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/allocation-plans/${encodeURIComponent(id)}`,
        Commerce.AllocationView,
        { signal },
      );
      checkScope(book, result.plan.scope);
      checkScope(book, result.plan.payment.scope);
      if (
        result.plan.id !== id ||
        (result.approval &&
          (result.approval.planId !== id || result.approval.planDigest !== result.plan.digest)) ||
        (result.application &&
          (result.application.planId !== id ||
            result.application.planDigest !== result.plan.digest))
      )
        throw new Error("Allocation review binding mismatch");
      if (result.application) checkScope(book, result.application.scope);
      return result;
    },
    retry: false,
  });
  const ready = view.isSuccess && !view.isFetching;
  const plan = view.data?.plan;
  const approval = view.data?.approval;
  const actionable = ready && view.data?.dependenciesCurrent === true && !view.data.application;
  const approvalCurrent = !!approval && Date.parse(approval.expiresAt) > Date.now();
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.review}</Heading>
      <Text>
        {copy.planId}: {id}
      </Text>
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={view.isFetching}
          onClick={() => {
            void view.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      {!ready ? <Text>{copy.waiting}</Text> : null}
      {plan ? (
        <>
          <Text>
            {copy.digest}: {plan.digest}
          </Text>
          <Text>
            {copy.units} {plan.payment.currency} · {copy.scale}: {plan.payment.currencyScale}
          </Text>
          <Text>
            {copy.total}: {plan.totalMinor} · {copy.remaining}: {plan.paymentRemainingAfterMinor}
          </Text>
          <Text>
            {copy.reason}: {plan.rationale}
          </Text>
          <Facts title={copy.facts} value={plan} />
          <Evidence {...props} reference={plan.evidence} />
          <DataTable
            title={copy.review}
            narrow="stack"
            columns={[
              { id: "invoice", label: copy.document },
              { id: "party", label: copy.name },
              { id: "revision", label: copy.revision },
              { id: "before", label: copy.before, numeric: true },
              { id: "amount", label: copy.amount, numeric: true },
              { id: "after", label: copy.after, numeric: true },
            ]}
            rows={plan.legs.map((leg) => ({
              id: leg.invoiceId,
              cells: [
                `${leg.documentNumber} · ${leg.invoiceId}`,
                leg.counterpartyName,
                leg.revision,
                leg.outstandingBeforeMinor,
                leg.amountMinor,
                leg.outstandingAfterMinor,
              ],
            }))}
          />
          {plan.legs.map((leg, index) => (
            <Details key={leg.invoiceId} title={`${copy.evidence} ${index + 1}`}>
              <Facts title={copy.facts} value={leg} />
              <Evidence {...props} reference={leg.evidence} />
            </Details>
          ))}
          {view.data?.application ? (
            <Box display="grid" gap="md">
              <Text role="status">{copy.applied}</Text>
              <Facts title={copy.facts} value={view.data.application} />
            </Box>
          ) : (
            <>
              <Text>
                {!ready ? copy.waiting : view.data?.dependenciesCurrent ? copy.fresh : copy.stale}
              </Text>
              {book.role === "operator" ? (
                <Details title={copy.approve}>
                  <CommandForm
                    {...props}
                    path={`${commercePath(book)}/allocation-plans/${encodeURIComponent(id)}/approvals`}
                    schema={Commerce.ApproveAllocation}
                    output={Commerce.AllocationApproval}
                    label={copy.approve}
                    allowed={actionable}
                    input={() => ({ version: plan.version, planDigest: plan.digest })}
                  >
                    <Text>
                      {copy.digest}: {plan.digest}
                    </Text>
                    <Box as="label" display="flex" gap="md" alignItems="start">
                      <input type="checkbox" required name="reviewed" />
                      <span>{copy.ack}</span>
                    </Box>
                  </CommandForm>
                </Details>
              ) : (
                <Text>{copy.operatorOnly}</Text>
              )}
              {approval ? (
                <>
                  <Facts title={copy.approval} value={approval} />
                  {!approvalCurrent ? <Text>{copy.expired}</Text> : null}
                  <CommandForm
                    {...props}
                    key={approval.id}
                    path={`${commercePath(book)}/allocation-plans/${encodeURIComponent(id)}/apply`}
                    schema={Commerce.ApplyAllocation}
                    output={Commerce.AllocationReceipt}
                    label={copy.apply}
                    allowed={actionable && approvalCurrent}
                    input={() => ({
                      version: plan.version,
                      planDigest: plan.digest,
                      approvalId: approval.id,
                    })}
                  >
                    <Text>{copy.newProposal}</Text>
                  </CommandForm>
                </>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Box>
  );
}
