import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Settlement from "@open-erp/contracts/settlements";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { settlementCopy } from "./copy";
import { AllocationReview } from "./review";
import { CapacityReports } from "./report";
import type { BankCandidateSelection } from "@/components/bank-match-candidates/results";
import { bankCandidateCopy } from "@/components/bank-match-candidates/copy";

export function BankAllocations({
  book,
  setup,
  locale,
  candidate,
}: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  candidate?: BankCandidateSelection | null;
}) {
  const copy = settlementCopy(locale);
  const [planId, setPlanId] = useState<string | null>(null);
  return (
    <details id="bank-allocations" tabIndex={-1}>
      <summary>{copy.title}</summary>
      <Box display="grid" gap="2xl" paddingBlock="xl" minWidth="zero">
        <Heading>{copy.title}</Heading>
        <Text>{copy.warning}</Text>
        <CapacityReports book={book} setup={setup} locale={locale} />
        <AllocationForm book={book} setup={setup} locale={locale} candidate={candidate} onCreated={setPlanId} />
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("planId");
            if (Schema.is(Accounting.Identifier)(id)) setPlanId(id);
          }}
        >
          <InputField
            label={copy.planId}
            name="planId"
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
          <Box>
            <Button type="submit" size="xl" variant="outline">
              {copy.loadPlan}
            </Button>
          </Box>
        </Box>
        {planId ? <AllocationReview key={planId} book={book} id={planId} locale={locale} /> : null}
      </Box>
    </details>
  );
}

