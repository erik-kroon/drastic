import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectField, InputField } from "@open-erp/ui/components/field";
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
  Pager,
  checkScope,
  commerceKey,
  commercePath,
  type CommerceProps,
} from "./shared";

export function Counterparties(props: CommerceProps) {
  const { book, locale } = props;
  const copy = commerceCopy(locale);
  const [after, setAfter] = useState("");
  const [selected, setSelected] = useState("");
  const page = useQuery({
    queryKey: [...commerceKey(book), "counterparties", after],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/counterparties${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Commerce.CounterpartyPage,
        { signal },
      );
      result.items.forEach((party) => checkScope(book, party.scope));
      return result;
    },
    retry: false,
  });
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.parties}</Heading>
      <Text tone="muted">{copy.sourceNote}</Text>
      <Details title={copy.createParty}>
        <CommandForm
          {...props}
          path={`${commercePath(book)}/counterparties`}
          schema={Commerce.CreateCounterparty}
          output={Commerce.CounterpartyRevision}
          label={copy.createParty}
          input={(fields) => ({
            kind: "synthetic_counterparty_v1",
            externalKey: fields.get("externalKey"),
            role: fields.get("role"),
            displayName: fields.get("displayName"),
            evidenceId: fields.get("evidenceId"),
            reason: fields.get("reason"),
          })}
          onSuccess={(party) => setSelected(party.id)}
        >
          <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
            <Field name="externalKey" label={copy.externalKey} maxLength={200} />
            <Field name="displayName" label={copy.name} maxLength={200} />
            <SelectField
              name="role"
              label={copy.role}
              required
              defaultValue="customer"
              options={[
                { value: "customer", label: copy.customer },
                { value: "supplier", label: copy.supplier },
                { value: "both", label: copy.both },
              ]}
            />
            <Field name="evidenceId" label={copy.evidenceId} maxLength={128} />
          </Box>
          <Field name="reason" label={copy.reason} />
        </CommandForm>
      </Details>
      <Lookup label={copy.open} onOpen={setSelected} />
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={page.isFetching}
          onClick={() => {
            void page.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={page.isPending} error={page.error} />
      {page.data ? (
        <>
          <DataTable
            title={copy.parties}
            narrow="stack"
            columns={[
              { id: "name", label: copy.name },
              { id: "role", label: copy.role },
              { id: "revision", label: copy.revision },
              { id: "open", label: copy.id },
            ]}
            rows={page.data.items.map((party) => ({
              id: party.id,
              cells: [
                party.displayName,
                copy[party.role],
                party.revision,
                <Box key="open" display="grid" gap="sm">
                  <Text>{party.id}</Text>
                  <Button size="xl" variant="outline" onClick={() => setSelected(party.id)}>
                    {copy.open}
                  </Button>
                </Box>,
              ],
            }))}
          />
          {page.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
          <Pager
            locale={locale}
            first={!after}
            next={page.isSuccess && !page.isFetching ? page.data.next : null}
            onPage={setAfter}
          />
        </>
      ) : null}
      {selected ? <CounterpartyDetail {...props} key={selected} id={selected} /> : null}
    </Box>
  );
}
function CounterpartyDetail(props: CommerceProps & { id: string }) {
  const { book, locale, id } = props;
  const copy = commerceCopy(locale);
  const [revision, setRevision] = useState("");
  const party = useQuery({
    queryKey: [...commerceKey(book), "counterparty", id, revision],
    queryFn: async ({ signal }) => {
      const suffix = revision ? `?revision=${encodeURIComponent(revision)}` : "";
      const result = await readAccounting(
        `${commercePath(book)}/counterparties/${encodeURIComponent(id)}${suffix}`,
        Commerce.CounterpartyRevision,
        { signal },
      );
      checkScope(book, result.scope);
      if (result.id !== id || (revision && result.revision !== revision))
        throw new Error("Counterparty revision mismatch");
      return result;
    },
    retry: false,
  });
  const ready = party.isSuccess && !party.isFetching;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.parties}</Heading>
      <Text>
        {copy.id}: {id}
      </Text>
      <Box
        as="form"
        display="flex"
        flexWrap="wrap"
        gap="md"
        alignItems="end"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("revision");
          if (typeof value === "string") setRevision(value);
        }}
      >
        <InputField
          name="revision"
          label={copy.revision}
          required
          pattern="[1-9][0-9]{0,17}"
          maxLength={18}
          inputMode="numeric"
        />
        <Button type="submit" size="xl" variant="outline">
          {copy.readRevision}
        </Button>
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() => {
            setRevision("");
            void party.refetch();
          }}
        >
          {copy.current}
        </Button>
      </Box>
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={party.isFetching}
          onClick={() => {
            void party.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={party.isPending} error={party.error} />
      {!ready ? <Text>{copy.waiting}</Text> : null}
      {party.data ? (
        <>
          <Text>
            {party.data.displayName} · {copy[party.data.role]} · {copy.revision}:{" "}
            {party.data.revision}
          </Text>
          <Text>{revision ? copy.historical : copy.current}</Text>
          <Facts title={copy.facts} value={party.data} />
          <Evidence {...props} reference={party.data.evidence} />
          {!revision ? (
            <Details title={copy.reviseParty}>
              <PartyRevisionForm {...props} party={party.data} allowed={ready} />
            </Details>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
function PartyRevisionForm(
  props: CommerceProps & {
    id: string;
    party: typeof Commerce.CounterpartyRevision.Type;
    allowed: boolean;
  },
) {
  const { party, allowed } = props;
  const [baseline, setBaseline] = useState(party);
  const copy = commerceCopy(props.locale);
  return (
    <CommandForm
      {...props}
      path={`${commercePath(props.book)}/counterparties/${encodeURIComponent(party.id)}/revisions`}
      schema={Commerce.ReviseCounterparty}
      output={Commerce.CounterpartyRevision}
      label={copy.reviseParty}
      allowed={allowed}
      onNewCommand={() => setBaseline(party)}
      input={(fields) => ({
        expectedRevision: fields.get("expectedRevision"),
        displayName: fields.get("displayName"),
        evidenceId: fields.get("evidenceId"),
        reason: fields.get("reason"),
      })}
    >
      <Text>
        {copy.revision}: {baseline.revision}
      </Text>
      <Field
        name="expectedRevision"
        label={copy.revision}
        value={baseline.revision}
        maxLength={18}
      />
      <Field name="displayName" label={copy.name} value={baseline.displayName} maxLength={200} />
      <Field name="evidenceId" label={copy.evidenceId} maxLength={128} />
      <Field name="reason" label={copy.reason} />
    </CommandForm>
  );
}
