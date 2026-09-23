import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import { Path } from "effect/Path";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "OpenErpWeb",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const path = yield* Path;
    const evidence = yield* Cloudflare.R2.Bucket("Evidence", {
      jurisdiction: yield* Config.literals(["eu", "default"], "OPENERP_ARCHIVE_JURISDICTION"),
      publicAccess: false,
    }).pipe(Alchemy.RemovalPolicy.retain());
    const database = yield* Cloudflare.Hyperdrive.Connection("AccountingDatabase", {
      origin: {
        scheme: "postgres",
        host: yield* Config.string("OPENERP_DATABASE_HOST"),
        port: yield* Config.port("OPENERP_DATABASE_PORT").pipe(Config.withDefault(5432)),
        database: yield* Config.string("OPENERP_DATABASE_NAME"),
        user: yield* Config.string("OPENERP_DATABASE_USER"),
        password: yield* Config.redacted("OPENERP_DATABASE_PASSWORD"),
      },
      caching: { disabled: true },
    });
    const api = yield* Cloudflare.Worker("Api", {
      compatibility: { date: "2026-09-22", flags: ["nodejs_compat"] },
      main: path.resolve(import.meta.dirname, "../../apps/api/src/runtime/cloudflare.ts"),
      crons: ["* * * * *"],
      env: {
        HYPERDRIVE: database,
        EVIDENCE_BUCKET: evidence,
        PREPARATION_WORKFLOW: Cloudflare.Workflows.Workflow("Preparation", {
          className: "PreparationWorkflow",
        }),
        OPENERP_PREPARATION_TOKEN: yield* Config.redacted("OPENERP_PREPARATION_TOKEN"),
        OPENERP_AUTH_MODE: "oidc",
        OIDC_ISSUER: yield* Config.string("OIDC_ISSUER"),
        OIDC_CLIENT_ID: yield* Config.string("OIDC_CLIENT_ID"),
        OIDC_CLIENT_SECRET: yield* Config.redacted("OIDC_CLIENT_SECRET"),
        BETTER_AUTH_URL: yield* Config.string("BETTER_AUTH_URL"),
        BETTER_AUTH_SECRET: yield* Config.redacted("BETTER_AUTH_SECRET"),
      },
      observability: { enabled: true },
    });
    const website = yield* Cloudflare.Website.Vite("Website", {
      rootDir: path.resolve(import.meta.dirname, "../../apps/web"),
      main: "src/worker.ts",
      env: { API: api },
      assets: { runWorkerFirst: ["/api/*"] },
    });

    return {
      apiUrl: api.url.as<string>(),
      webUrl: website.url.as<string>(),
    };
  }),
);
