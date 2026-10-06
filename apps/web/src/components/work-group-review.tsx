import * as Schema from "effect/Schema";
import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type * as Workspace from "@open-erp/contracts/workspace";
import { Box } from "@open-erp/ui/components/box";
import type { Locale } from "@/paraglide/runtime";
import { Button } from "@open-erp/ui/components/button";
import {
  WorkGroupPanel,
  WorkGroupRow,
  WorkGroupSection,
  WorkGroupSummary,
  WorkGroupPosting,
  WorkGroupNote,
  WorkGroupFooter,
  WorkGroupListNote,
  WorkGroupCancel,
  WorkGroupPost,
  WorkGroupCaption,
  WorkGroupResultBanner,
  WorkGroupResultRow,
  WorkGroupResultAction,
  WorkGroupResultControls,
} from "@open-erp/ui/components/work-group-review";
import { PageAction, PageCaption } from "@open-erp/ui/components/accounting-page";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath } from "@/lib/accounting-api";
import { attentionPath, attentionState } from "@/lib/attention";
import { formatMinorAmount } from "@/lib/workspace-api";
import {
  WorkGroupRequest,
  readGroupReview,
  postGroupEntry,
  supplierGroupEligible,
  supplierGroupRoutine,
  workGroupSelectionLimit,
} from "@/lib/work-group";
import { useCommerceCommandRecovery } from "./commerce/command-recovery";
import { AccountingStatus } from "./accounting-status";

type GroupRequest = typeof WorkGroupRequest.Type;

function excludedReviewReference(view: Awaited<ReturnType<typeof readGroupReview>>) {
  return { reviewId: view.plan.id, digest: view.plan.digest };
}

function representedExcludedDraft(
  item: typeof Workspace.AttentionItem.Type,
  entry: NonNullable<GroupRequest["excludedReviews"]>[number],
  view: Awaited<ReturnType<typeof readGroupReview>> | undefined,
) {
  return (
    view !== undefined &&
    view.plan.digest === entry.digest &&
    item.kind === "supplier" &&
    item.id === view.plan.draftSnapshot.id &&
    item.key === `supplier_${view.plan.draftSnapshot.id}`
  );
}

function completeGroup(
  retained: GroupRequest | null,
  views: readonly Awaited<ReturnType<typeof readGroupReview>>[],
) {
  return (
    retained !== null &&
    new Set(retained.entries.map((entry) => entry.reviewId)).size === retained.entries.length &&
    retained.entries.every((entry) =>
      views.some(
        (view) =>
          view.plan.id === entry.reviewId &&
          view.plan.digest === entry.digest &&
          view.acceptance?.reviewId === entry.reviewId &&
          view.acceptance.reviewDigest === entry.digest,
      ),
    )
  );
}

