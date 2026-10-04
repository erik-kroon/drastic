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
  return {
    purpose,
    controlIds: lifecycle.controls.map((item) => item.id),
    historicalRunIds: workspace.imports.flatMap((item) =>
      item.financialState === "posted" && item.financialRunId ? [item.financialRunId] : [],
    ),
    closingCertificateId: null,
  };
}

export function useSnapshotCapture(onSuccess?: (snapshot: Snapshot) => void) {
  const { book } = useBookWorkspace();
  return useOnboardingCommand(
    `${bookPath(book)}/onboarding/snapshots`,
    Onboarding.CaptureOnboardingSnapshot,
    Onboarding.OnboardingSnapshot,
    onSuccess,
  );
}

export function useSnapshotDecision(onSuccess?: () => void) {
  const { book } = useBookWorkspace();
  return useOnboardingCommand(
    `${bookPath(book)}/onboarding/decisions`,
    Onboarding.DecideOnboardingSnapshot,
    Onboarding.OnboardingDecision,
    onSuccess,
  );
}

export function personName(lifecycle: Lifecycle, id: string) {
  return lifecycle.people.find((item) => item.id === id)?.name ?? "Okänd person";
}
