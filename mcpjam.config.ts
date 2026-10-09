import { defineConfig } from "vite-plus";
import configuration from "./vite.config";

export default defineConfig({
  test: {
    ...configuration.test,
    include: ["apps/api/tests/mcpjam.eval.ts"],
    testTimeout: 660_000,
  },
});
