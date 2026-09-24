import { HistoricalBases } from "./basis";
import { AdmitOpenItems } from "./admission";
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Sie from "@open-erp/contracts/sie-import";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  mutationOptions,
  readAccounting,
  isUncertainWriteError,
} from "@/lib/accounting-api";

export function SieStagingRun({ id, plan }: { id: string; plan: typeof Sie.SiePlan.Type }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const cache = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const path = `${bookPath(book)}/sie-runs/${encodeURIComponent(id)}`;
  const queryKey = [...bookKey(book), "sie-run", id];
  const refresh = () => cache.invalidateQueries({ queryKey });
  const run = useQuery({
    queryKey,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Sie.SieRun, { signal });
      if (result.id !== id || result.planId !== plan.id || result.planDigest !== plan.digest)
        throw new Error("SIE run identity mismatch");
      return result;
    },
  });
  const admission = useQuery({
    queryKey: [...bookKey(book), "historical-items-plan", plan.id],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/sie-plans/${encodeURIComponent(plan.id)}/historical-items`,
        Historical.PlanItemAdmission,
        { signal },
      );
      if (result && (result.sourcePlanId !== plan.id || result.planDigest !== plan.digest))
        throw new Error("Historical admission identity mismatch");
      return result;
    },
  });
  const advance = useMutation({
    mutationFn: (input: { fence: string; planDigest: string; firstOrdinal: number }) =>
      readAccounting(
        `${path}/chunks`,
        Sie.SieChunk,
        mutationOptions(`${path}/chunks`, JSON.stringify(input), keys.current),
      ),
    onSuccess: refresh,
  });
  const lease = useMutation({
    mutationFn: (action: "pause" | "resume") =>
      readAccounting(
        `${path}/lease`,
        Sie.SieFence,
        mutationOptions(`${path}/lease`, JSON.stringify({ action }), keys.current),
      ),
    onSuccess: async () => {
      keys.current.clear();
      await refresh();
    },
  });
  const uncertain = isUncertainWriteError(advance.error);
  const leaseUncertain = isUncertainWriteError(lease.error);
  const disabled = book.role !== "operator" || advance.isPending || lease.isPending;
  return (
    <Box display="grid" gap="md">
      <AccountingStatus locale={locale} pending={run.isPending} error={run.error} />
      {run.data ? (
        <>
          <Text>
            {run.data.nextOrdinal - 1} / {run.data.voucherCount}{" "}
            {sv ? "källverifikationer förberedda" : "source vouchers staged"}
          </Text>
          {run.data.status === "staged" ? (
            <Text>
              {sv
                ? "Källmaterialet är förberett. Historikval och bokföringsgodkännande återstår."
                : "Source staging is complete. Historical basis selection and posting approval are still required."}
            </Text>
          ) : (
            <Box display="flex" flexWrap="wrap" gap="md">
              <Button
                disabled={
                  disabled || leaseUncertain || (run.data.status !== "running" && !uncertain)
                }
                onClick={() => {
                  if (uncertain && advance.variables) advance.mutate(advance.variables);
                  else if (run.data)
                    advance.mutate({
                      fence: run.data.fence,
                      planDigest: run.data.planDigest,
                      firstOrdinal: run.data.nextOrdinal,
                    });
                }}
              >
                {uncertain
                  ? sv
                    ? "Återförsök samma steg"
                    : "Retry same step"
                  : sv
                    ? "Förbered nästa del"
                    : "Stage next batch"}
              </Button>
              <Button
                variant="outline"
                disabled={disabled || uncertain}
                onClick={() =>
                  lease.mutate(leaseUncertain && lease.variables ? lease.variables : "resume")
                }
              >
                {sv ? "Återuppta körningen" : "Resume run"}
              </Button>
              <Button
                variant="outline"
                disabled={disabled || uncertain || leaseUncertain || run.data.status === "paused"}
                onClick={() => lease.mutate("pause")}
              >
                {sv ? "Pausa" : "Pause"}
              </Button>
            </Box>
          )}
        </>
      ) : null}
      <AccountingStatus locale={locale} pending={admission.isPending} error={admission.error} />
      {admission.isSuccess ? <AdmissionStatus admission={admission.data} sv={sv} /> : null}
      {admission.isSuccess && admission.data === null && run.data?.status === "staged" ? (
        <AdmitOpenItems
          plan={plan}
          onSaved={(result) => {
            cache.setQueryData([...bookKey(book), "historical-items-plan", plan.id], result);
          }}
        />
      ) : null}
      <HistoricalBases sourceRunId={id} plan={plan} staged={run.data?.status === "staged"} />
      <AccountingStatus locale={locale} pending={advance.isPending} error={advance.error} write />
      <AccountingStatus locale={locale} pending={lease.isPending} error={lease.error} write />
      <Box>
        <Button
          variant="outline"
          disabled={run.isFetching || disabled}
          onClick={() => {
            void run.refetch();
            void admission.refetch();
          }}
        >
          {sv ? "Läs in aktuell status" : "Refresh current status"}
        </Button>
      </Box>
    </Box>
  );
}

function AdmissionStatus({
  admission,
  sv,
}: {
  admission: typeof Historical.PlanItemAdmission.Type;
  sv: boolean;
}) {
  if (!admission)
    return (
      <Text>
        {sv ? "Historiskt register har inte sparats." : "Historical register has not been saved."}
      </Text>
    );
  return (
    <Box display="grid" gap="sm">
      <Text>{`${sv ? "Historiskt register sparat" : "Historical register saved"}: ${admission.openItems.length}. ${sv ? "Ingen bokföringseffekt." : "No financial posting effect."}`}</Text>
      <Text>
        {admission.chronology === "unknown"
          ? sv
            ? "Betalningskronologin är okänd. Saknade betalningar har inte återskapats."
            : "Payment chronology is unknown. Missing payments have not been reconstructed."
          : sv
            ? "Betalningskronologin bygger på källans datum."
            : "Payment chronology uses the supplied source dates."}
      </Text>
      <Text>
        {sv ? "Sparad grund" : "Saved rationale"}: {admission.rationale}
      </Text>
      <details>
        <summary>
          {sv ? "Registerkvitto och betalningshistorik" : "Register receipt and payment history"}
        </summary>
        <Box display="grid" gap="sm">
          <Text>
            {sv ? "Kvitto" : "Receipt"}: {admission.id}
          </Text>
          <Text>
            {sv ? "Sparat" : "Saved"}: {admission.admittedAt}
          </Text>
          <Text>
            {sv ? "Betalningar" : "Payments"}: {admission.payments.length}.{" "}
            {sv ? "Matchningar" : "Matches"}: {admission.matches.length}.
          </Text>
          {admission.payments.map((payment) => (
            <Text key={payment.sourceIdentity}>
              {payment.sourceIdentity} · {payment.sourceAccount} · {payment.amountMinor}{" "}
              {payment.currency} {sv ? "i minsta valutaenhet" : "minor units"} ·{" "}
              {payment.sourceDate ?? (sv ? "Okänt datum" : "Unknown date")} · {payment.basis}
            </Text>
          ))}
          {admission.matches.map((match) => (
            <Text key={match.sourceIdentity}>
              {match.sourceIdentity} · {match.paymentIdentity} → {match.itemIdentity} ·{" "}
              {match.amountMinor} {sv ? "i minsta valutaenhet" : "minor units"} ·{" "}
              {match.sourceDate ?? (sv ? "Okänt datum" : "Unknown date")} · {match.basis}
            </Text>
          ))}
        </Box>
      </details>
    </Box>
  );
}
