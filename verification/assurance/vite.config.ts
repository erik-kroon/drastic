import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

// Separate collection from DB global setup, while importing the real workspace owners.
// No dependency additions and no modifications to the existing E2E configuration.
export default defineConfig({
  root: resolve(import.meta.dirname, "../.."),
  test: {
    include: ["apps/api/tests/assurance/**/*.conformance.test.ts"],
    environment: "node",
    fileParallelism: false,
    retry: 0,
    allowOnly: false,
    passWithNoTests: false,
    testTimeout: 30_000,
    reporters: ["default", "json", "junit"],
    outputFile: {
      json: process.env.ASSURANCE_JSON_REPORT ?? "test-results/assurance-pure/results.json",
      junit: process.env.ASSURANCE_JUNIT_REPORT ?? "test-results/assurance-pure/junit.xml",
    },
  },
});