function useWorkGroup(items: readonly (typeof Workspace.AttentionItem.Type)[]) {
  const { book, locale, setup } = useBookWorkspace();

  const sv = locale === "sv";

  const recovery = useCommerceCommandRecovery({
    book,
    path: `${bookPath(book)}/attention`,
    id: "reviewed-supplier-group-v1",
    schema: WorkGroupRequest,
  });

  const [captured, setCaptured] = useState<GroupRequest | null>(null);

  const [selected, setSelected] = useState<readonly string[]>([]);

  const [pending, setPending] = useState(false);

  const [failures, setFailures] = useState<ReadonlyMap<string, Error>>(new Map());

  const retained = captured ?? recovery.saved?.input ?? null;

  const ids = [
    ...new Set([
      ...items.flatMap((item) => (item.supplierReview ? [item.supplierReview.reviewId] : [])),
      ...selected,
      ...(retained?.entries.map((entry) => entry.reviewId) ?? []),
      ...(retained?.excludedReviews?.map((entry) => entry.reviewId) ?? []),
    ]),
  ];

  const reads = useQueries({
    queries: ids.map((id) => ({
      queryKey: [...bookKey(book), "work-group-review", id],
      queryFn: () => readGroupReview(book, id),
      staleTime: 0,
      refetchInterval: 1000,
      retry: false,
    })),
  });

  const queries = reads.map((query) => ({
    ...query,
    data: query.isError ? undefined : query.data,
  }));

  const eligible = queries.flatMap((query) =>
    query.data && supplierGroupEligible(query.data) ? [query.data] : [],
  );

  const ready =
    recovery.ready &&
    book.role === "operator" &&
    queries.every((query) => !query.isPending && !query.isFetching);

  const count =
    retained?.entries.filter((entry) =>
      queries.some(
        (query) =>
          query.data?.plan.id === entry.reviewId &&
          query.data.plan.digest === entry.digest &&
          supplierGroupEligible(query.data, entry.approvalKey),
      ),
    ).length ?? eligible.filter((view) => selected.includes(view.plan.id)).length;

  async function run() {
    if (!ready || pending || count === 0) return;

    setPending(true);

    try {
      const request = Schema.decodeSync(WorkGroupRequest)(
        retained ?? {
          excludedReviews: queries
            .flatMap((query) =>
              query.data &&
              (!selected.includes(query.data.plan.id) || !supplierGroupEligible(query.data))
                ? [excludedReviewReference(query.data)]
                : [],
            )
            .sort(
              (left, right) =>
                Number(selected.includes(right.reviewId)) -
                Number(selected.includes(left.reviewId)),
            ),
          entries: eligible
            .filter((view) => selected.includes(view.plan.id))
            .map((view) => ({
              reviewId: view.plan.id,
              digest: view.plan.digest,
              approvalKey: crypto.randomUUID(),
              executionKey: crypto.randomUUID(),
            })),
        },
      );

      recovery.retain(recovery.saved ?? { key: crypto.randomUUID(), input: request });

      setCaptured(request);

      const errors = new Map<string, Error>();

      for (const entry of request.entries) {
        try {
          await postGroupEntry(book, entry);
        } catch (error) {
          errors.set(
            entry.reviewId,
            error instanceof Error ? error : new Error("Group command failed"),
          );
        }
      }

      setFailures(errors);

      await Promise.all(queries.map((query) => query.refetch()));
    } catch (error) {
      setFailures(
        new Map([
          ["storage", error instanceof Error ? error : new Error("Recovery could not be retained")],
        ]),
      );
    } finally {
      setPending(false);
    }
  }

  const rows = ids.map((id, index) => {
    const query = queries[index];

    const view = query?.data;

    const entry = retained?.entries.find((candidate) => candidate.reviewId === id);

    const together =
      view !== undefined &&
      (supplierGroupEligible(view, entry?.approvalKey) ||
        (supplierGroupRoutine(view) && !view.dependenciesCurrent) ||
        (entry !== undefined && view.acceptance !== null));

    return { id, query, together };
  });

  const postedCount =
    retained?.entries.filter((entry) =>
      queries.some(
        (query) => query.data?.plan.id === entry.reviewId && query.data.acceptance !== null,
      ),
    ).length ?? 0;

  const detailViews = retained
    ? retained.entries.flatMap((entry) => {
        const view = queries.find((query) => query.data?.plan.id === entry.reviewId)?.data;

        return view ? [view] : [];
      })
    : eligible.filter((view) => selected.includes(view.plan.id));

  const complete = completeGroup(retained, detailViews);

  function resetCompleted() {
    if (!complete || !recovery.saved) return;

    try {
      recovery.clear(recovery.saved.key);

      setCaptured(null);

      setSelected([]);

      setFailures(new Map());
    } catch (error) {
      setFailures(
        new Map([
          ["storage", error instanceof Error ? error : new Error("Recovery could not be cleared")],
        ]),
      );
    }
  }

  return {
    book,
    items,
    locale,
    setup,
    sv,
    recovery,
    selected,
    setSelected,
    pending,
    failures,
    retained,
    queries,
    ready,
    count,
    rows,
    postedCount,
    detailViews,
    complete,
    resetCompleted,
    run,
  };
}

