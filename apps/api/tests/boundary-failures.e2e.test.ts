import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { environment } from "./support/fixtures";

test("DF-10 pre-routing body refusals carry stable codes without reflecting input", async () => {
  const cases = [
    { body: '{"secret":"private-boundary-input","secret":2}', status: 400, code: "InvalidRequest" },
    { body: "x".repeat(8 * 1024 * 1024 + 1), status: 413, code: "RequestTooLarge" },
  ];

  const evidence = [];

  for (const input of cases) {
    const response = await fetch(
      `${environment().baseUrl}/api/v1/entities/missing/books/missing/evidence`,
      { method: "POST", headers: { "content-type": "application/json" }, body: input.body },
    );

    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(input.status);
    expect(body).toMatchObject({ code: input.code, recovery: "permanent" });
    expect(JSON.stringify(body)).not.toContain("private-boundary-input");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    evidence.push({ status: response.status, body });
  }

  await writeFile(
    join(environment().artifacts, "df-10-boundary-failures.json"),
    JSON.stringify(evidence, null, 2),
  );
});
