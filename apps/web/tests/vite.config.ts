import { mergeConfig } from "vite-plus";
import application from "../vite.config";

const target = process.env.OPENERP_E2E_API_URL;

if (!target) throw new Error("OPENERP_E2E_API_URL must name the isolated E2E Worker.");

export default mergeConfig(application, {
  cacheDir: `node_modules/.vite-e2e-${new URL(target).port}`,
  server: { proxy: { "/api": { target, changeOrigin: false } } },
});
