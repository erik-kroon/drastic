// Reuse the real disposable PostgreSQL/workerd setup, with an artifact-only test lane.
export default {
  test: {
    include: ["apps/api/tests/bend-vat.qualification.test.ts"],
    globalSetup: ["./apps/api/tests/support/global-setup.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    retry: 0,
    forbidOnly: true,
    reporters: ["default", "json", "junit"],
    outputFile: { json: "test-results/e2e/results.json", junit: "test-results/e2e/junit.xml" },
  },
};
