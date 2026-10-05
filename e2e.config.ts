import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const appUrl = process.env.OPENERP_E2E_APP_URL;

const proxyUrl = process.env.OPENERP_E2E_PROXY_URL;

const output = process.env.OPENERP_E2E_OUTPUT;

if (!appUrl || !proxyUrl || !output)
  throw new Error("Run bun run test:browser to provision the app and proxy");

const codex = createOpenAICompatible({
  name: "codex",
  baseURL: proxyUrl,
});

export default {
  tests: "tests/browser/**/*.e2e.ts",
  targets: [
    {
      name: "synthetic-chromium",
      engine: web({
        locale: "sv-SE",
        timezoneId: "Europe/Stockholm",
        viewport: { width: 1440, height: 900 },
      }),
      app: { url: appUrl, environment: "test" },
    },
  ],
  agents: { default: { model: codex.chatModel("gpt-6-luna"), maxModelCalls: 30 } },
  workers: 1,
  retries: 0,
  timeout: 240_000,
  assertionTimeout: 15_000,
  cache: "off",
  output,
  reporters: ["list", "markdown"],
  trace: "on",
  video: "on",
} satisfies E2EConfig;
