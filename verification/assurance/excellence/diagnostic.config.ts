import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  root: resolve(import.meta.dirname, "../../.."),
  test: {
    include: ["apps/api/tests/assurance/excellence/*.diagnostic.test.ts"],
    globalSetup: ["./apps/api/tests/support/global-setup.ts"],
    environment: "node",
    fileParallelism: false,
    retry: 0,
    allowOnly: false,
    passWithNoTests: false,
    testTimeout: 240000,
    hookTimeout: 120000,
    reporters: ["default", "json"],
    outputFile: {
      json: process.env.EXCELLENCE_JSON_REPORT ?? "test-results/excellence-diagnostic/results.json",
    },
  },
});
