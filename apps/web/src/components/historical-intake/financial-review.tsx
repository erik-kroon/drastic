import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField, TextareaField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookPath,
  readAccounting,
  mutationOptions,
  isUncertainWriteError,
} from "@/lib/accounting-api";

const inputSchema = Schema.Struct({
  accountingPeriodId: Historical.PrepareSourceVoucher.fields.accountingPeriodId,
  series: Historical.PrepareSourceVoucher.fields.series,
  rationale: Historical.PrepareSourceVoucher.fields.rationale,
});

export function PrepareSourceVoucher({
  run,
  onPrepared,
  hasProposal,
}: {
  run: typeof Historical.Run.Type;
  onPrepared: () => Promise<unknown>;
  hasProposal: boolean;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const path = `${bookPath(book)}/sie-financial-runs/${encodeURIComponent(run.id)}/proposals`;

  const prepare = useMutation({
    mutationFn: (input: typeof Historical.PrepareSourceVoucher.Type) =>
      readAccounting(
        path,
        Accounting.ChangeSet,
        mutationOptions(path, JSON.stringify(input), keys.current),
      ),
    onSuccess: async () => {
      keys.current.clear();
      await onPrepared();
    },
  });

  const uncertain = isUncertainWriteError(prepare.error);
  const disabled = prepare.isPending || uncertain;

  const form = useForm({
    defaultValues: { accountingPeriodId: "", series: "", rationale: "" },
    validators: { onSubmit: Schema.toStandardSchemaV1(inputSchema) },
    onSubmit: async ({ value }) => {
      await prepare
        .mutateAsync({
          ...value,
          fence: run.fence,
          planDigest: run.planDigest,
          ordinal: run.nextOrdinal,
        })
        .catch(() => undefined);
    },
  });

  return (
    <details open={!hasProposal}>
      <summary>
        {hasProposal
          ? sv
            ? "Förbered nytt förslag efter ändring"
            : "Prepare a new proposal after changes"
          : sv
            ? "Förbered nästa verifikation"
            : "Prepare next voucher"}
      </summary>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Text>
          {sv
            ? "Datum, konton och belopp hämtas från det granskade källmaterialet. Inga belopp bokförs i detta steg."
            : "The date, accounts and amounts come from the reviewed source. This step does not post amounts."}
        </Text>
        <form.Field name="accountingPeriodId">
          {(field) => (
            <SelectField
              label={sv ? "Bokföringsperiod" : "Accounting period"}
              value={field.state.value}
              disabled={disabled}
              options={[
                { value: "", label: sv ? "Välj period" : "Select period" },
                ...setup.periods
                  .filter((p) => !p.locked)
                  .map((p) => ({ value: p.id, label: `${p.startsOn} – ${p.endsOn}` })),
              ]}
              onValueChange={(value) => {
                field.handleChange(value ?? "");
                field.handleBlur();
              }}
            />
          )}
        </form.Field>
        <form.Field name="series">
          {(field) => (
            <InputField
              label={sv ? "Verifikationsserie" : "Voucher series"}
              value={field.state.value}
              required
              disabled={disabled}
              maxLength={16}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <form.Field name="rationale">
          {(field) => (
            <TextareaField
              label={sv ? "Grund för bokföringsförslaget" : "Posting proposal rationale"}
              value={field.state.value}
              required
              disabled={disabled}
              maxLength={2000}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.submissionAttempts > 0 && !state.isValid}>
          {(invalid) =>
            invalid ? (
              <Text role="alert">
                {sv ? "Välj period, serie och grund." : "Choose a period, series and rationale."}
              </Text>
            ) : null
          }
        </form.Subscribe>
        <AccountingStatus locale={locale} pending={prepare.isPending} error={prepare.error} write />
        <Box>
          {uncertain ? (
            <Button
              type="button"
              disabled={prepare.isPending}
              onClick={() => {
                if (prepare.variables) prepare.mutate(prepare.variables);
              }}
            >
              {sv ? "Återförsök samma förslag" : "Retry same proposal"}
            </Button>
          ) : (
            <Button type="submit" disabled={disabled}>
              {sv ? "Förbered för granskning" : "Prepare for review"}
            </Button>
          )}
        </Box>
      </Box>
    </details>
  );
}

export function ReviewSourceVoucher({
  run,
  proposal,
  onPosted,
}: {
  run: typeof Historical.Run.Type;
  proposal: typeof Accounting.ChangeSet.Type;
  onPosted: () => Promise<unknown>;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const approvalPath = `${bookPath(book)}/change-sets/${encodeURIComponent(proposal.id)}/approvals`;

  const approval = useMutation({
    mutationFn: () =>
      readAccounting(
        approvalPath,
        Accounting.Approval,
        mutationOptions(
          approvalPath,
          JSON.stringify({ planDigest: proposal.planDigest, version: proposal.version }),
          keys.current,
        ),
      ),
  });

  const postPath = `${bookPath(book)}/sie-financial-runs/${encodeURIComponent(run.id)}/chunks`;

  const post = useMutation({
    mutationFn: (input: {
      fence: string;
      planDigest: string;
      firstOrdinal: number;
      items: { changeSetId: string; planDigest: string; approvalId: string }[];
    }) =>
      readAccounting(
        postPath,
        Historical.Chunk,
        mutationOptions(postPath, JSON.stringify(input), keys.current),
      ),
    onSuccess: async () => {
      await onPosted();
    },
  });

  const uncertain = isUncertainWriteError(post.error);
  const disabled = book.role !== "operator" || approval.isPending || post.isPending;

  const form = useForm({
    defaultValues: { reviewed: false },
    validators: {
      onSubmit: Schema.toStandardSchemaV1(Schema.Struct({ reviewed: Schema.Literal(true) })),
    },
    onSubmit: async () => {
      await approval.mutateAsync().catch(() => undefined);
    },
  });

  return (
    <Box display="grid" gap="md">
      {proposal.groups
        .flatMap((group) => group.actions)
        .map((action) => (
          <Box key={action.eventId} display="grid" gap="sm">
            <Text>
              {action.description} · {action.postingDate} · {action.currency}
            </Text>
            {action.lines.map((line) => (
              <Text key={line.lineId}>
                {setup.accounts.find((account) => account.id === line.accountId)?.code ??
                  line.accountId}{" "}
                · {sv ? "Debet" : "Debit"}: {line.debitMinor} · {sv ? "Kredit" : "Credit"}:{" "}
                {line.creditMinor} ({sv ? "minsta valutaenhet" : "minor units"}) ·{" "}
                {line.description}
              </Text>
            ))}
            <Text>{action.rationale}</Text>
          </Box>
        ))}
      <Box
        as="form"
        display="grid"
        gap="sm"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="reviewed">
          {(field) => (
            <SelectField
              label={sv ? "Granskning av verifikation" : "Voucher review"}
              value={field.state.value ? "reviewed" : ""}
              disabled={disabled || uncertain || Boolean(approval.data)}
              options={[
                { value: "", label: sv ? "Bekräfta efter granskning" : "Confirm after review" },
                {
                  value: "reviewed",
                  label: sv
                    ? "Datum, konton och belopp granskade"
                    : "Date, accounts and amounts reviewed",
                },
              ]}
              onValueChange={(value) => {
                field.handleChange(value === "reviewed");
                field.handleBlur();
              }}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.submissionAttempts > 0 && !state.isValid}>
          {(invalid) =>
            invalid ? (
              <Text role="alert">
                {sv ? "Bekräfta granskningen först." : "Confirm the review first."}
              </Text>
            ) : null
          }
        </form.Subscribe>
        <Box>
          <Button type="submit" disabled={disabled || uncertain || Boolean(approval.data)}>
            {sv ? "Godkänn verifikation" : "Approve voucher"}
          </Button>
        </Box>
      </Box>
      <AccountingStatus locale={locale} pending={approval.isPending} error={approval.error} write />
      {approval.data ? (
        <Box>
          <Button
            disabled={disabled}
            onClick={() => {
              if (uncertain && post.variables) post.mutate(post.variables);
              else if (approval.data)
                post.mutate({
                  fence: run.fence,
                  planDigest: run.planDigest,
                  firstOrdinal: run.nextOrdinal,
                  items: [
                    {
                      changeSetId: proposal.id,
                      planDigest: proposal.planDigest,
                      approvalId: approval.data.id,
                    },
                  ],
                });
            }}
          >
            {uncertain
              ? sv
                ? "Återförsök samma bokföring"
                : "Retry same posting"
              : sv
                ? "Bokför godkänd verifikation"
                : "Post approved voucher"}
          </Button>
        </Box>
      ) : null}
      {post.error instanceof Accounting.AccountingError &&
      post.error.code === "ApprovalRequired" ? (
        <Box>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => {
              keys.current.clear();
              approval.reset();
              post.reset();
            }}
          >
            {sv ? "Granska och godkänn på nytt" : "Review and approve again"}
          </Button>
        </Box>
      ) : null}
      <AccountingStatus locale={locale} pending={post.isPending} error={post.error} write />
    </Box>
  );
}
