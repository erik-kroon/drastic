import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { RecordColumns, RecordFact, RecordHeading, RecordSection, RecordSummary } from "@open-erp/ui/components/record-layout";
import { WorkflowSteps } from "@open-erp/ui/components/workflow";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  isUncertainWriteError,
  mutationOptions,
  readAccounting,
  requiresNewProposal,
} from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { vatCopy } from "./copy";

type Props = {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  recordId?: string;
  onOpen: (id: string) => void;
};

type Setup = typeof Accounting.BookSetup.Type;

export function VatControlReclassificationPanel({ book, locale, recordId, onOpen }: Props) {
  const { setup } = useBookWorkspace();
  const labels = reclassificationCopy(locale);
  const selected = recordId?.startsWith("new:")
    ? { kind: "new" as const, id: recordId.slice(4) }
    : recordId
      ? { kind: "review" as const, id: recordId }
      : null;
  if (selected) {
    return (
      <Box display="grid" gap="xl" minWidth="zero">
        <Button variant="ghost" onClick={() => onOpen("")}>
          {locale === "sv" ? "Alla momsomklassningar" : "All VAT reclassifications"}
        </Button>
        {selected.kind === "new" ? (
          <PreparationDetail
            key={`${book.entityId}:${book.id}:${selected.id}`}
            book={book}
            setup={setup}
            locale={locale}
            draftId={selected.id}
            onOpen={onOpen}
          />
        ) : (
          <ReviewDetail
            key={`${book.entityId}:${book.id}:${selected.id}`}
            book={book}
            locale={locale}
            id={selected.id}
            onOpen={onOpen}
          />
        )}
      </Box>
    );
  }
  return (
    <Box display="grid" gap="xl" minWidth="zero" id="vat-reclassifications">
      <RecordHeading
        title={labels.title}
        subtitle={labels.subtitle}
        action={null}
      />
      <PageCaption>{labels.boundary}</PageCaption>
      <SavedDrafts book={book} locale={locale} onOpen={onOpen} />
      <SavedReclassifications book={book} locale={locale} onOpen={onOpen} />
    </Box>
  );
}

function SavedDrafts({
  book,
  locale,
  onOpen,
}: Pick<Props, "book" | "locale" | "onOpen">) {
  const copy = vatCopy(locale);
  const labels = reclassificationCopy(locale);
  const drafts = useQuery({
    queryKey: [...bookKey(book), "vat-returns", "drafts"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/vat-returns/drafts`, Vat.VatDraftList, { signal }),
    retry: false,
  });
  return (
    <RecordSection title={copy.drafts}>
      <AccountingStatus locale={locale} pending={drafts.isPending} error={drafts.error} />
      {drafts.data?.items.length === 0 ? <Text>{labels.noDrafts}</Text> : null}
      {drafts.data?.items.length ? (
        <DataTable
          title={copy.drafts}
          narrow="stack"
          columns={[
            { id: "period", label: locale === "sv" ? "Period" : "Period" },
            { id: "mode", label: copy.mode },
            { id: "action", label: labels.action },
          ]}
          rows={drafts.data.items.map((draft) => ({
            id: draft.id,
            cells: [
              <Button
                key="open"
                variant="ghost"
                onClick={() => onOpen(`new:${draft.id}`)}
              >
                {draft.input.startsOn} – {draft.input.endsOn}
              </Button>,
              draft.input.mode === "synthetic_demonstration" ? copy.synthetic : copy.actual,
              <span key="prepare">{labels.prepare}</span>,
            ],
          }))}
        />
      ) : null}
    </RecordSection>
  );
}

function SavedReclassifications({
  book,
  locale,
  onOpen,
}: Pick<Props, "book" | "locale" | "onOpen">) {
  const copy = vatCopy(locale);
  const labels = reclassificationCopy(locale);
  const reclassifications = useQuery({
    queryKey: [...bookKey(book), "vat-returns", "reclassifications"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/vat-returns/reclassifications`,
        Vat.VatControlReclassificationList,
        { signal },
      );
      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId) {
        throw new Error("VAT reclassification scope mismatch");
      }
      return result;
    },
    retry: false,
  });
  return (
    <RecordSection title={labels.saved}>
      <AccountingStatus
        locale={locale}
        pending={reclassifications.isPending}
        error={reclassifications.error}
      />
      {reclassifications.data?.items.length === 0 ? <Text>{labels.noReviews}</Text> : null}
      {reclassifications.data?.items.length ? (
        <DataTable
          title={labels.saved}
          narrow="stack"
          columns={[
            { id: "review", label: labels.review },
            { id: "period", label: locale === "sv" ? "Period" : "Period" },
            { id: "net", label: copy.exact, numeric: true },
            { id: "state", label: copy.state },
          ]}
          rows={reclassifications.data.items.map((item) => ({
            id: item.reviewId,
            cells: [
              <Button key="open" variant="ghost" onClick={() => onOpen(item.reviewId)}>
                {item.reviewId}
              </Button>,
              `${item.startsOn} – ${item.endsOn}`,
              item.accountingNetMinor,
              item.state,
            ],
          }))}
        />
      ) : null}
    </RecordSection>
  );
}

