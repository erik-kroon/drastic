import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Impact from "@open-erp/contracts/rule-impact";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

const decisionKinds = ["unaffected_with_reason", "reprepare", "amend", "human_review"] as const;

function decisionKindsFor(suggested: string): ReadonlyArray<string> {
  return suggested === "human_review" ? [...decisionKinds] : [suggested, "human_review"];
}

export function RuleImpactPanel(props: { book: typeof Accounting.Book.Type; locale: Locale }) {
  const { book, locale } = props;
  const sv = locale === "sv";
  const path = `${bookPath(book)}/rule-impact`;
  const [snapshotId, setSnapshotId] = useState("");

  const notices = useQuery({
    queryKey: [...bookKey(book), "rule-impact", "notices"],
    queryFn: ({ signal }) => readAccounting(path, Impact.RuleChangeNoticeList, { signal }),
  });

  const snapshots = useQuery({
    queryKey: [...bookKey(book), "rule-impact", "snapshots"],
    queryFn: ({ signal }) =>
      readAccounting(`${path}/impact`, Impact.ImpactSnapshotList, { signal }),
    enabled: snapshotId === "",
  });

  const snapshot = useQuery({
    queryKey: [...bookKey(book), "rule-impact", "snapshot", snapshotId],
    queryFn: ({ signal }) =>
      readAccounting(`${path}/impact/${encodeURIComponent(snapshotId)}`, Impact.ImpactSnapshot, {
        signal,
      }),
    enabled: snapshotId !== "",
  });

  return (
    <RecordSection title={sv ? "Regeländringspåverkan" : "Rule-change impact"}>
      <Box display="grid" gap="md" minWidth="zero">
        <Text>
          {sv
            ? "Varje notis anger en korrigerad regelrelease och dess giltighetsområde. En framtida ändring gör inte en redan godkänd period inaktuell, och en retroaktiv korrigering skriver inte om en redan producerad rapport."
            : "Each notice names a corrected rule release and its effective scope. A future change does not invalidate an already accepted period, and a retroactive correction does not rewrite a report already produced."}
        </Text>
        <AccountingStatus
          error={notices.error ?? snapshots.error ?? snapshot.error}
          pending={notices.isPending}
          locale={locale}
        />
        {notices.data?.map((notice) => (
          <Box key={notice.id} display="grid" gap="xs">
            <Text>
              {notice.oldReleaseId} → {notice.newReleaseId} · {notice.changeKind} ·{" "}
              {notice.effectiveFrom} → {notice.effectiveTo ?? "—"}
            </Text>
            <Text>
              {notice.reason} — {notice.qualificationEvidence}
            </Text>
            <Text>
              {sv ? "Berörda" : "Changed selectors"}: {notice.changedSelectors.join(", ")}
            </Text>
          </Box>
        ))}
        <Button
          type="button"
          disabled={snapshots.data === undefined}
          onClick={() => setSnapshotId("")}
        >
          {sv ? "Visa inspelade ögonblicksbilder" : "Show captured snapshots"}
        </Button>
        {snapshotId === "" &&
          snapshots.data?.map((row) => (
            <Button key={row.id} type="button" onClick={() => setSnapshotId(row.id)}>
              {row.id} · {row.noticeId} · {row.decidedTargets}/{row.totalTargets}{" "}
              {sv ? "beslutade" : "decided"}
            </Button>
          ))}
        {snapshotId !== "" && (
          <Box display="grid" gap="sm">
            <Button type="button" onClick={() => setSnapshotId("")}>
              {sv ? "Tillbaka" : "Back"}
            </Button>
            {snapshot.data?.targets.map((target) => (
              <Box key={`${target.targetKind}:${target.targetId}`} display="grid" gap="xs">
                <Text>
                  {target.targetKind} · {target.targetId} · {target.family} ·{" "}
                  {target.periodStartsOn ?? "—"} → {target.periodEndsOn ?? "—"}
                </Text>
                <Text>
                  {sv ? "Påverkan" : "Impact"}: {target.impactKind} · {sv ? "tillstånd" : "state"}:{" "}
                  {target.executionState}
                </Text>
                <Text>
                  {target.decisionKind
                    ? `${sv ? "beslut" : "decision"}: ${target.decisionKind} — ${target.decisionReason}`
                    : `${sv ? "föreslagen" : "suggested"}: ${target.suggestedDecision} (${decisionKindsFor(target.suggestedDecision).join(", ")})`}
                </Text>
              </Box>
            ))}
            {snapshot.data?.continuation && (
              <Text>{sv ? "Fler mål finns" : "More targets remain"}</Text>
            )}
          </Box>
        )}
      </Box>
    </RecordSection>
  );
}
