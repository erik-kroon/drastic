import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

export async function startReminderDeliveryFixture({ runtimeUrl, accessToken, artifacts, api }) {
  const fixture = JSON.parse(await readFile(join(artifacts, "reminder-fixture.json"), "utf8"));
  const observations = new Map();
  const secret = randomBytes(32).toString("hex");
  await writeFile(
    join(artifacts, "reminder-delivery.json"),
    JSON.stringify({ submissions: [], reads: [] }),
    { mode: 0o600 },
  );

  const submissions = new Map();
  const reads = [];
  let log = "";

  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${secret}`) {
        response.writeHead(401).end();

        return;
      }

      let identity;
      let kind = "unknown";

      if (request.method === "POST" && request.url === "/messages") {
        const chunks = [];

        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const wire = JSON.parse(Buffer.concat(chunks).toString("utf8"));

        if (submissions.has(wire.externalIdentity)) throw new Error("Duplicate submission");
        submissions.set(wire.externalIdentity, wire);
        identity = wire.externalIdentity;

        if (wire.messageDigest === fixture.rejectedDigest) kind = "rejected";

        observations.set(identity, {
          kind,
          observationId: `synthetic-reminder-${submissions.size}`,
        });
      } else if (request.method === "GET" && request.url?.startsWith("/messages/")) {
        identity = decodeURIComponent(request.url.slice("/messages/".length));
        reads.push(identity);

        if (observations.get(identity)?.kind === "rejected") kind = "rejected";
        else if (
          submissions.has(identity) &&
          reads.filter((value) => value === identity).length >= 2
        )
          kind = "accepted";
      } else {
        response.writeHead(404).end();

        return;
      }

      const ledger = join(artifacts, "reminder-delivery.json");
      const temporary = `${ledger}.${randomBytes(8).toString("hex")}`;
      await writeFile(
        temporary,
        JSON.stringify({ submissions: Array.from(submissions.values()), reads }, null, 2),
        { mode: 0o600 },
      );
      await rename(temporary, ledger);

      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          kind,
          observationId: `${observations.get(identity)?.observationId ?? "synthetic-unknown"}/${kind}`,
          externalIdentity: identity,
        }),
      );
    })().catch(() => response.destroy());
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("Reminder fixture port missing");

  const runner = spawn("bun", ["scripts/preparation-runner.ts"], {
    cwd: api,
    env: {
      ...process.env,
      DATABASE_URL: runtimeUrl,
      OPENERP_PREPARATION_TOKEN: accessToken,
      OPENERP_DOCUMENT_READER: "disabled",
      OPENERP_REMINDER_DELIVERY: "local-fixture",
      OPENERP_REMINDER_ENDPOINT: `http://127.0.0.1:${address.port}`,
      OPENERP_REMINDER_SECRET: secret,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const exited = once(runner, "exit");
  runner.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  runner.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });

  return {
    async close() {
      if (runner.exitCode === null && runner.signalCode === null) runner.kill("SIGTERM");

      const timeout = setTimeout(() => {
        if (runner.exitCode === null && runner.signalCode === null) runner.kill("SIGKILL");
      }, 5000);

      try {
        await exited;
      } finally {
        clearTimeout(timeout);
      }

      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await writeFile(
        join(artifacts, "reminder-delivery.json"),
        JSON.stringify({ submissions: Array.from(submissions.values()), reads }, null, 2),
        { mode: 0o600 },
      );
      await writeFile(join(artifacts, "reminder-runner.log"), log, { mode: 0o600 });
    },
  };
}
