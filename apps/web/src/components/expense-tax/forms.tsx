import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Tax from "@open-erp/contracts/expense-tax";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Label } from "@open-erp/ui/components/label";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { expenseTaxCopy } from "./copy";

type Common = { book: typeof Accounting.Book.Type; locale: Locale };

export function nullableValue(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" && value !== "" ? value : null;
}

function readAmounts(fields: FormData) {
  return {
    grossMinor: nullableValue(fields, "grossMinor"),
    netMinor: nullableValue(fields, "netMinor"),
    vatMinor: nullableValue(fields, "vatMinor"),
  };
}

function AmountInputs({
  locale,
  amounts,
}: {
  locale: Locale;
  amounts?: typeof Tax.TaxAmounts.Type;
}) {
  const copy = expenseTaxCopy(locale);

  return (
    <Box display="grid" gap="md">
      <InputField
        label={copy.gross}
        name="grossMinor"
        inputMode="numeric"
        pattern="(0|[1-9][0-9]{0,37})"
        defaultValue={amounts?.grossMinor ?? ""}
      />
      <InputField
        label={copy.net}
        name="netMinor"
        inputMode="numeric"
        pattern="(0|[1-9][0-9]{0,37})"
        defaultValue={amounts?.netMinor ?? ""}
      />
      <InputField
        label={copy.vat}
        name="vatMinor"
        inputMode="numeric"
        pattern="(0|[1-9][0-9]{0,37})"
        defaultValue={amounts?.vatMinor ?? ""}
      />
    </Box>
  );
}

const sourceTextNames = [
  "currency",
  "supplierJurisdiction",
  "supplyJurisdiction",
  "issuedOn",
  "receivedOn",
  "suppliedOn",
  "taxPointOn",
  "changeSetId",
  "voucherId",
] as const;

export function TaxSourceForm(
  props: Common & { current?: typeof Tax.TaxSourceRevision.Type; onSaved: (id: string) => void },
) {
  const { book, locale } = props;
  const copy = expenseTaxCopy(locale);
  // Capture the edited revision. A background read cannot change the submitted expected digest.
  const [current] = useState(props.current);
  const keys = useRef(new Map<string, string>());
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: (input: typeof Tax.RecordTaxSource.Type) => {
      const path = `${bookPath(book)}/expense-tax/sources`;

      return readAccounting(
        path,
        Tax.TaxSourceRevision,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (source) => props.onSaved(source.sourceId),
  });

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const scale = nullableValue(fields, "currencyScale");

        if (scale !== null && !/^[0-6]$/.test(scale)) {
          setInvalid(true);

          return;
        }

        const decoded = Schema.decodeUnknownOption(Tax.RecordTaxSource)({
          sourceKey: current?.sourceKey ?? fields.get("sourceKey"),
          expectedSourceDigest: current?.digest ?? null,
          facts: {
            evidenceId: fields.get("evidenceId"),
            sourceLocator: fields.get("sourceLocator"),
            description: fields.get("description"),
            recordClass: current?.facts.recordClass ?? fields.get("recordClass"),
            amounts: readAmounts(fields),
            ...Object.fromEntries(
              sourceTextNames.map((name) => [name, nullableValue(fields, name)]),
            ),
            currencyScale: scale === null ? null : Number(scale),
          },
        });

        if (decoded._tag === "None") {
          setInvalid(true);

          return;
        }

        setInvalid(false);
        save.mutate(decoded.value);
      }}
    >
      <Text>{copy.nullable}</Text>
      <Text>{copy.sourceKeyHelp}</Text>
      <Box
        as="fieldset"
        display="grid"
        gap="md"
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        disabled={save.isPending || save.isSuccess}
      >
        {!current ? (
          <>
            <InputField
              label={copy.sourceKey}
              name="sourceKey"
              required
              pattern="[a-zA-Z0-9_\-]{1,128}"
            />
            <SelectField
              label={copy.sourceClass}
              name="recordClass"
              required
              defaultValue=""
              options={[
                { value: "", label: "—" },
                { value: "actual_company", label: copy.actual },
                { value: "synthetic", label: copy.synthetic },
              ]}
            />
          </>
        ) : (
          <Text>
            {current.sourceKey} · {current.facts.recordClass}
          </Text>
        )}
        <InputField
          label={copy.evidenceId}
          name="evidenceId"
          required
          pattern="[a-z][a-z0-9_\-]{2,127}"
          defaultValue={current?.facts.evidenceId}
        />
        <InputField
          label={copy.sourceLocator}
          name="sourceLocator"
          required
          maxLength={2000}
          defaultValue={current?.facts.sourceLocator}
        />
        <InputField
          label={copy.description}
          name="description"
          required
          maxLength={2000}
          defaultValue={current?.facts.description}
        />
        <AmountInputs locale={locale} amounts={current?.facts.amounts} />
        {sourceTextNames.map((name) => (
          <InputField
            key={name}
            label={copy[name]}
            name={name}
            type={name.endsWith("On") ? "date" : "text"}
            maxLength={128}
            defaultValue={current?.facts[name] ?? ""}
          />
        ))}
        <InputField
          label={copy.currencyScale}
          name="currencyScale"
          inputMode="numeric"
          pattern="[0-6]"
          defaultValue={current?.facts.currencyScale?.toString() ?? ""}
        />
        <Text>{copy.optionalRefs}</Text>
        <Box>
          <Button type="submit" size="xl">
            {current ? copy.reviseSource : copy.createSource}
          </Button>
        </Box>
      </Box>
      <Text role="status">{invalid ? copy.invalid : save.isSuccess ? copy.sourceSaved : ""}</Text>
      <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
    </Box>
  );
}