export function WorkGroupReview({
  items,
  onClose,
}: {
  items: readonly (typeof Workspace.AttentionItem.Type)[];
  onClose: () => void;
}) {
  const model = useWorkGroup(items);

  const { book, locale, setup, sv } = model;

  if (model.complete) return <WorkGroupResults model={model} onClose={onClose} />;

  return (
    <WorkGroupPanel
      title={sv ? "Granska i grupp" : "Review as a group"}
      breadcrumb={sv ? "Att göra" : "To do"}
      context={book.name}
      onClose={onClose}
      dismissible={!model.pending}
      detail={
        <>
          <WorkGroupSummary
            label={
              model.retained
                ? sv
                  ? "Gruppbokning"
                  : "Group posting"
                : sv
                  ? "Vald grupp"
                  : "Selected group"
            }
            count={groupSummaryCount(model.postedCount, model.count, sv)}
            title={model.detailViews
              .map((view) => view.plan.draftSnapshot.content.title)
              .join(", ")}
          />
          {model.detailViews.flatMap((view) => {
            const savedEntry = model.retained?.entries.find(
              (entry) => entry.reviewId === view.plan.id,
            );

            if (!supplierGroupEligible(view, savedEntry?.approvalKey) && view.acceptance === null)
              return [];

            const lines = view.plan.postingPlan.groups.flatMap((group) =>
              group.actions.flatMap((action) =>
                action.lines.map((line) => ({
                  id: `${group.id}:${action.occurrenceKey}:${line.lineId}`,
                  description: (() => {
                    const account = setup.accounts.find(
                      (candidate) => candidate.id === line.accountId,
                    );

                    return account ? `${account.code} ${account.name}` : line.description;
                  })(),
                  amount: formatMinorAmount(
                    BigInt(line.debitMinor) > 0n ? line.debitMinor : `-${line.creditMinor}`,
                    view.plan.draftSnapshot.content.currencyScale,
                    locale,
                  ),
                })),
              ),
            );

            return [
              <WorkGroupPosting
                key={view.plan.id}
                title={sv ? "BOKFÖRS" : "POSTING"}
                lines={lines}
              />,
            ];
          })}
          <WorkGroupNote>
            {sv
              ? "Varje verifikation får egen rad i historiken och kan rättas för sig. Om en rad ändras innan du bokför tas den bort ur gruppen."
              : "Each voucher has its own history and can be corrected separately. Changed proposals require individual review."}
          </WorkGroupNote>
          <WorkGroupFooter>
            <Box role="status" aria-live="polite">
              {model.pending ? (sv ? "Bokför…" : "Posting…") : null}
            </Box>
            <WorkGroupPost
              disabled={!model.ready || model.pending || model.count === 0}
              onClick={() => void model.run()}
            >
              {sv
                ? `Bokför ${model.count} verifikation${model.count === 1 ? "" : "er"}`
                : `Post ${model.count} voucher${model.count === 1 ? "" : "s"}`}
            </WorkGroupPost>
            {model.failures.get("storage") ? (
              <AccountingStatus locale={locale} error={model.failures.get("storage") ?? null} />
            ) : null}
            <WorkGroupCancel disabled={model.pending} onClick={onClose}>
              {sv
                ? model.retained
                  ? "Tillbaka till Att göra"
                  : "Avbryt"
                : model.retained
                  ? "Back to To do"
                  : "Cancel"}
            </WorkGroupCancel>
          </WorkGroupFooter>
        </>
      }
    >
      <AccountingStatus
        locale={locale}
        pending={!model.recovery.ready || model.queries.some((query) => query.isPending)}
        error={model.recovery.error}
      />
      {[true, false].map((together) => (
        <Box key={String(together)}>
          <WorkGroupSection
            qualifier={
              together
                ? sv
                  ? "Känd leverantör, kopplat underlag, vanlig behandling"
                  : "Known supplier, linked evidence, routine treatment"
                : undefined
            }
            count={
              model.rows.filter((row) => row.together === together).length +
              (together ? 0 : items.filter((item) => !item.supplierReview).length)
            }
          >
            {together
              ? sv
                ? "Kan bokföras tillsammans"
                : "Can be posted together"
              : sv
                ? "Granskas var för sig"
                : "Review individually"}
          </WorkGroupSection>
          {model.rows
            .filter((row) => row.together === together)
            .map(({ query, id }) => {
              if (!query) return null;

              const view = query.data;

              if (!view || id === undefined)
                return (
                  <AccountingStatus
                    key={id}
                    locale={locale}
                    pending={query.isPending}
                    error={query.error}
                  />
                );

              const entry = model.retained?.entries.find((candidate) => candidate.reviewId === id);

              const available = supplierGroupEligible(view, entry?.approvalKey);

              const included =
                available &&
                (entry !== undefined
                  ? entry.digest === view.plan.digest
                  : model.selected.includes(id));

              const error = view.acceptance ? undefined : model.failures.get(id);

              return (
                <Box key={id}>
                  <WorkGroupRow
                    individual={!together}
                    href={
                      !available && !view.acceptance
                        ? `${workspacePath(book)}/purchases?view=supplier-drafts&record=${encodeURIComponent(view.plan.draftSnapshot.id)}&review=${encodeURIComponent(id)}`
                        : undefined
                    }
                    title={view.plan.draftSnapshot.content.title}
                    amount={
                      view.plan.draftSnapshot.totals.grossMinor === null
                        ? "—"
                        : formatMinorAmount(
                            view.plan.draftSnapshot.totals.grossMinor,
                            view.plan.draftSnapshot.content.currencyScale,
                            locale,
                          )
                    }
                    evidence={`${view.plan.draftSnapshot.content.supplierDocumentNumber ?? ""} ${sv ? "kopplad" : "linked"}`}
                    treatment={[
                      ...new Set(
                        view.plan.originalLines?.map((line) => {
                          const account = setup.accounts.find(
                            (candidate) => candidate.id === line.expenseAccountId,
                          );

                          return account
                            ? `${account.code} ${account.name}`
                            : line.expenseAccountId;
                        }) ?? [],
                      ),
                    ].join(", ")}
                    changed={!view.dependenciesCurrent}
                    selected={included}
                    disabled={
                      !model.ready ||
                      model.pending ||
                      model.retained !== null ||
                      !available ||
                      (!included && model.count >= workGroupSelectionLimit)
                    }
                    onSelect={() =>
                      model.setSelected((previous) =>
                        previous.includes(id)
                          ? previous.filter((value) => value !== id)
                          : [...previous, id],
                      )
                    }
                  >
                    <WorkGroupCaption changed={!view.dependenciesCurrent}>
                      {view.acceptance
                        ? sv
                          ? "Bokfört"
                          : "Posted"
                        : available
                          ? sv
                            ? "Kan bokföras tillsammans"
                            : "Can be posted together"
                          : sv
                            ? "Granskas var för sig"
                            : "Review individually"}
                    </WorkGroupCaption>
                  </WorkGroupRow>
                  {error ? <AccountingStatus locale={locale} error={error} /> : null}
                  {view.acceptance ? (
                    <PageAction
                      quiet
                      href={`${workspacePath(book)}/books?view=vouchers&record=${encodeURIComponent(view.acceptance.postingReceipt.voucherId)}`}
                    >
                      {sv ? "Visa verifikation" : "View voucher"}
                    </PageAction>
                  ) : null}
                </Box>
              );
            })}
          {!together
            ? items
                .filter((item) => !item.supplierReview)
                .map((item) => (
                  <Box key={item.key}>
                    <PageCaption>
                      {item.title}, {attentionState(item, locale)}
                    </PageCaption>
                    <PageAction
                      quiet
                      href={attentionPath(book, item, {
                        status: "open",
                        kind: "all",
                        sort: "oldest",
                      })}
                    >
                      {sv ? "Granska nu" : "Review now"}
                    </PageAction>
                  </Box>
                ))
            : null}
        </Box>
      ))}
      <WorkGroupListNote>
        {sv
          ? "Nya leverantörer, saknade underlag och otydlig moms ingår aldrig i en grupp. Betalningar, utskick och inlämningar godkänns alltid var för sig."
          : "New suppliers, missing evidence and unclear VAT never belong to a group. Payments, dispatches and submissions are always approved individually."}
      </WorkGroupListNote>
    </WorkGroupPanel>
  );
}

