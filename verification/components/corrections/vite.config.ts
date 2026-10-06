import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

const require = createRequire(resolve(import.meta.dirname, "../../../apps/web/package.json"));

const react = require("@vitejs/plugin-react").default;

const stylex = require("@stylexjs/unplugin").default;

export default defineConfig({
  root: import.meta.dirname,
  publicDir: resolve(import.meta.dirname, "../../../apps/web/public"),
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "../../../apps/web/src"),
      "@open-erp/ui/globals.css": resolve(
        import.meta.dirname,
        "../../../packages/ui/src/styles/globals.css",
      ),
      "@open-erp/ui/components": resolve(
        import.meta.dirname,
        "../../../packages/ui/src/components",
      ),
      "@open-erp/ui/theme": resolve(import.meta.dirname, "../../../packages/ui/src/theme"),
      "@open-erp/ui/lib": resolve(import.meta.dirname, "../../../packages/ui/src/lib"),
      "@stylexjs/stylex": require.resolve("@stylexjs/stylex"),
      react: resolve(import.meta.dirname, "../../../apps/web/node_modules/react"),
      "react-dom": resolve(import.meta.dirname, "../../../apps/web/node_modules/react-dom"),
    },
  },
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: resolve(import.meta.dirname, "../../.."),
      },
      aliases: { "@open-erp/ui/*": [resolve(import.meta.dirname, "../../../packages/ui/src/*")] },
    }),
    react(),
  ],
  server: { host: "127.0.0.1", port: 3098, strictPort: true },
});