const reviewTextNames = [
  "registrationEvidenceId",
  "methodEvidenceId",
  "bookJurisdiction",
  "suppliedOn",
  "taxPointOn",
  "dateBasis",
  "dateEvidenceId",
  "profileId",
  "profileVersion",
  "rateNumerator",
  "rateDenominator",
  "deductionNumerator",
  "deductionDenominator",
  "deductionBasis",
  "deductionEvidenceId",
] as const;

export function TaxReviewForm(
  props: Common & { source: typeof Tax.TaxSourceView.Type; onSaved: () => void },
) {
  const { book, locale } = props;
  const [source] = useState(props.source);
  const previous = source.reviewCurrent ? source.latestReview?.facts : null;
  const copy = expenseTaxCopy(locale);
  const keys = useRef(new Map<string, string>());
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: (input: typeof Tax.ReviewTaxSource.Type) => {
      const path = `${bookPath(book)}/expense-tax/sources/${source.current.sourceId}/reviews`;

      return readAccounting(
        path,
        Tax.TaxReview,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: () => props.onSaved(),
  });

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);

        const decoded = Schema.decodeUnknownOption(Tax.ReviewTaxSource)({
          sourceDigest: source.current.digest,
          expectedReviewDigest: source.latestReview?.digest ?? null,
          facts: {
            evidenceId: fields.get("evidenceId"),
            rationale: fields.get("rationale"),
            amounts: readAmounts(fields),
            registration: fields.get("registration"),
            method: fields.get("method"),
            treatment: fields.get("treatment"),
            roundingPolicy: fields.get("roundingPolicy"),
            ...Object.fromEntries(
              reviewTextNames.map((name) => [name, nullableValue(fields, name)]),
            ),
          },
        });

        if (decoded._tag === "None") {
          setInvalid(true);

          return;
        }

        setInvalid(false);
        save.mutate(decoded.value);
      }}
    >
      <Text>{copy.operatorOnly}</Text>
      <Text>{copy.nullable}</Text>
      <Text>{copy.profileHelp}</Text>
      <Text>{source.current.digest}</Text>
      <Box
        as="fieldset"
        display="grid"
        gap="md"
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        disabled={save.isPending || save.isSuccess}
      >
        <InputField
          label={copy.evidenceId}
          name="evidenceId"
          required
          pattern="[a-z][a-z0-9_\-]{2,127}"
          defaultValue={previous?.evidenceId}
        />
        <InputField
          label={copy.rationale}
          name="rationale"
          required
          maxLength={2000}
          defaultValue={previous?.rationale}
        />
        <AmountInputs locale={locale} amounts={previous?.amounts} />
        <SelectField
          label={copy.registration}
          name="registration"
          defaultValue={previous?.registration ?? "unknown"}
          options={[
            { value: "unknown", label: copy.unknown },
            { value: "registered", label: copy.registered },
            { value: "not_registered", label: copy.notRegistered },
          ]}
        />
        <SelectField
          label={copy.method}
          name="method"
          defaultValue={previous?.method ?? "unknown"}
          options={[
            { value: "unknown", label: copy.unknown },
            { value: "accrual", label: copy.accrual },
            { value: "cash", label: copy.cash },
          ]}
        />
        <SelectField
          label={copy.treatment}
          name="treatment"
          defaultValue={previous?.treatment ?? "unknown"}
          options={[
            { value: "unknown", label: copy.unknown },
            { value: "domestic_purchase", label: copy.domesticPurchase },
            { value: "foreign_purchase", label: copy.foreignPurchase },
            { value: "reverse_charge", label: copy.reverseCharge },
            { value: "import", label: copy.imports },
            { value: "exempt", label: copy.exempt },
            { value: "out_of_scope", label: copy.outOfScope },
            { value: "other", label: copy.other },
          ]}
        />
        {reviewTextNames.map((name) => (
          <InputField
            key={name}
            label={copy[name]}
            name={name}
            type={name.endsWith("On") ? "date" : "text"}
            maxLength={2000}
            defaultValue={previous?.[name] ?? ""}
          />
        ))}
        <SelectField
          label={copy.roundingPolicy}
          name="roundingPolicy"
          defaultValue={previous?.roundingPolicy ?? "unknown"}
          options={[
            { value: "unknown", label: copy.unknown },
            { value: "exact_only", label: copy.exactOnly },
          ]}
        />
        <Box>
          <Button type="submit" size="xl">
            {copy.reviewSource}
          </Button>
        </Box>
      </Box>
      <Text role="status">{invalid ? copy.invalid : save.isSuccess ? copy.reviewSaved : ""}</Text>
      <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
    </Box>
  );
}

