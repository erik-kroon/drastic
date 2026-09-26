import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { SealedAction } from "@/components/journal-review";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { correctionCopy } from "./copy";
import { CorrectionReview } from "./correction-review";
import { CorrectionDiscovery } from "./discovery";
import { CorrectionChainView, CorrectionImpactDetails } from "./impact-review";

export function CorrectionsPanel(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  open?: boolean;
  bundleId?: string;
}) {
  const { book, setup, locale, open } = props;
  const copy = correctionCopy(locale);
  const [originalId, setOriginalId] = useState("");
  const [bundleId, setBundleId] = useState(props.bundleId ?? "");
  const [error, setError] = useState("");

  const original = useQuery({
    queryKey: [...bookKey(book), "correction-original", originalId],
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/vouchers/${encodeURIComponent(originalId)}`,
        Accounting.Voucher,
        { signal },
      ),
    enabled: originalId !== "",
    retry: false,
  });

  const recovery = useMutation({
    mutationFn: (id: string) =>
      readAccounting(
        `${bookPath(book)}/vouchers/${encodeURIComponent(id)}/correction-bundle`,
        Corrections.CorrectionBundleView,
      ),
    onSuccess: (view) => setBundleId(view.bundle.id),
  });

  return (
    <details open={open} id="corrections" tabIndex={-1}>
      <summary>{copy.title}</summary>
      <Box display="grid" gap="2xl" paddingBlock="lg" minWidth="zero">
        <Text tone="muted">{copy.scope}</Text>
        <CorrectionDiscovery book={book} locale={locale} onSelected={setBundleId} />
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("originalId");

            if (!Schema.is(Accounting.Identifier)(id)) {
              setError(copy.invalid);

              return;
            }

            setError("");
            setOriginalId(id);
            setBundleId("");
            recovery.reset();
          }}
        >
          <InputField
            name="originalId"
            label={copy.originalId}
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
          <Box>
            <Button type="submit" size="xl" variant="outline">
              {copy.load}
            </Button>
          </Box>
        </Box>
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("bundleId");

            if (!Schema.is(Accounting.Identifier)(id)) {
              setError(copy.invalid);

              return;
            }

            setError("");
            setBundleId(id);
          }}
        >
          <InputField
            name="bundleId"
            label={copy.bundleId}
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
          <Box>
            <Button type="submit" size="xl" variant="outline">
              {copy.recover}
            </Button>
          </Box>
        </Box>
        <Text role="status">{error}</Text>
        {originalId ? (
          <>
            <AccountingStatus locale={locale} pending={original.isPending} error={original.error} />
            <Box display="flex" flexWrap="wrap" gap="md">
              <Button
                size="xl"
                variant="outline"
                disabled={recovery.isPending}
                onClick={() => recovery.mutate(originalId)}
              >
                {copy.recoverOriginal}
              </Button>
              {original.isError ? (
                <Button
                  size="xl"
                  variant="outline"
                  onClick={() => {
                    void original.refetch();
                  }}
                >
                  {copy.load}
                </Button>
              ) : null}
            </Box>
            <AccountingStatus locale={locale} pending={recovery.isPending} error={recovery.error} />
          </>
        ) : null}
        {original.data && !bundleId ? (
          <>
            <CorrectionChainView book={book} setup={setup} locale={locale} id={original.data.id} />
            <Heading>{copy.original}</Heading>
            <Text>{original.data.id}</Text>
            <SealedAction
              book={book}
              action={original.data.action}
              locale={locale}
              setupAccounts={setup.accounts}
            />
            <ReplacementDraft
              key={original.data.id}
              book={book}
              setup={setup}
              locale={locale}
              original={original.data}
              onPrepared={setBundleId}
            />
          </>
        ) : null}
        {bundleId ? (
          <CorrectionReview
            key={bundleId}
            book={book}
            setup={setup}
            locale={locale}
            id={bundleId}
          />
        ) : null}
      </Box>
    </details>
  );
}

function ReplacementDraft(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  original: typeof Accounting.Voucher.Type;
  onPrepared: (id: string) => void;
}) {
  const { book, setup, locale, original } = props;
  const copy = correctionCopy(locale);
  const keys = useRef(new Map<string, string>());
  const nextLine = useRef(original.action.lines.length);
  const [lines, setLines] = useState(original.action.lines.map((_, index) => index));
  const [error, setError] = useState("");
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const [requestKey, setRequestKey] = useState("");

  const impact = useMutation({
    mutationFn: (input: typeof Corrections.CorrectionIntent.Type) => {
      const path = `${bookPath(book)}/vouchers/${encodeURIComponent(original.id)}/correction-impact-reviews`;
      const body = JSON.stringify(input);
      const options = mutationOptions(path, body, keys.current);
      setRequestKey(keys.current.get(`${path}:${body}`) ?? "");

      return readAccounting(path, Corrections.CorrectionImpact, options);
    },
  });

  const prepare = useMutation({
    mutationFn: (input: typeof Corrections.PrepareCorrectionBundle.Type) => {
      const path = `${bookPath(book)}/vouchers/${encodeURIComponent(original.id)}/correction-bundles`;
      const body = JSON.stringify(input);
      const options = mutationOptions(path, body, keys.current);
      setRequestKey(keys.current.get(`${path}:${body}`) ?? "");

      return readAccounting(path, Corrections.CorrectionBundle, options);
    },
    onSuccess: (bundle) => props.onPrepared(bundle.id),
  });

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);

        const decoded = Schema.decodeUnknownOption(Corrections.CorrectionIntent)({
          datePolicy: "explicit_open_period",
          accountingPeriodId: fields.get("period"),
          postingDate: fields.get("date"),
          rationale: fields.get("rationale"),
          replacement: {
            description: fields.get("description"),
            lines: lines.map((line) => ({
              accountId: fields.get(`account-${line}`),
              debitMinor: fields.get(`debit-${line}`),
              creditMinor: fields.get(`credit-${line}`),
              description: fields.get(`description-${line}`),
            })),
          },
        });

        if (decoded._tag === "None") {
          setError(copy.invalid);

          return;
        }

        const draft = decoded.value;

        const debit = draft.replacement.lines.reduce(
          (sum, line) => sum + BigInt(line.debitMinor),
          0n,
        );

        const credit = draft.replacement.lines.reduce(
          (sum, line) => sum + BigInt(line.creditMinor),
          0n,
        );

        if (
          debit === 0n ||
          debit !== credit ||
          draft.replacement.lines.some(
            (line) => (line.debitMinor === "0") === (line.creditMinor === "0"),
          )
        ) {
          setError(copy.invalid);

          return;
        }

        setError("");
        setImpactConfirmed(false);
        impact.mutate(draft);
      }}
    >
      <Heading>{copy.draft}</Heading>
      <Text>{copy.policy}</Text>
      <Box
        as="fieldset"
        disabled={
          impact.isPending ||
          impact.isSuccess ||
          prepare.isPending ||
          prepare.isSuccess ||
          original.action.postingPurpose === "reversal"
        }
        borderWidth="none"
        margin="none"
        padding="none"
        minWidth="zero"
        display="grid"
        gap="lg"
      >
        <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
          <SelectField
            label={copy.period}
            name="period"
            required
            options={setup.periods.map((period) => ({
              value: period.id,
              label: `${period.id} · ${period.startsOn} – ${period.endsOn}`,
              disabled: period.locked,
            }))}
          />
          <InputField
            label={copy.date}
            name="date"
            type="date"
            min={original.action.postingDate}
            required
          />
        </Box>
        <InputField label={copy.rationale} name="rationale" required maxLength={2000} />
        <InputField
          label={copy.description}
          name="description"
          required
          maxLength={2000}
          defaultValue={original.action.description}
        />
        {lines.map((line, index) => (
          <Box
            as="fieldset"
            key={line}
            display="grid"
            gap="md"
            margin="none"
            padding="lg"
            borderWidth="thin"
            borderColor="default"
            borderRadius="surface"
            minWidth="zero"
          >
            <legend>
              {copy.line} {index + 1}
            </legend>
            <SelectField
              label={copy.account}
              name={`account-${line}`}
              defaultValue={original.action.lines[line]?.accountId}
              required
              options={setup.accounts.map((account) => ({
                value: account.id,
                label: `${account.code} · ${account.name}`,
                disabled: !account.active,
              }))}
            />
            <Box display="grid" columns={1} columnsAtSm={2} gap="md">
              <InputField
                label={copy.debit}
                name={`debit-${line}`}
                inputMode="numeric"
                required
                pattern="(0|[1-9][0-9]{0,37})"
                maxLength={38}
                defaultValue={original.action.lines[line]?.debitMinor ?? "0"}
              />
              <InputField
                label={copy.credit}
                name={`credit-${line}`}
                inputMode="numeric"
                required
                pattern="(0|[1-9][0-9]{0,37})"
                maxLength={38}
                defaultValue={original.action.lines[line]?.creditMinor ?? "0"}
              />
            </Box>
            <InputField
              label={copy.description}
              name={`description-${line}`}
              required
              maxLength={2000}
              defaultValue={original.action.lines[line]?.description ?? ""}
            />
            <Box>
              <Button
                type="button"
                size="xl"
                variant="ghost"
                disabled={lines.length <= 2}
                onClick={() => setLines(lines.filter((item) => item !== line))}
              >
                {copy.remove} {index + 1}
              </Button>
            </Box>
          </Box>
        ))}
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button
            type="button"
            size="xl"
            variant="outline"
            disabled={lines.length >= 500}
            onClick={() => {
              setLines([...lines, nextLine.current]);
              nextLine.current += 1;
            }}
          >
            {copy.add}
          </Button>
          <Button type="submit" size="xl">
            {copy.prepareImpact}
          </Button>
        </Box>
      </Box>
      <Text role="status">{error}</Text>
      <AccountingStatus write locale={locale} pending={impact.isPending} error={impact.error} />
      {requestKey ? (
        <Box role="status" display="grid" gap="sm">
          <Text>
            {copy.requestKey}: {requestKey}
          </Text>
          <Text tone="muted">{copy.requestHint}</Text>
        </Box>
      ) : null}
      {impact.data ? (
        <Box display="grid" gap="lg" minWidth="zero">
          <CorrectionImpactDetails book={book} impact={impact.data} locale={locale} />
          <Box as="label" display="flex" alignItems="center" gap="md" paddingBlock="md">
            <input
              type="checkbox"
              checked={impactConfirmed}
              disabled={prepare.isPending}
              onChange={(event) => setImpactConfirmed(event.target.checked)}
            />
            {copy.impactConfirm}
          </Box>
          <Box display="flex" flexWrap="wrap" gap="md">
            <Button
              type="button"
              size="xl"
              variant="outline"
              disabled={prepare.isPending}
              onClick={() => {
                const path = `${bookPath(book)}/vouchers/${encodeURIComponent(original.id)}/correction-impact-reviews`;

                if (impact.variables)
                  keys.current.delete(`${path}:${JSON.stringify(impact.variables)}`);
                impact.reset();
                prepare.reset();
                setImpactConfirmed(false);
              }}
            >
              {copy.editImpact}
            </Button>
            <Button
              type="button"
              size="xl"
              disabled={
                !impactConfirmed ||
                prepare.isPending ||
                prepare.isSuccess ||
                impact.data.basis.blockers.length > 0
              }
              onClick={() => {
                if (impact.data)
                  prepare.mutate({
                    ...impact.data.basis.intent,
                    impactReview: { id: impact.data.id, digest: impact.data.digest },
                  });
              }}
            >
              {copy.seal}
            </Button>
          </Box>
        </Box>
      ) : null}
      <AccountingStatus write locale={locale} pending={prepare.isPending} error={prepare.error} />
    </Box>
  );
}