function groupResultLines(model: ReturnType<typeof useWorkGroup>) {
  const totals = new Map<string, bigint>();

  for (const view of model.detailViews) {
    for (const group of view.plan.postingPlan.groups) {
      for (const action of group.actions) {
        for (const line of action.lines) {
          const amount = BigInt(line.debitMinor) - BigInt(line.creditMinor);

          totals.set(line.accountId, (totals.get(line.accountId) ?? 0n) + amount);
        }
      }
    }
  }

  const scale = model.detailViews[0]?.plan.draftSnapshot.content.currencyScale;

  if (scale === undefined) throw new Error("Completed group has no retained receipt view");

  return [...totals].map(([accountId, amount]) => {
    const account = model.setup.accounts.find((candidate) => candidate.id === accountId);

    return {
      id: accountId,
      description: account ? `${account.code} ${account.name}` : accountId,
      amount: formatMinorAmount(amount.toString(), scale, model.locale),
    };
  });
}

function groupResultAmount(
  model: ReturnType<typeof useWorkGroup>,
  view: ReturnType<typeof useWorkGroup>["detailViews"][number],
) {
  const amount = view.plan.draftSnapshot.totals.grossMinor;

  return amount === null
    ? "—"
    : formatMinorAmount(amount, view.plan.draftSnapshot.content.currencyScale, model.locale);
}