export function TaxEvidenceForm({ book, locale }: Common) {
  const copy = expenseTaxCopy(locale);
  const contentId = useId();
  const keys = useRef(new Map<string, string>());
  const [invalid, setInvalid] = useState(false);

  const save = useMutation({
    mutationFn: (input: typeof Accounting.CreateEvidence.Type) => {
      const path = `${bookPath(book)}/evidence`;

      return readAccounting(
        path,
        Accounting.Evidence,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
  });

  return (
    <details>
      <summary>{copy.sourceEvidence}</summary>
      <Box
        as="form"
        display="grid"
        gap="md"
        paddingBlock="lg"
        minWidth="zero"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);

          const decoded = Schema.decodeUnknownOption(Accounting.CreateEvidence)({
            title: fields.get("title"),
            origin: fields.get("origin"),
            content: fields.get("content"),
            mediaType: "text/plain",
          });

          if (decoded._tag === "None") {
            setInvalid(true);

            return;
          }

          setInvalid(false);
          save.mutate(decoded.value);
        }}
      >
        <Box
          as="fieldset"
          display="grid"
          gap="md"
          borderWidth="none"
          margin="none"
          padding="none"
          minWidth="zero"
          disabled={save.isPending || save.isSuccess}
        >
          <InputField label={copy.evidenceTitle} name="title" required maxLength={2000} />
          <InputField label={copy.evidenceOrigin} name="origin" required maxLength={2000} />
          <Label htmlFor={contentId}>{copy.evidenceContent}</Label>
          <Box
            display="grid"
            minWidth="zero"
            padding="md"
            borderWidth="thin"
            borderColor="default"
            borderRadius="control"
          >
            <textarea id={contentId} name="content" rows={5} cols={16} required maxLength={65536} />
          </Box>
          <Box>
            <Button type="submit" size="xl">
              {copy.sourceEvidence}
            </Button>
          </Box>
        </Box>
        <Text role="status">
          {invalid ? copy.invalid : save.data ? `${copy.evidenceSaved} ${save.data.id}` : ""}
        </Text>
        <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
        {save.isSuccess ? (
          <Box>
            <Button
              variant="ghost"
              size="xl"
              onClick={() => {
                save.reset();
                keys.current.clear();
              }}
            >
              {copy.newEvidence}
            </Button>
          </Box>
        ) : null}
      </Box>
    </details>
  );
}
