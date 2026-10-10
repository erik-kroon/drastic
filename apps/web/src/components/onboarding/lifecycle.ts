import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import * as Onboarding from "@open-erp/contracts/onboarding";
import { useBookWorkspace } from "@/lib/book-context";
import { bookPath } from "@/lib/accounting-api";
import { useOnboardingCommand } from "./data";

export type Lifecycle = typeof Onboarding.OnboardingLifecycle.Type;

export type OnboardingCase = typeof Onboarding.OnboardingCase.Type;

export type Workspace = typeof Onboarding.OnboardingWorkspace.Type;

export type Snapshot = typeof Onboarding.OnboardingSnapshot.Type;

export function currentSnapshot(
  lifecycle: Lifecycle,
  purpose: typeof Onboarding.OnboardingPurpose.Type,
) {
  return lifecycle.snapshots
    .filter((item) => item.current && item.snapshot.purpose === purpose)
    .toSorted((a, b) => b.snapshot.capturedAt.localeCompare(a.snapshot.capturedAt))[0]?.snapshot;
}

export function latestSnapshot(
  lifecycle: Lifecycle,
  purpose: typeof Onboarding.OnboardingPurpose.Type,
) {
  return lifecycle.snapshots
    .filter((item) => item.snapshot.purpose === purpose)
    .toSorted((a, b) => b.snapshot.capturedAt.localeCompare(a.snapshot.capturedAt))[0]?.snapshot;
}

export function hasDecision(
  lifecycle: Lifecycle,
  snapshot: Snapshot | undefined,
  kind: typeof Onboarding.OnboardingDecision.Type.decision.kind,
) {
  return (
    !!snapshot &&
    lifecycle.decisions.some(
      (item) =>
        item.snapshotId === snapshot.id &&
        item.snapshotDigest === snapshot.digest &&
        item.decision.kind === kind,
    )
  );
}

export function snapshotInput(
  workspace: Workspace,
  lifecycle: Lifecycle,
  purpose: typeof Onboarding.OnboardingPurpose.Type,
): typeof Onboarding.CaptureOnboardingSnapshot.Type {
  const dates = workspace.case.configuration.dates;

  const historicalBoundary = dates.candidateLiveOn
    ? new Date(Date.parse(`${dates.candidateLiveOn}T00:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10)
    : null;

  const asOf = {
    opening: dates.openingOn,
    book_zero: dates.acceptanceEndsOn,
    final_delta: historicalBoundary,
    activation: historicalBoundary,
    first_live: dates.provingPeriodEndsOn,
  }[purpose];

  const selected = new Map<typeof Onboarding.OnboardingControlKind.Type, string>();

  for (const control of lifecycle.controls.toSorted((left, right) =>
    right.qualifiedAt.localeCompare(left.qualifiedAt),
  )) {
    if (control.asOf === asOf && !selected.has(control.kind))
      selected.set(control.kind, control.id);
  }

  return {
    purpose,
    controlIds: [...selected.values()],
    historicalRunIds: workspace.imports.flatMap((item) =>
      item.financialRunId ? [item.financialRunId] : [],
    ),
    closingCertificateId: null,
  };
}

export function useSnapshotCapture(onSuccess?: (snapshot: Snapshot) => void) {
  const { book } = useBookWorkspace();

  return useOnboardingCommand(
    {
      identity: `${bookPath(book)}/onboarding/snapshots`,
      execute: (client, requestOptions) =>
        client.onboarding.captureOnboardingSnapshot(
          httpRequest(
            Api.groups.onboarding.endpoints.captureOnboardingSnapshot,
            { params: { ...bookScope(book) } },
            requestOptions,
          ),
        ),
    },
    Onboarding.CaptureOnboardingSnapshot,
    Onboarding.OnboardingSnapshot,
    onSuccess,
  );
}

export function useSnapshotDecision(onSuccess?: () => void) {
  const { book } = useBookWorkspace();

  return useOnboardingCommand(
    {
      identity: `${bookPath(book)}/onboarding/decisions`,
      execute: (client, requestOptions) =>
        client.onboarding.decideOnboardingSnapshot(
          httpRequest(
            Api.groups.onboarding.endpoints.decideOnboardingSnapshot,
            { params: { ...bookScope(book) } },
            requestOptions,
          ),
        ),
    },
    Onboarding.DecideOnboardingSnapshot,
    Onboarding.OnboardingDecision,
    onSuccess,
  );
}

export function personName(lifecycle: Lifecycle, id: string) {
  return lifecycle.people.find((item) => item.id === id)?.name ?? "Okänd person";
}