function individualGroupPath(
  model: ReturnType<typeof useWorkGroup>,
  view: ReturnType<typeof useWorkGroup>["detailViews"][number],
) {
  return `${workspacePath(model.book)}/purchases?view=supplier-drafts&record=${encodeURIComponent(view.plan.draftSnapshot.id)}&review=${encodeURIComponent(view.plan.id)}`;
}

function WorkGroupResultsDetail({
  model,
  next,
  onClose,
}: {
  model: ReturnType<typeof useWorkGroup>;
  next: Awaited<ReturnType<typeof readGroupReview>> | undefined;
  onClose: () => void;
}) {
  const { sv, locale } = model;

  return (
    <>
      <WorkGroupSummary
        label={sv ? "Gruppbokning" : "Group posting"}
        count={groupSummaryCount(model.postedCount, 0, sv)}
        title=""
      />
      <WorkGroupPosting
        title={sv ? "VAD SOM BOKFÖRDES" : "POSTED EFFECTS"}
        lines={groupResultLines(model)}
      />
      <WorkGroupPosting
        title={sv ? "EFTERÅT" : "AFTERWARDS"}
        presentation="status"
        lines={[
          {
            id: "attention",
            description: sv ? "Uppgiften i Att göra" : "To do item",
            amount: sv ? "Flyttad till Klart" : "Moved to Completed",
          },
          {
            id: "invoices",
            description: sv ? "Leverantörsfakturorna" : "Supplier invoices",
            amount: sv ? "Obetalda" : "Unpaid",
          },
        ]}
      />
      <WorkGroupNote>
        {sv
          ? "Rättelser görs på verifikationen, inte på gruppen."
          : "Corrections belong to each voucher, not the group."}
      </WorkGroupNote>
      <WorkGroupFooter>
        {next ? (
          <WorkGroupResultAction href={individualGroupPath(model, next)}>
            {sv
              ? `Granska ${next.plan.draftSnapshot.content.title} nu`
              : `Review ${next.plan.draftSnapshot.content.title} now`}
          </WorkGroupResultAction>
        ) : null}
        {model.failures.get("storage") ? (
          <AccountingStatus locale={locale} error={model.failures.get("storage") ?? null} />
        ) : null}
        <WorkGroupResultControls>
          <WorkGroupCancel disabled={model.pending} onClick={onClose}>
            {sv ? "Tillbaka till Att göra" : "Back to To do"}
          </WorkGroupCancel>
          <WorkGroupCancel disabled={model.pending} onClick={model.resetCompleted}>
            {sv ? "Granska i grupp" : "Review as a group"}
          </WorkGroupCancel>
        </WorkGroupResultControls>
      </WorkGroupFooter>
    </>
  );
}