function PreparationDetail(
  props: Pick<Props, "book" | "locale" | "onOpen"> & {
    setup: Setup;
    draftId: string;
  },
) {
  const { book, setup, locale, draftId } = props;
  const draft = useQuery({
    queryKey: [...bookKey(book), "vat-returns", "draft", draftId],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/vat-returns/drafts/${encodeURIComponent(draftId)}`,
        Vat.VatDraftView,
        { signal },
      );
      if (result.draft.id !== draftId) throw new Error("VAT draft identity mismatch");
      return result;
    },
    retry: false,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <AccountingStatus locale={locale} pending={draft.isPending} error={draft.error} />
      {draft.data ? (
        <PreparationForm
          key={draft.data.draft.digest}
          book={book}
          setup={setup}
          locale={locale}
          draft={draft.data.draft}
          basisCurrent={draft.data.basisCurrent}
          onOpen={props.onOpen}
        />
      ) : null}
    </Box>
  );
}

function PreparationForm(
  props: Pick<Props, "book" | "locale" | "onOpen"> & {
    setup: Setup;
    draft: typeof Vat.VatDraft.Type;
    basisCurrent: boolean;
  },
) {
  const { book, setup, locale, draft } = props;
  const copy = vatCopy(locale);
  const labels = reclassificationCopy(locale);
  const path = `${bookPath(book)}/vat-returns/reclassifications`;
  const keys = useRef(new Map<string, string>());
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: (input: typeof Vat.PrepareVatControlReclassification.Type) =>
      readAccounting(
        path,
        Vat.VatControlReclassificationReview,
        mutationOptions(path, JSON.stringify(input), keys.current),
      ),
    onSuccess: (review) => props.onOpen(review.id),
  });
  const requestKey = save.variables
    ? keys.current.get(`${path}:${JSON.stringify(save.variables)}`)
    : undefined;
  const disabled =
    save.isPending ||
     save.isSuccess ||
     book.role !== "operator" ||
     !props.basisCurrent ||
    draft.input.mode !== "synthetic_demonstration" ||
    isUncertainWriteError(save.error);
  const accountOptions = setup.accounts.map((account) => ({
    value: account.id,
    label: `${account.code} · ${account.name} · ${account.id}`,
  }));
  const periodOptions = setup.periods.map((period) => ({
    value: period.id,
    label: `${period.startsOn} – ${period.endsOn} · ${period.id}${period.locked ? ` · ${locale === "sv" ? "låst" : "locked"}` : ""}`,
  }));
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const decoded = Schema.decodeUnknownOption(Vat.PrepareVatControlReclassification)({
          profile: "vat_control_reclassification_v1",
          draftId: draft.id,
          expectedDraftDigest: draft.digest,
          outputAccountId: fields.get("outputAccountId"),
          inputAccountId: fields.get("inputAccountId"),
          settlementAccountId: fields.get("settlementAccountId"),
          roleEvidenceId: fields.get("roleEvidenceId"),
          reviewEvidenceId: fields.get("reviewEvidenceId"),
          accountingPeriodId: fields.get("accountingPeriodId"),
          postingDate: fields.get("postingDate"),
          series: fields.get("series"),
          rationale: fields.get("rationale"),
          acknowledgeSyntheticOnly: fields.get("acknowledgeSyntheticOnly") === "on",
        });
        if (decoded._tag === "None") {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        save.mutate(decoded.value);
      }}
    >
      <RecordHeading
        title={labels.prepareTitle}
        subtitle={`${draft.id} · ${copy.digest} ${draft.digest}`}
      />
      <PageCaption>{labels.boundary}</PageCaption>
       {!props.basisCurrent ? <Text role="alert">{copy.stale}</Text> : null}
       {book.role !== "operator" ? <Text role="alert">{labels.operatorOnly}</Text> : null}
       {draft.input.mode !== "synthetic_demonstration" ? (
        <Text role="alert">{labels.syntheticDraftRequired}</Text>
      ) : null}
      <Box
        as="fieldset"
        disabled={disabled}
        display="grid"
        gap="lg"
        minWidth="zero"
        borderWidth="none"
        margin="none"
        padding="none"
      >
        <RecordSection title={labels.accountsAndPeriod}>
          <Text>{labels.accountHelp}</Text>
          {accountOptions.length ? (
            <Box display="grid" columnsAtSm={2} gap="md">
              <SelectField
                label={labels.outputAccount}
                name="outputAccountId"
                required
                defaultValue=""
                options={[{ value: "", label: "—" }, ...accountOptions]}
              />
              <SelectField
                label={labels.inputAccount}
                name="inputAccountId"
                required
                defaultValue=""
                options={[{ value: "", label: "—" }, ...accountOptions]}
              />
              <SelectField
                label={labels.settlementAccount}
                name="settlementAccountId"
                required
                defaultValue=""
                options={[{ value: "", label: "—" }, ...accountOptions]}
              />
            </Box>
          ) : (
            <Box display="grid" columnsAtSm={2} gap="md">
              <InputField label={labels.outputAccount} name="outputAccountId" required />
              <InputField label={labels.inputAccount} name="inputAccountId" required />
              <InputField label={labels.settlementAccount} name="settlementAccountId" required />
            </Box>
          )}
          {periodOptions.length ? (
            <SelectField
              label={labels.accountingPeriod}
              name="accountingPeriodId"
              required
              defaultValue=""
              options={[{ value: "", label: "—" }, ...periodOptions]}
            />
          ) : (
            <InputField label={labels.accountingPeriod} name="accountingPeriodId" required />
          )}
        </RecordSection>
        <RecordSection title={labels.reviewAndPosting}>
          <Box display="grid" columnsAtSm={2} gap="md">
            <InputField
              label={labels.roleEvidenceId}
              name="roleEvidenceId"
              required
              pattern="[a-z][a-z0-9_-]{2,127}"
            />
            <InputField
              label={labels.reviewEvidenceId}
              name="reviewEvidenceId"
              required
              pattern="[a-z][a-z0-9_-]{2,127}"
            />
            <InputField
              label={labels.postingDate}
              name="postingDate"
              type="date"
              required
              defaultValue={draft.input.endsOn}
            />
            <InputField
              label={labels.series}
              name="series"
              required
              defaultValue="VAT"
              maxLength={16}
              pattern="[A-Z0-9]{1,16}"
            />
          </Box>
          <InputField
            label={labels.rationale}
            name="rationale"
            required
            maxLength={2000}
          />
        </RecordSection>
        <Box as="label" display="flex" alignItems="center" gap="md">
          <input type="checkbox" name="acknowledgeSyntheticOnly" required />
          <Text>{labels.acknowledge}</Text>
        </Box>
        <Box>
          <Button type="submit" disabled={disabled}>
            {save.isPending ? (locale === "sv" ? "Sparar…" : "Saving…") : labels.prepare}
          </Button>
        </Box>
      </Box>
      <Text role="status">
        {invalid ? labels.invalid : save.isSuccess ? labels.savedResult : ""}
      </Text>
      <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
      {requestKey && save.isError ? (
        <RequestRecovery
          key={requestKey}
          book={book}
          locale={locale}
          requestKey={requestKey}
          onOpen={props.onOpen}
        />
      ) : null}
    </Box>
  );
}

type Review = typeof Vat.VatControlReclassificationReview.Type;
type Approval = typeof Vat.VatControlReclassificationApproval.Type;
type ReclassificationEffect = typeof Vat.VatControlReclassificationEffect.Type;
type ReviewView = typeof Vat.VatControlReclassificationView.Type;

function reviewActionDisabled(props: {
  bookRole: string;
  acknowledged: boolean;
  basisCurrent: boolean;
  hasEffect: boolean;
  hasCurrentApproval: boolean;
  hasSelectedApproval: boolean;
  expired: boolean;
  newProposal: boolean;
  uncertainWrite: boolean;
  busy: boolean;
}) {
  return {
    approval:
      props.bookRole !== "operator" ||
      !props.acknowledged ||
      !props.basisCurrent ||
      props.hasEffect ||
      props.hasCurrentApproval ||
      props.newProposal ||
      props.uncertainWrite ||
      props.busy,
    execution:
      !props.acknowledged ||
      !props.basisCurrent ||
      !props.hasSelectedApproval ||
      props.expired ||
      props.hasEffect ||
      props.newProposal ||
      props.uncertainWrite ||
      props.busy,
  };
}

function ReviewDetail({ book, locale, id, onOpen }: Pick<Props, "book" | "locale" | "onOpen"> & { id: string }) {
  const labels = reclassificationCopy(locale);
  const client = useQueryClient();
  const approvalKeys = useRef(new Map<string, string>());
  const executionKeys = useRef(new Map<string, string>());
  const [selectedApprovalId, setSelectedApprovalId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const base = `${bookPath(book)}/vat-returns/reclassifications/${encodeURIComponent(id)}`;
  const view = useQuery({
    queryKey: [...bookKey(book), "vat-returns", "reclassification", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(base, Vat.VatControlReclassificationView, { signal });
      if (
        result.review.id !== id ||
        result.review.scope.bookId !== book.id ||
        result.review.scope.entityId !== book.entityId
      ) {
        throw new Error("VAT reclassification identity mismatch");
      }
      return result;
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const approve = useMutation({
    mutationFn: (input: typeof Vat.ApproveVatControlReclassification.Type) => {
      const path = `${base}/approval`;
      return readAccounting(
        path,
        Vat.VatControlReclassificationApproval,
        mutationOptions(path, JSON.stringify(input), approvalKeys.current),
      );
    },
    onSuccess: () => {
      void view.refetch();
      void client.invalidateQueries({ queryKey: [...bookKey(book), "vat-returns"] });
    },
  });
  const execute = useMutation({
    mutationFn: (input: typeof Vat.ExecuteVatControlReclassification.Type) => {
      const path = `${base}/execution`;
      return readAccounting(
        path,
        Vat.VatControlReclassificationEffect,
        mutationOptions(path, JSON.stringify(input), executionKeys.current),
      );
    },
    onSuccess: () => {
      void view.refetch();
      void client.invalidateQueries({ queryKey: [...bookKey(book), "vat-returns"] });
    },
  });
  const viewData = view.data;
  const review = viewData?.review;
  const effect = execute.data ?? viewData?.reclassification ?? null;
  const approvalHistory = [
    ...(viewData?.approvals ?? []),
    ...(approve.data ? [approve.data] : []),
  ].filter((approval, index, all) => all.findIndex((item) => item.id === approval.id) === index);
  const currentApproval = approvalHistory.at(-1);
  const selectedApproval =
    approvalHistory.find((approval) => approval.id === selectedApprovalId) ?? currentApproval;
  const basisCurrent = !effect && viewData?.liveBasisCheckedAt !== null && viewData !== undefined;
  const expired = selectedApproval ? Date.parse(selectedApproval.expiresAt) <= Date.now() : false;
  const newProposal = requiresNewProposal(approve.error) || requiresNewProposal(execute.error);
  const uncertainWrite = isUncertainWriteError(approve.error) || isUncertainWriteError(execute.error);
  const busy = view.isFetching || approve.isPending || execute.isPending;
  const approvalRequestKey = approve.variables
    ? approvalKeys.current.get(
        `${base}/approval:${JSON.stringify(approve.variables)}`,
      )
    : undefined;
  const executionRequestKey = execute.variables
    ? executionKeys.current.get(
        `${base}/execution:${JSON.stringify(execute.variables)}`,
      )
    : undefined;
  const actionDisabled = reviewActionDisabled({
    bookRole: book.role,
    acknowledged,
    basisCurrent,
    hasEffect: Boolean(effect),
    hasCurrentApproval: Boolean(currentApproval && !expired),
    hasSelectedApproval: Boolean(selectedApproval),
    expired,
    newProposal,
    uncertainWrite,
    busy,
  });
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <WorkflowSteps
        label={labels.workflow}
        labels={[labels.prepared, labels.approved, labels.executed]}
        current={effect ? 2 : currentApproval ? 1 : 0}
      />
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      {review ? (
        <ReviewBody
          book={book}
          locale={locale}
          review={review}
          effect={effect}
          viewData={viewData}
          basisCurrent={basisCurrent}
          approvalHistory={approvalHistory}
          selectedApproval={selectedApproval}
          setSelectedApprovalId={setSelectedApprovalId}
          acknowledged={acknowledged}
          setAcknowledged={setAcknowledged}
          busy={busy}
          approvalDisabled={actionDisabled.approval}
          executionDisabled={actionDisabled.execution}
          approving={approve.isPending}
          executing={execute.isPending}
          approveError={approve.error}
          executeError={execute.error}
          approveIsError={approve.isError}
          executeIsError={execute.isError}
          newProposal={newProposal}
          uncertainWrite={uncertainWrite}
          approvalRequestKey={approvalRequestKey}
          executionRequestKey={executionRequestKey}
          onApprove={() => {
            approve.mutate({
              expectedReviewDigest: review.digest,
              acknowledgeSyntheticOnly: true,
            });
          }}
          onExecute={() => {
            if (selectedApproval) {
              execute.mutate({
                expectedReviewDigest: review.digest,
                acknowledgeSyntheticOnly: true,
                approvalId: selectedApproval.id,
              });
            }
          }}
          onOpen={onOpen}
        />
      ) : null}
    </Box>
  );
}

function ReviewBody(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  review: Review;
  effect: ReclassificationEffect | null;
  viewData: ReviewView | undefined;
  basisCurrent: boolean;
  approvalHistory: Approval[];
  selectedApproval: Approval | undefined;
  setSelectedApprovalId: (value: string) => void;
  acknowledged: boolean;
  setAcknowledged: (value: boolean) => void;
  busy: boolean;
  approvalDisabled: boolean;
  executionDisabled: boolean;
  approving: boolean;
  executing: boolean;
  approveError: Error | null;
  executeError: Error | null;
  approveIsError: boolean;
  executeIsError: boolean;
  newProposal: boolean;
  uncertainWrite: boolean;
  approvalRequestKey: string | undefined;
  executionRequestKey: string | undefined;
  onApprove: () => void;
  onExecute: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <ReviewSummary
        locale={props.locale}
        review={props.review}
        effect={props.effect}
        liveBasisCheckedAt={props.viewData?.liveBasisCheckedAt ?? null}
        basisCurrent={props.basisCurrent}
      />
      <ReviewBasis locale={props.locale} review={props.review} />
      <ReviewContributions locale={props.locale} review={props.review} />
      <ReviewPostingLines locale={props.locale} review={props.review} />
      <ReviewApprovalHistory locale={props.locale} approvalHistory={props.approvalHistory} />
      {props.effect ? <ReviewReceipt locale={props.locale} effect={props.effect} /> : null}
      {!props.effect ? (
        <ReviewActions
          book={props.book}
          locale={props.locale}
          effect={props.effect}
          approvalHistory={props.approvalHistory}
          selectedApproval={props.selectedApproval}
          setSelectedApprovalId={props.setSelectedApprovalId}
          acknowledged={props.acknowledged}
          setAcknowledged={props.setAcknowledged}
          busy={props.busy}
          approvalDisabled={props.approvalDisabled}
          executionDisabled={props.executionDisabled}
          approving={props.approving}
          executing={props.executing}
          approveError={props.approveError}
          executeError={props.executeError}
          newProposal={props.newProposal}
          uncertainWrite={props.uncertainWrite}
          onApprove={props.onApprove}
          onExecute={props.onExecute}
        />
      ) : null}
      <ReviewStatusAndRecovery
        book={props.book}
        locale={props.locale}
        onOpen={props.onOpen}
        approving={props.approving}
        executing={props.executing}
        approveError={props.approveError}
        executeError={props.executeError}
        approveIsError={props.approveIsError}
        executeIsError={props.executeIsError}
        approvalRequestKey={props.approvalRequestKey}
        executionRequestKey={props.executionRequestKey}
      />
    </>
  );
}

function ReviewSummary(props: {
  locale: Locale;
  review: Review;
  effect: ReclassificationEffect | null;
  liveBasisCheckedAt: string | null;
  basisCurrent: boolean;
}) {
  const copy = vatCopy(props.locale);
  const labels = reclassificationCopy(props.locale);
  return (
    <>
      <RecordHeading
        title={`${labels.review} ${props.review.id}`}
        subtitle={`${props.review.input.draftId} · ${copy.digest} ${props.review.digest}`}
      />
      <RecordSummary>
        <RecordFact label={labels.exactNet}>{props.review.basis.amounts.accountingNetMinor}</RecordFact>
        <RecordFact label={labels.obligation}>{props.review.basis.obligation.id}</RecordFact>
        <RecordFact label={labels.profile}>{props.review.basis.profile.profile}</RecordFact>
        <RecordFact label={labels.basisState}>
          {props.effect
            ? labels.committed
            : props.basisCurrent
              ? labels.current
              : labels.stale}
        </RecordFact>
        <RecordFact label={labels.liveBasisCheckedAt}>
          {props.effect ? labels.notChecked : props.liveBasisCheckedAt ?? labels.stale}
        </RecordFact>
      </RecordSummary>
      {!props.effect && !props.basisCurrent ? (
        <Text role="alert">{labels.staleDetail}</Text>
      ) : null}
      <Text>{labels.rationale}: {props.review.input.rationale}</Text>
      <Text>
        {labels.syntheticBoundaryShort} · {props.review.input.acknowledgeSyntheticOnly
          ? copy.confirmed
          : copy.unknown}
      </Text>
    </>
  );
}

function ReviewBasis(props: { locale: Locale; review: Review }) {
  const copy = vatCopy(props.locale);
  const labels = reclassificationCopy(props.locale);
  return (
    <RecordColumns>
      <RecordSection title={labels.obligationAndProfile}>
        <DataTable
          title={labels.obligationAndProfile}
          narrow="stack"
          columns={[
            { id: "field", label: labels.field },
            { id: "value", label: labels.value },
          ]}
          rows={[
            { id: "profile", cells: [labels.profile, props.review.basis.profile.profile] },
            {
              id: "profileVersion",
              cells: [labels.profileVersion, props.review.basis.profile.profileVersion],
            },
            { id: "profileDigest", cells: [copy.digest, props.review.basis.profile.digest] },
            { id: "scheme", cells: [labels.scheme, props.review.basis.profile.scheme] },
            { id: "obligation", cells: [labels.obligation, props.review.basis.obligation.id] },
            {
              id: "registration",
              cells: [labels.registration, props.review.basis.obligation.registrationId],
            },
            {
              id: "jurisdiction",
              cells: [labels.jurisdiction, props.review.basis.obligation.jurisdiction],
            },
            {
              id: "obligationDates",
              cells: [
                labels.period,
                `${props.review.basis.obligation.startsOn} – ${props.review.basis.obligation.endsOn}`,
              ],
            },
            {
              id: "period",
              cells: [
                labels.accountingPeriod,
                `${props.review.basis.period.id} · ${props.review.basis.period.version}`,
              ],
            },
            { id: "coverage", cells: [labels.coverage, props.review.basis.coverage] },
            { id: "legal", cells: [labels.legalProfile, String(props.review.basis.legalProfileActive)] },
            {
              id: "matched",
              cells: [labels.taxAccountMatched, String(props.review.basis.taxAccountMatched)],
            },
          ]}
        />
      </RecordSection>
      <RecordSection title={labels.accountRoles}>
        <DataTable
          title={labels.accountRoles}
          narrow="stack"
          columns={[
            { id: "role", label: labels.role },
            { id: "account", label: labels.account },
            { id: "version", label: labels.version, numeric: true },
            { id: "state", label: copy.state },
          ]}
          rows={props.review.basis.accountRoles.map((role) => ({
            id: role.role,
            cells: [
              labels.roleName(role.role),
              `${role.code} · ${role.name} · ${role.accountId}`,
              role.accountVersion,
              role.active ? labels.active : labels.inactive,
            ],
          }))}
        />
      </RecordSection>
    </RecordColumns>
  );
}

function ReviewContributions(props: { locale: Locale; review: Review }) {
  const labels = reclassificationCopy(props.locale);
  return (
    <RecordSection title={labels.sourceContributions}>
      <DataTable
        title={labels.sourceContributions}
        narrow="stack"
        columns={[
          { id: "fact", label: labels.fact },
          { id: "source", label: labels.sourceLine },
          { id: "role", label: labels.role },
          { id: "debit", label: labels.debit, numeric: true },
          { id: "credit", label: labels.credit, numeric: true },
          { id: "balance", label: labels.balance, numeric: true },
        ]}
        rows={props.review.basis.contributions.map((line) => ({
          id: `${line.voucherId}:${line.lineId}`,
          cells: [
            `${line.factId} · ${line.factRevisionId} · ${line.factRevision}`,
            `${line.voucherId} · ${line.lineId} · ${line.accountId}`,
            labels.roleName(line.role),
            line.debitMinor,
            line.creditMinor,
            line.balanceMinor,
          ],
        }))}
      />
    </RecordSection>
  );
}

function ReviewPostingLines(props: { locale: Locale; review: Review }) {
  const copy = vatCopy(props.locale);
  const labels = reclassificationCopy(props.locale);
  return (
    <RecordSection title={labels.proposedPostingLines}>
      {props.review.postingPlan ? (
        <Text>
          {labels.changeSet}: {props.review.postingPlan.id} · {copy.digest} {props.review.postingPlan.planDigest}
        </Text>
      ) : null}
      {props.review.basis.postingLines.length ? (
        <DataTable
          title={labels.proposedPostingLines}
          narrow="stack"
          columns={[
            { id: "line", label: labels.line },
            { id: "account", label: labels.account },
            { id: "debit", label: labels.debit, numeric: true },
            { id: "credit", label: labels.credit, numeric: true },
            { id: "description", label: labels.description },
          ]}
          rows={props.review.basis.postingLines.map((line) => ({
            id: line.lineId,
            cells: [line.lineId, line.accountId, line.debitMinor, line.creditMinor, line.description],
          }))}
        />
      ) : (
        <Text>{labels.noPostingLines}</Text>
      )}
    </RecordSection>
  );
}

function ReviewApprovalHistory(props: { locale: Locale; approvalHistory: Approval[] }) {
  const copy = vatCopy(props.locale);
  const labels = reclassificationCopy(props.locale);
  return (
    <RecordSection title={labels.approvalHistory}>
      {props.approvalHistory.length ? (
        <DataTable
          title={labels.approvalHistory}
          narrow="stack"
          columns={[
            { id: "approval", label: labels.approval },
            { id: "actor", label: labels.actor },
            { id: "expires", label: labels.expires },
            { id: "digest", label: copy.digest },
            { id: "state", label: copy.state },
          ]}
          rows={props.approvalHistory.map((approval) => ({
            id: approval.id,
            cells: [
              approval.id,
              approval.actorId,
              approval.expiresAt,
              approval.digest,
              Date.parse(approval.expiresAt) <= Date.now() ? labels.expired : labels.current,
            ],
          }))}
        />
      ) : (
        <Text>{labels.noApprovals}</Text>
      )}
    </RecordSection>
  );
}

function ReviewReceipt(props: { locale: Locale; effect: ReclassificationEffect }) {
  const copy = vatCopy(props.locale);
  const labels = reclassificationCopy(props.locale);
  return (
    <RecordSection title={labels.effect}>
      <Box role="status" display="grid" gap="sm">
        <Text>
          {labels.outcome}: {labels.effectOutcome(props.effect.outcome)}
        </Text>
        <Text>
          {labels.effectId}: {props.effect.id} · {copy.digest} {props.effect.digest}
        </Text>
        <Text>
          {labels.approvalId}: {props.effect.approvalId} · {labels.changeSet}: {props.effect.changeSetId ?? "—"} · {labels.voucherId}: {props.effect.voucherId ?? "—"}
        </Text>
        {props.effect.postingReceipt ? (
          <Text>
            {labels.postingReceipt}: {props.effect.postingReceipt.id} · {props.effect.postingReceipt.voucherNumber} · {props.effect.postingReceipt.committedAt}
          </Text>
        ) : (
          <Text>{labels.noEffectResult}</Text>
        )}
      </Box>
    </RecordSection>
  );
}

function ReviewActions(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  effect: ReclassificationEffect | null;
  approvalHistory: Approval[];
  selectedApproval: Approval | undefined;
  setSelectedApprovalId: (value: string) => void;
  acknowledged: boolean;
  setAcknowledged: (value: boolean) => void;
  busy: boolean;
  approvalDisabled: boolean;
  executionDisabled: boolean;
  approving: boolean;
  executing: boolean;
  approveError: Error | null;
  executeError: Error | null;
  newProposal: boolean;
  uncertainWrite: boolean;
  onApprove: () => void;
  onExecute: () => void;
}) {
  const labels = reclassificationCopy(props.locale);
  return (
    <RecordSection title={labels.actions}>
      <Text>{props.book.role === "operator" ? labels.approvalOperator : labels.approvalAgent}</Text>
      <Box as="label" display="flex" alignItems="center" gap="md">
        <input
          type="checkbox"
          checked={props.acknowledged}
          disabled={props.busy || Boolean(props.effect) || props.uncertainWrite}
          onChange={(event) => props.setAcknowledged(event.target.checked)}
        />
        <Text>{labels.acknowledge}</Text>
      </Box>
      {props.approvalHistory.length ? (
        <SelectField
          label={labels.approvalToExecute}
          value={props.selectedApproval?.id ?? null}
          onValueChange={(value) => props.setSelectedApprovalId(value ?? "")}
          disabled={props.uncertainWrite}
          options={props.approvalHistory.map((approval) => ({
            value: approval.id,
            label: `${approval.id} · ${approval.actorId} · ${approval.expiresAt}`,
          }))}
        />
      ) : null}
      <Box display="flex" flexWrap="wrap" gap="md">
        {props.book.role === "operator" ? (
          <Button type="button" disabled={props.approvalDisabled} onClick={props.onApprove}>
            {props.approving ? labels.approving : labels.approve}
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={props.executionDisabled} onClick={props.onExecute}>
          {props.executing ? labels.executing : labels.execute}
        </Button>
      </Box>
      {props.newProposal ? <Text role="alert">{labels.newProposal}</Text> : null}
      {isUncertainWriteError(props.approveError) ? (
        <Text role="alert">{labels.uncertain}</Text>
      ) : null}
      {isUncertainWriteError(props.executeError) ? (
        <Text role="alert">{labels.uncertain}</Text>
      ) : null}
    </RecordSection>
  );
}

function ReviewStatusAndRecovery(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onOpen: (id: string) => void;
  approving: boolean;
  executing: boolean;
  approveError: Error | null;
  executeError: Error | null;
  approveIsError: boolean;
  executeIsError: boolean;
  approvalRequestKey: string | undefined;
  executionRequestKey: string | undefined;
}) {
  return (
    <>
      <AccountingStatus
        locale={props.locale}
        write
        pending={props.approving || props.executing}
        error={props.approveError ?? props.executeError}
      />
      {props.approvalRequestKey && props.approveIsError ? (
        <RequestRecovery
          key={props.approvalRequestKey}
          book={props.book}
          locale={props.locale}
          requestKey={props.approvalRequestKey}
          onOpen={props.onOpen}
        />
      ) : null}
      {props.executionRequestKey && props.executeIsError ? (
        <RequestRecovery
          key={props.executionRequestKey}
          book={props.book}
          locale={props.locale}
          requestKey={props.executionRequestKey}
          onOpen={props.onOpen}
        />
      ) : null}
    </>
  );
}

function RequestRecovery({
  book,
  locale,
  requestKey,
  onOpen,
}: Pick<Props, "book" | "locale" | "onOpen"> & { requestKey: string }) {
   const labels = reclassificationCopy(locale);
   const client = useQueryClient();
   const [key, setKey] = useState(requestKey);
   const recovery = useMutation({
    mutationFn: (value: string) =>
      readAccounting(
        `${bookPath(book)}/vat-returns/reclassifications/requests/${encodeURIComponent(value)}`,
         Vat.VatControlReclassificationRecovery,
       ),
     onSuccess: () => {
       void client.invalidateQueries({ queryKey: [...bookKey(book), "vat-returns"] });
     },
   });
  return (
    <RecordSection title={labels.recovery}>
      <Text>{labels.recoveryHelp}</Text>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("requestKey");
          if (!Schema.is(Accounting.IdempotencyHeaders.fields["idempotency-key"])(value)) return;
          setKey(value);
          recovery.mutate(value);
        }}
      >
        <InputField
          label={labels.requestKey}
          name="requestKey"
          value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
          required
          minLength={8}
          maxLength={128}
        />
        <Box>
          <Button type="submit" variant="outline" disabled={recovery.isPending}>
            {recovery.isPending ? labels.recovering : labels.recover}
          </Button>
        </Box>
      </Box>
      <AccountingStatus locale={locale} pending={recovery.isPending} error={recovery.error} />
      {recovery.data ? <RecoveryResult result={recovery.data.result} locale={locale} onOpen={onOpen} /> : null}
    </RecordSection>
  );
}

function RecoveryResult({
  result,
  locale,
  onOpen,
}: {
  result: typeof Vat.VatControlReclassificationCommandResult.Type;
  locale: Locale;
  onOpen: (id: string) => void;
}) {
  const copy = vatCopy(locale);
  const labels = reclassificationCopy(locale);
  const reviewId = Schema.is(Vat.VatControlReclassificationReview)(result)
    ? result.id
    : result.reviewId;
  const digest = Schema.is(Vat.VatControlReclassificationReview)(result)
    ? result.digest
    : Schema.is(Vat.VatControlReclassificationApproval)(result)
      ? result.digest
      : result.digest;
  return (
    <Box role="status" display="grid" gap="sm" minWidth="zero">
      <Text>
        {labels.recovered}: {Schema.is(Vat.VatControlReclassificationReview)(result)
          ? labels.prepared
          : Schema.is(Vat.VatControlReclassificationApproval)(result)
            ? labels.approved
            : labels.executed}
      </Text>
      <Text>
        {labels.review}: {reviewId} · {copy.digest} {digest}
      </Text>
      {Schema.is(Vat.VatControlReclassificationApproval)(result) ? (
        <Text>
          {labels.actor}: {result.actorId} · {labels.expires}: {result.expiresAt}
        </Text>
      ) : null}
      {Schema.is(Vat.VatControlReclassificationEffect)(result) ? (
        <Text>
          {labels.effectId}: {result.id} · {labels.outcome}: {labels.effectOutcome(result.outcome)} · {labels.voucherId}: {result.voucherId ?? "—"}
        </Text>
      ) : null}
      <Box>
        <Button type="button" variant="outline" onClick={() => onOpen(reviewId)}>
          {labels.openReview}
        </Button>
      </Box>
    </Box>
  );
}

function reclassificationCopy(locale: Locale) {
  return locale === "sv" ? sv : en;
}

const en = {
  title: "VAT control reclassification",
  subtitle: "Prepare, review and execute a retained synthetic VAT control reclassification.",
  boundary:
    "Synthetic-only boundary: this surface retains a review and may post an internal synthetic reclassification. It does not activate a legal VAT profile, assess tax, transfer cash or submit a return.",
  saved: "Saved VAT reclassifications",
  savedResult: "Saved. Opening the retained review.",
  noReviews: "No saved VAT reclassifications. Open a saved synthetic VAT draft to prepare one.",
  noDrafts: "No saved VAT drafts. Prepare a VAT draft before starting a reclassification.",
  action: "Next step",
  prepare: "Prepare reclassification",
  prepareTitle: "Prepare VAT control reclassification",
  syntheticDraftRequired: "This saved draft is not a synthetic demonstration. Only a saved synthetic demonstration can enter this flow.",
  operatorOnly: "Only an admitted operator can prepare this financial review.",
  accountsAndPeriod: "Account roles and period",
  accountHelp: "Select the three roles from the current book setup. This surface does not infer roles from BAS numbers.",
  outputAccount: "Output VAT control account",
  inputAccount: "Input VAT control account",
  settlementAccount: "VAT settlement control account",
  accountingPeriod: "Accounting period",
  reviewAndPosting: "Review evidence and posting",
  roleEvidenceId: "Account-role evidence ID",
  reviewEvidenceId: "Review evidence ID",
  postingDate: "Posting date",
  series: "Series",
  rationale: "Rationale",
  acknowledge: "I acknowledge that this command is synthetic-only and does not file or assess VAT.",
  invalid: "Check the required fields, IDs, date, series and acknowledgement. Your entries are retained.",
  workflow: "VAT reclassification workflow",
  prepared: "Prepared",
  approved: "Approved",
  executed: "Executed",
  review: "Review",
  exactNet: "Exact net",
  obligation: "Reporting obligation",
  profile: "Profile",
  basisState: "Basis state",
  current: "Current",
  stale: "Stale",
  committed: "Committed",
  liveBasisCheckedAt: "Live basis checked at",
  notChecked: "Not checked after execution",
  staleDetail: "The live basis could not be established. Prepare a new reclassification proposal from a current saved draft.",
  syntheticBoundaryShort: "Synthetic-only review",
  obligationAndProfile: "Obligation and profile",
  field: "Field",
  value: "Value",
  profileVersion: "Profile version",
  scheme: "Scheme",
  registration: "Registration",
  jurisdiction: "Jurisdiction",
  period: "Period",
  coverage: "Coverage",
  legalProfile: "Legal profile active",
  taxAccountMatched: "Tax account matched",
  accountRoles: "Account-role bindings",
  role: "Role",
  roleName: (role: string): string =>
    role === "output_vat_control"
      ? "Output VAT control"
      : role === "input_vat_control"
        ? "Input VAT control"
        : "VAT settlement control",
  account: "Account",
  version: "Version",
  state: "State",
  active: "Active",
  inactive: "Inactive",
  sourceContributions: "Source contribution lines",
  fact: "Fact and revision",
  sourceLine: "Source line",
  debit: "Debit",
  credit: "Credit",
  balance: "Balance",
  proposedPostingLines: "Proposed posting lines",
  changeSet: "Change set",
  line: "Line",
  description: "Description",
  noPostingLines: "No posting lines are proposed. Execution will record a no-effect result.",
  approvalHistory: "Approval history",
  approval: "Approval",
  actor: "Actor",
  expires: "Expires",
  expired: "Expired",
  noApprovals: "No approval exists yet.",
  effect: "Committed effect",
  outcome: "Outcome",
  effectId: "Effect ID",
  approvalId: "Approval ID",
  voucherId: "Voucher ID",
  postingReceipt: "Posting receipt",
  noEffectResult: "No effect: no change set, voucher or posting receipt was created.",
  effectOutcome: (outcome: string): string => (outcome === "posted" ? "Posted" : "No effect"),
  actions: "Approval and execution",
  approvalOperator: "Only an operator can approve. An authorized agent can execute after an approval exists.",
  approvalAgent: "An operator must approve before execution. You can execute after an approval exists.",
  approvalToExecute: "Approval to execute",
  approve: "Approve reclassification",
  approving: "Approving…",
  execute: "Execute reclassification",
  executing: "Executing…",
  newProposal: "The stored proposal is no longer current. Prepare a new reclassification proposal.",
  uncertain: "The write may have committed. Recover the original request before retrying it.",
  recovery: "Recover an original request",
  recoveryHelp: "Enter the original idempotency key. Recovery reads its committed review, approval or effect without creating another request.",
  requestKey: "Original request key",
  recover: "Recover request",
  recovering: "Recovering…",
  recovered: "Recovered command",
  openReview: "Open retained review",
};

const sv: typeof en = {
  ...en,
  title: "Omklassning av momskonton",
  subtitle: "Förbered, granska och utför en sparat syntetisk omklassning av momskonton.",
  boundary:
    "Endast syntetiskt område: ytan sparar en granskning och kan bokföra en intern syntetisk omklassning. Den aktiverar ingen rättslig momsprofil, bedömer inte skatt, överför inga pengar och lämnar ingen deklaration.",
  saved: "Sparade momsomklassningar",
  savedResult: "Sparat. Den sparade granskningen öppnas.",
  noReviews: "Inga sparade momsomklassningar. Öppna ett sparat syntetiskt momsutkast för att förbereda en.",
  noDrafts: "Inga sparade momsutkast. Förbered ett momsutkast innan omklassningen börjar.",
  action: "Nästa steg",
  prepare: "Förbered omklassning",
  prepareTitle: "Förbered omklassning av momskonton",
  syntheticDraftRequired: "Det sparade utkastet är inte ett syntetiskt demonstrationsutkast. Endast ett sparat syntetiskt demonstrationsutkast kan gå vidare här.",
  operatorOnly: "Endast en behörig operatör kan förbereda den här finansiella granskningen.",
  accountsAndPeriod: "Kontoroller och period",
  accountHelp: "Välj de tre rollerna från bokens aktuella grunduppsättning. Ytan härleder inga roller från BAS-nummer.",
  outputAccount: "Utgående momskonto",
  inputAccount: "Ingående momskonto",
  settlementAccount: "Momskonto för avstämning",
  accountingPeriod: "Redovisningsperiod",
  reviewAndPosting: "Granskningsunderlag och bokföring",
  roleEvidenceId: "ID för underlag för konto roller",
  reviewEvidenceId: "ID för granskningsunderlag",
  postingDate: "Bokföringsdatum",
  series: "Serie",
  rationale: "Motivering",
  acknowledge: "Jag bekräftar att kommandot endast gäller syntetiska exempel och inte lämnar eller bedömer moms.",
  invalid: "Kontrollera obligatoriska fält, ID, datum, serie och bekräftelse. Dina uppgifter finns kvar.",
  workflow: "Arbetsflöde för momsomklassning",
  prepared: "Förberedd",
  approved: "Godkänd",
  executed: "Utförd",
  review: "Granskning",
  exactNet: "Exakt netto",
  obligation: "Rapporteringsskyldighet",
  profile: "Profil",
  basisState: "Grundens läge",
  current: "Aktuell",
  stale: "Föråldrad",
  committed: "Bokförd",
  liveBasisCheckedAt: "Aktuell grund kontrollerad",
  notChecked: "Kontrolleras inte efter utförande",
  staleDetail: "Den aktuella grunden kunde inte fastställas. Förbered en ny omklassning från ett aktuellt sparat utkast.",
  syntheticBoundaryShort: "Granskning endast för syntetiska exempel",
  obligationAndProfile: "Skyldighet och profil",
  field: "Fält",
  value: "Värde",
  profileVersion: "Profilversion",
  scheme: "Ordning",
  registration: "Registrering",
  jurisdiction: "Jurisdiktion",
  period: "Period",
  coverage: "Täckning",
  legalProfile: "Rättslig profil aktiv",
  taxAccountMatched: "Momskonto matchat",
  accountRoles: "Kontoroller",
  role: "Roll",
  roleName: (role: string): string =>
    role === "output_vat_control"
      ? "Utgående momskonto"
      : role === "input_vat_control"
        ? "Ingående momskonto"
        : "Momskonto för avstämning",
  account: "Konto",
  version: "Version",
  state: "Läge",
  active: "Aktivt",
  inactive: "Inaktivt",
  sourceContributions: "Bidragsrader från källor",
  fact: "Faktum och version",
  sourceLine: "Källrad",
  debit: "Debet",
  credit: "Kredit",
  balance: "Saldo",
  proposedPostingLines: "Foreslagna bokföringsrader",
  changeSet: "Ändringsuppsättning",
  line: "Rad",
  description: "Beskrivning",
  noPostingLines: "Inga bokföringsrader föreslås. Utförandet registrerar ett resultat utan effekt.",
  approvalHistory: "Godkännandehistorik",
  approval: "Godkännande",
  actor: "Aktör",
  expires: "Gäller till",
  expired: "Utgånget",
  noApprovals: "Inget godkännande finns ännu.",
  effect: "Bokförd effekt",
  outcome: "Resultat",
  effectId: "Effekt-ID",
  approvalId: "Godkännande-ID",
  voucherId: "Verifikations-ID",
  postingReceipt: "Bokföringskvitto",
  noEffectResult: "Ingen effekt: ingen ändringsuppsättning, verifikation eller bokföringskvitto skapades.",
  effectOutcome: (outcome: string): string => (outcome === "posted" ? "Bokförd" : "Ingen effekt"),
  actions: "Godkännande och utförande",
  approvalOperator: "Endast en operatör kan godkänna. En behörig agent kan utföra efter att ett godkännande finns.",
  approvalAgent: "En operatör måste godkänna före utförandet. Du kan utföra när ett godkännande finns.",
  approvalToExecute: "Godkännande att utföra",
  approve: "Godkänn omklassning",
  approving: "Godkänner…",
  execute: "Utför omklassning",
  executing: "Utför…",
  newProposal: "Det sparade förslaget är inte längre aktuellt. Förbered ett nytt förslag.",
  uncertain: "Skrivningen kan ha bokförts. Hämta det ursprungliga anropet innan du försöker igen.",
  recovery: "Hämta ett ursprungligt anrop",
  recoveryHelp: "Ange den ursprungliga idempotensnyckeln. Hämtningen läser den bokförda granskningen, godkännandet eller effekten utan att skapa ett nytt anrop.",
  requestKey: "Ursprunglig anropsnyckel",
  recover: "Hämta anrop",
  recovering: "Hämtar…",
  recovered: "Hämtat kommando",
  openReview: "Öppna sparad granskning",
};
