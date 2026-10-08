import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, symlink, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createTestHarness } from "wrangler";
import * as Schema from "effect/Schema";
import {
  apiDirectory,
  database,
  environment,
  run,
  request,
  decoded,
  key,
  type BookFixture,
} from "./fixtures";

export async function pinnedReminderApi(revisionRef: "3a3b2093" | "6be48263" | "3776363e^") {
  const env = environment();

  const scratch = await realpath(env.scratch);

  const admin = await database();

  try {
    const directory = (
      await admin.query<{ directory: string }>(
        "select current_setting('data_directory') as directory",
      )
    ).rows[0]?.directory;

    if (
      !directory ||
      !(await realpath(directory)).startsWith(`${scratch}/`) ||
      new URL(env.runtimeUrl).hostname !== "127.0.0.1"
    )
      throw new Error("Pinned API requires the owned synthetic loopback runtime");
  } finally {
    await admin.end();
  }

  const root = resolve(apiDirectory, "../..");

  const revision = (await run("git", ["rev-parse", revisionRef], { cwd: root })).stdout.trim();

  const source = join(scratch, `pinned-reminder-${randomBytes(6).toString("hex")}`);

  await mkdir(source, { mode: 0o700 });

  const archive = join(source, "source.tar");

  await run("git", ["archive", "--format=tar", `--output=${archive}`, revision], { cwd: root });

  await run("tar", ["-xf", archive, "-C", source]);

  let compatibilityRevision: string | null = null;

  if (revisionRef === "3776363e^") {
    compatibilityRevision = (
      await run("git", ["rev-parse", "3ed96bd1"], { cwd: root })
    ).stdout.trim();

    const path = "apps/api/src/db/commerce/invoices.ts";

    const originalModule = await readFile(join(source, path), "utf8");

    const repairedModule = (
      await run("git", ["show", `${compatibilityRevision}:${path}`], { cwd: root })
    ).stdout;

    if (
      repairedModule.replace(
        "select entry.row as body, entry.total::integer as total, entry.ordinal::integer as ordinal",
        "select entry.row as body, entry.total, entry.ordinal",
      ) !== originalModule
    )
      throw new Error("Baseline compatibility repair differs beyond numeric worklist casts");

    await writeFile(join(source, path), repairedModule, { mode: 0o600 });
  }

  await symlink(join(root, "node_modules"), join(source, "node_modules"), "dir");

  await symlink(join(apiDirectory, "node_modules"), join(source, "apps/api/node_modules"), "dir");

  const original = await readFile(join(source, "apps/api/wrangler.jsonc"), "utf8");

  const alias: Record<string, string> = {};

  for (const directory of ["packages/contracts", "packages/domain", "jurisdictions/se"]) {
    const manifest = Schema.decodeSync(
      Schema.fromJsonString(
        Schema.Struct({
          name: Schema.String,
          exports: Schema.Record(Schema.String, Schema.String),
        }),
      ),
    )(await readFile(join(source, directory, "package.json"), "utf8"));

    for (const [subpath, target] of Object.entries(manifest.exports))
      alias[`${manifest.name}${subpath.slice(1)}`] = join(source, directory, target);
  }

  const config = original.replace("{", `{\n"alias": ${JSON.stringify(alias)},`);

  await writeFile(join(source, "apps/api/wrangler.pinned.jsonc"), config, { mode: 0o600 });

  const api = createTestHarness({
    root: join(source, "apps/api"),
    workers: [
      {
        configPath: "wrangler.pinned.jsonc",
        env: "e2e",
        secrets: { DATABASE_URL: env.runtimeUrl },
      },
    ],
  });

  let url: URL;

  try {
    ({ url } = await api.listen());
  } catch (error) {
    await api.close();
    throw error;
  }

  return {
    revision,
    compatibilityRevision,
    limits:
      "Committed API/contracts/domain source, alias-only runtime config, current locked external dependencies; existing synthetic source records. No providers enabled.",
    async fetch(
      actor: BookFixture,
      path: string,
      init?: { method?: "GET" | "POST"; body?: string },
    ) {
      if (!path.startsWith("/commerce/collections/"))
        throw new Error("Pinned API is bounded to collections");

      const response = await fetch(
        new URL(`/api/v1/entities/${actor.entityId}/books/${actor.bookId}${path}`, url),
        {
          ...init,
          headers: {
            authorization: `Bearer ${actor.token}`,
            "content-type": "application/json",
            "idempotency-key": key(),
          },
        },
      );

      if (response.status >= 500)
        await writeFile(
          join(env.artifacts, `pinned-${revision.slice(0, 8)}-worker.json`),
          JSON.stringify(api.getLogs(), null, 2),
        );

      return response;
    },
    async post<S extends Schema.Top & { readonly DecodingServices: never }>(
      actor: BookFixture,
      path: string,
      input: unknown,
      output: S,
    ) {
      const response = await this.fetch(actor, path, {
        method: "POST",
        body: JSON.stringify(input),
      });

      if (!response.ok)
        throw new Error(
          `Pinned reminder command refused: ${response.status} ${await response.text()}`,
        );

      const value = Schema.decodeUnknownSync(Schema.JsonObject)(await response.json());

      if ("message" in value && !path.endsWith("/replacement")) {
        const message = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
          value.message,
        );

        return decoded(
          await request(actor, `/commerce/collections/reminders/${message.id}`),
          output,
        );
      }

      return Schema.decodeSync(output)(value);
    },
    close: () => api.close(),
  };
}

export async function withPinnedReminderApi<A>(
  revisionRef: "3a3b2093" | "6be48263" | "3776363e^",
  use: (api: Awaited<ReturnType<typeof pinnedReminderApi>>) => Promise<A>,
) {
  const api = await pinnedReminderApi(revisionRef);

  try {
    return await use(api);
  } finally {
    await api.close();
  }
}