function AllocationForm(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  candidate?: BankCandidateSelection | null;
  onCreated: (id: string) => void;
}) {
  const { book, setup, locale, candidate } = props;
  const copy = settlementCopy(locale);
  const candidateCopy = bankCandidateCopy(locale);
  const [seed, setSeed] = useState<BankCandidateSelection | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [legs, setLegs] = useState(["first"]);
  const [error, setError] = useState("");
  const keys = useRef(new Map<string, string>());
  const mutation = useMutation({
    mutationFn: (input: typeof Settlement.PrepareBankAllocation.Type) => {
      const path = `${bookPath(book)}/bank-allocation-plans`;
      return readAccounting(
        path,
        Settlement.BankAllocationPlan,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (plan) => props.onCreated(plan.id),
  });
  const startDraft = (nextSeed: BankCandidateSelection | null) => {
    if (mutation.isPending) return;
    setSeed(nextSeed);
    setLegs(["first"]);
    setError("");
    mutation.reset();
    keys.current.clear();
    setDraftVersion((version) => version + 1);
  };
  const accounts = setup.accounts
    .filter((account) => account.active || account.id === seed?.accountId)
    .map((account) => ({ value: account.id, label: `${account.code} · ${account.name} · ${account.id}` }));
  if (seed && !accounts.some((account) => account.value === seed.accountId)) {
    accounts.push({ value: seed.accountId, label: `${seed.accountId} · ${candidateCopy.unavailableAccount}` });
  }
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const result = Schema.decodeUnknownOption(Settlement.PrepareBankAllocation)({
          accountId: fields.get("accountId"),
          reason: fields.get("reason"),
          ambiguityAcknowledged: fields.get("acknowledged") === "on",
          legs: legs.map((id) => ({
            statementId: fields.get(`${id}-statement`),
            rowOrdinal: Number(fields.get(`${id}-ordinal`)),
            voucherId: fields.get(`${id}-voucher`),
            lineId: fields.get(`${id}-line`),
            amountMinor: fields.get(`${id}-amount`),
          })),
        });
        if (result._tag === "None") {
          setError(copy.invalid);
          return;
        }
        setError("");
        mutation.mutate(result.value);
      }}
    >
      <Heading>{copy.prepare}</Heading>
      {candidate || seed ? <Box display="grid" gap="md" minWidth="zero">
        <Text>{candidateCopy.seedWarning}</Text>
        <Text>{candidateCopy.discardWarning}</Text>
        {candidate ? <Box display="grid" gap="sm" minWidth="zero">
          <Text>{candidateCopy.queuedTitle}: {candidate.accountId} · {candidate.statementId} / {candidate.rowOrdinal} · {candidate.voucherId} / {candidate.lineId}</Text>
          <Box><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => startDraft(candidate)}>
            {candidateCopy.startSeed}
          </Button></Box>
        </Box> : null}
        {seed ? <>
          <Text>{candidateCopy.seededTitle}: {seed.statementId} / {seed.rowOrdinal} · {seed.voucherId} / {seed.lineId}</Text>
          <InputField label={candidateCopy.digest} value={seed.discoveryDigest} readOnly />
        </> : null}
        <Box><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => startDraft(null)}>
          {candidateCopy.startBlank}
        </Button></Box>
      </Box> : null}
      <Box
        key={draftVersion}
        as="fieldset"
        disabled={mutation.isPending || mutation.isSuccess}
        borderWidth="none"
        padding="none"
        margin="none"
        display="grid"
        gap="lg"
        minWidth="zero"
      >
        <SelectField
          label={copy.account}
          name="accountId"
          required
          defaultValue={seed?.accountId}
          options={accounts}
        />
        <InputField label={copy.reason} name="reason" maxLength={2000} required />
        {legs.map((id, index) => (
          <Box key={id} as="fieldset" display="grid" gap="md" minWidth="zero" padding="lg">
            <legend>
              {copy.leg} {index + 1}
            </legend>
            <Box display="grid" columns={1} columnsAtSm={2} gap="md">
              <InputField
                label={copy.statement}
                name={`${id}-statement`}
                defaultValue={id === "first" ? seed?.statementId : undefined}
                required
                pattern="[a-z][a-z0-9_\-]{2,127}"
              />
              <InputField
                label={copy.ordinal}
                name={`${id}-ordinal`}
                defaultValue={id === "first" ? seed?.rowOrdinal : undefined}
                type="number"
                min={1}
                max={10000}
                step={1}
                required
              />
              <InputField
                label={copy.voucher}
                name={`${id}-voucher`}
                defaultValue={id === "first" ? seed?.voucherId : undefined}
                required
                pattern="[a-z][a-z0-9_\-]{2,127}"
              />
              <InputField
                label={copy.line}
                name={`${id}-line`}
                defaultValue={id === "first" ? seed?.lineId : undefined}
                required
                pattern="[a-z][a-z0-9_\-]{2,127}"
              />
              <InputField
                label={copy.amount}
                name={`${id}-amount`}
                required
                pattern="-?[1-9][0-9]{0,37}"
              />
            </Box>
            <Box>
              <Button
                type="button"
                variant="outline"
                disabled={legs.length === 1}
                onClick={() => setLegs(legs.filter((leg) => leg !== id))}
              >
                {copy.remove} {index + 1}
              </Button>
            </Box>
          </Box>
        ))}
        <Box>
          <Button
            type="button"
            variant="outline"
            disabled={legs.length >= 100}
            onClick={() => setLegs([...legs, crypto.randomUUID()])}
          >
            {copy.add}
          </Button>
        </Box>
        <InputField label={copy.acknowledge} type="checkbox" name="acknowledged" required />
        <Box>
          <Button type="submit" size="xl">
            {copy.prepare}
          </Button>
        </Box>
      </Box>
      <Text role="status">{error}</Text>
      <AccountingStatus locale={locale} pending={mutation.isPending} error={mutation.error} write />
      {mutation.data ? (
        <Box display="grid" gap="md">
          <Text>
            {copy.planId}: {mutation.data.id}
          </Text>
          <Text>
            {copy.receipt}: {mutation.data.receipt.key}
          </Text>
          <Box>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => startDraft(null)}
            >
              {copy.newPlan}
            </Button>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
