import { defineConfig, mergeConfig } from "vite-plus";
import application from "../vite.config";

const apiUrl = process.env.OPENERP_E2E_API_URL;
if (!apiUrl || new URL(apiUrl).hostname !== "127.0.0.1") {
  throw new Error("Browser E2E requires the disposable local API URL");
}
export default mergeConfig(application, defineConfig({ server: { proxy: { "/api": apiUrl } } }));
