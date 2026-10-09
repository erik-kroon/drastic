// Actual-company rule releases must carry a reviewed qualification whose sources
// cover the release's valid interval. Synthetic fixtures cite fixed placeholder
// artifacts; they make no statutory claim.
export function syntheticQualification(
  releaseChecksum: string,
  effectiveFrom: string,
  effectiveTo: string,
) {
  const artifact = (id: string, digit: string) => ({
    artifactId: id,
    sha256: `sha256:${digit.repeat(64)}`,
  });

  return {
    releaseChecksum,
    primarySources: [
      {
        publisherUrl: "https://example.invalid/synthetic-rule-release",
        version: "synthetic-v1",
        sha256: `sha256:${"2".repeat(64)}`,
        retrievedAt: `${effectiveFrom}T00:00:00.000Z`,
        effectiveFrom,
        effectiveTo,
      },
    ],
    reviewer: "Synthetic independent rule reviewer",
    reviewedAt: `${effectiveFrom}T00:00:00.000Z`,
    reviewArtifact: artifact("artifact_synthetic_review", "3"),
    examples: [{ ...artifact("artifact_synthetic_example", "4"), releaseChecksum }],
    counterexamples: [{ ...artifact("artifact_synthetic_counterexample", "5"), releaseChecksum }],
  };
}
