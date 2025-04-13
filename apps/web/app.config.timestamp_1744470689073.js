// app.config.ts
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "@tanstack/react-start/config";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import tsConfigPaths from "vite-tsconfig-paths";
var __dirname = dirname(fileURLToPath(import.meta.url));
var app_config_default = defineConfig({
  vite: {
    resolve: {
      alias: {
        "~": resolve(__dirname, "./src"),
        "@": resolve(__dirname, "./src")
      }
    },
    plugins: [
      tsConfigPaths({
        projects: ["./tsconfig.json"]
      }),
      tailwindcss()
    ]
  },
  // https://react.dev/learn/react-compiler
  react: {
    babel: {
      plugins: [
        [
          "babel-plugin-react-compiler",
          {
            target: "19"
          }
        ]
      ]
    }
  },
  tsr: {
    // https://github.com/TanStack/router/discussions/2863#discussioncomment-12458714
    appDirectory: "./src"
  },
  server: {
    preset: "vercel"
  }
});
export {
  app_config_default as default
};