function WorkGroupResults({
  model,
  onClose,
}: {
  model: ReturnType<typeof useWorkGroup>;
  onClose: () => void;
}) {
  const { book, sv, locale } = model;

  const retainedIds = new Set(model.retained?.entries.map((entry) => entry.reviewId));

  const originalExcluded = model.retained?.excludedReviews ?? [];

  const excluded = [
    ...originalExcluded.flatMap((entry) => {
      const row = model.rows.find((candidate) => candidate.id === entry.reviewId);

      if (row?.query?.data && row.query.data.plan.digest !== entry.digest)
        throw new Error("Excluded review identity changed");

      return row ? [row] : [];
    }),
    ...model.rows.filter(
      (row) =>
        !retainedIds.has(row.id) && !originalExcluded.some((entry) => entry.reviewId === row.id),
    ),
  ];

  const unsupported = model.items.filter(
    (item) =>
      !item.supplierReview &&
      !originalExcluded.some((entry) => {
        const view = model.rows.find((row) => row.id === entry.reviewId)?.query?.data;

        return representedExcludedDraft(item, entry, view);
      }),
  );

  const next = excluded.find((row) => row.query?.data)?.query?.data;

  return (
    <WorkGroupPanel
      title={sv ? "Granska i grupp" : "Review as a group"}
      breadcrumb={sv ? "Att göra" : "To do"}
      context={book.name}
      onClose={onClose}
      dismissible={!model.pending}
      detail={<WorkGroupResultsDetail model={model} next={next} onClose={onClose} />}
    >
      <WorkGroupResultBanner>
        {sv
          ? `${model.postedCount} av ${model.postedCount} valda är bokförda. Ändrade och nya förslag bokfördes inte.`
          : `${model.postedCount} of ${model.postedCount} selected proposals are posted. Changed and new proposals were not posted.`}
      </WorkGroupResultBanner>
      <WorkGroupSection>{sv ? "Resultat per rad" : "Individual results"}</WorkGroupSection>
      {model.detailViews.map((view) => {
        const receipt = view.acceptance;

        if (!receipt) throw new Error("Completed group result has no native receipt");

        const line = view.plan.originalLines?.[0];

        const account = model.setup.accounts.find(
          (candidate) => candidate.id === line?.expenseAccountId,
        );

        return (
          <WorkGroupResultRow
            key={view.plan.id}
            posted
            title={view.plan.draftSnapshot.content.title}
            caption={
              account
                ? `${account.code} ${account.name}, ${sv ? "egen verifikation" : "individual voucher"}`
                : undefined
            }
            status={sv ? "Bokförd" : "Posted"}
            amount={groupResultAmount(model, view)}
            href={`${workspacePath(book)}/books?view=vouchers&record=${encodeURIComponent(receipt.postingReceipt.voucherId)}`}
            action={sv ? "Visa verifikation" : "View voucher"}
          />
        );
      })}
      <WorkGroupSection count={excluded.length + unsupported.length}>
        {sv ? "Fanns inte i gruppen, oförändrade" : "Outside the group, unchanged"}
      </WorkGroupSection>
      {excluded.map((row) => {
        const view = row.query?.data;

        if (!view)
          return (
            <AccountingStatus
              key={row.id}
              locale={locale}
              pending={row.query?.isPending}
              error={row.query?.error ?? null}
            />
          );

        return (
          <WorkGroupResultRow
            key={row.id}
            posted={false}
            title={view.plan.draftSnapshot.content.title}
            status={sv ? "Granskas var för sig" : "Review individually"}
            amount={groupResultAmount(model, view)}
          />
        );
      })}
      {unsupported.map((item) => (
        <WorkGroupResultRow
          key={item.key}
          posted={false}
          title={item.title}
          status={attentionState(item, locale)}
          amount={
            item.amountMinor === null || item.currencyScale === null
              ? "—"
              : formatMinorAmount(item.amountMinor, item.currencyScale, locale)
          }
          href={attentionPath(book, item, { status: "open", kind: "all", sort: "oldest" })}
          action={sv ? "Granska nu" : "Review now"}
        />
      ))}
    </WorkGroupPanel>
  );
}

export function WorkGroupEntry({
  role,
  status,
  locale,
  onOpen,
}: {
  role: "operator" | "agent";
  status: string;
  locale: Locale;
  onOpen: () => void;
}) {
  if (role !== "operator" || status !== "open") return null;

  return (
    <Button variant="outline" onClick={onOpen}>
      {locale === "sv" ? "Granska i grupp" : "Review as a group"}
    </Button>
  );
}

function groupSummaryCount(posted: number, selected: number, sv: boolean) {
  if (posted > 0)
    return sv
      ? `${posted} verifikation${posted === 1 ? " bokförd" : "er bokförda"}`
      : `${posted} posted voucher${posted === 1 ? "" : "s"}`;

  return sv
    ? `${selected} verifikation${selected === 1 ? "" : "er"}`
    : `${selected} voucher${selected === 1 ? "" : "s"}`;
}
