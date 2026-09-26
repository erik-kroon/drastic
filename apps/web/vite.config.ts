import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8788", changeOrigin: false } },
  },
  preview: {
    host: "127.0.0.1",
    proxy: { "/api": { target: "http://127.0.0.1:8788", changeOrigin: false } },
  },
  resolve: {
    extensions: [".ts", ".tsx", ".mjs", ".js", ".mts", ".jsx", ".json"],
    tsconfigPaths: true,
  },
  plugins: [
    stylex.vite({ useCSSLayers: true }),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      emitTsDeclarations: true,
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
    }),
    tanstackStart({
      vite: { installDevServerMiddleware: true },
      spa: { enabled: true },
      prerender: {
        enabled: true,
        autoSubfolderIndex: true,
        autoStaticPathsDiscovery: true,
        crawlLinks: true,
        failOnError: true,
      },
    }),
    react(),
  ],
});
