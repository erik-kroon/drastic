import { defineConfig } from "vite-plus";

const agentToolingIgnorePatterns = [
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".primestack/**",
  ".roo/**",
  ".windsurf/**",
  "config/oxlint/anti-slop/**",
];

export default defineConfig({
  test: {
    // Global setup owns workerd/PostgreSQL. The browser journey starts its own
    // web server and authenticated Worker against that disposable database.
    include: ["apps/api/tests/**/*.e2e.test.ts"],
    globalSetup: ["./apps/api/tests/support/global-setup.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    retry: 0,
    allowOnly: !process.env.CI,
    reporters: ["default", "json", "junit"],
    outputFile: {
      json: "test-results/e2e/results.json",
      junit: "test-results/e2e/junit.xml",
    },
  },
  fmt: {
    ignorePatterns: [
      ...agentToolingIgnorePatterns,
      "apps/web/dist/**",
      "apps/web/.tanstack/**",
      "apps/web/src/routeTree.gen.ts",
      ".alchemy/**",
      ".wrangler/**",
      "**/.wrangler/**",
    ],
    singleQuote: false,
    semi: true,
    sortPackageJson: true,
  },
});
