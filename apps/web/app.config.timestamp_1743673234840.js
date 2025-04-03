// app.config.ts
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "@tanstack/react-start/config";
import { resolve } from "path";
import tsConfigPaths from "vite-tsconfig-paths";
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
    // https://tanstack.com/start/latest/docs/framework/react/hosting#deployment
    // preset: "netlify",
  }
});
export {
  app_config_default as default
};
