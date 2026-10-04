import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import { apiDirectory, environment, fixture, request, run } from "./support/fixtures";
import { saveSanitizedJourney } from "./assurance/database-support";

// Failure contract: exported protected operations must require one supported
// credential, never an empty/public alternative. System probes stay public.
// The live book endpoint must refuse missing credentials and accept its scoped
// bearer, independent of the generated documentation.
test("exported OpenAPI describes the live protected and public admission boundaries", async () => {
  const output = join(environment().artifacts, "openapi.json");
  await run("bun", ["scripts/export-openapi.ts", output], { cwd: apiDirectory });

  const operation = Schema.Struct({
    security: Schema.Array(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  });

  const spec = Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Struct({
        paths: Schema.Record(Schema.String, Schema.Record(Schema.String, operation)),
        components: Schema.Struct({
          securitySchemes: Schema.Record(Schema.String, Schema.Struct({ type: Schema.String })),
        }),
      }),
    ),
  )(await readFile(output, "utf8"));

  let protectedCount = 0;

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const definition of Object.values(methods)) {
      if (path === "/api/health" || path === "/api/v1/system") {
        expect(definition.security).toEqual([]);
      } else {
        expect(definition.security).toEqual([
          { AutomationBearer: [] },
          { BrowserSession: [] },
          { SecureBrowserSession: [] },
        ]);
        protectedCount += 1;
      }
    }
  }

  expect(protectedCount).toBeGreaterThan(0);
  expect(spec.components.securitySchemes.AutomationBearer?.type).toBe("http");
  expect(spec.components.securitySchemes.BrowserSession?.type).toBe("apiKey");
  expect(spec.components.securitySchemes.SecureBrowserSession?.type).toBe("apiKey");
  const book = await fixture();
  const anonymous = await fetch(`${environment().baseUrl}${book.path}/status`);

  expect(anonymous.status).toBe(401);
  expect((await request(book, "/status")).status).toBe(200);
  expect((await fetch(`${environment().baseUrl}/api/health`)).status).toBe(200);
  await saveSanitizedJourney("openapi-admission", {
    protectedCount,
    anonymousStatus: anonymous.status,
    securitySchemes: spec.components.securitySchemes,
  });
});
