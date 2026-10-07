import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

export async function seedRecurring(config) {
  const { Client } = createRequire(join(config.api, "package.json"))("pg");
  const base = `${config.apiUrl}/api/v1/entities/entity_synthetic/books/book_synthetic`;

  async function call(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) throw new Error(`Recurring fixture ${path}: HTTP ${response.status}`);

    return response.json();
  }

  const source = await call("/evidence", {
    title: "Synthetic recurring review inputs",
    mediaType: "text/plain",
    content:
      "Synthetic service quantity3 unit1001 discount2 charge4 gives net3005 minor SEK. Tax unresolved. No issue, posting or delivery.",
    origin: "DRA107 DRA108 disposable browser qualification",
  });

  const customer = await call("/commerce/counterparties", {
    kind: "synthetic_counterparty_v1",
    externalKey: randomUUID(),
    role: "customer",
    displayName: "Tallvik återkommande testkund",
    evidenceId: source.id,
    reason: "Synthetic recurrence review",
  });

  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const anchor = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  anchor.setUTCMonth(anchor.getUTCMonth() - 1);

  const agreement = await call("/commerce/recurring-invoices", {
    customerId: customer.id,
    title: "Tallvik återkommande granskning",
    schedule: {
      anchorLocalDate: anchor.toISOString().slice(0, 10),
      timeZone: "Europe/Stockholm",
      cadence: {
        kind: "monthly",
        monthInterval: "1",
        dayInterval: null,
        monthAnchorPolicy: "anchor_day_clamped",
      },
      firstCycleOrdinal: "1",
    },
    reason: "Synthetic current local-date recurrence",
  });

  const path = `/commerce/recurring-invoices/${agreement.id}`;
  await call(`${path}/template-revisions`, {
    expectedAgreementRevision: agreement.revision,
    expectedAgreementDigest: agreement.digest,
    effectiveFromCycle: "1",
    chargeComponentKeys: ["service"],
    template: {
      kind: "commercial",
      title: "Tallvik återkommande utkast",
      counterpartyId: customer.id,
      seller: {
        legalName: "Synthetic recurring seller",
        registrationId: null,
        taxId: null,
        address: null,
        countryCode: "SE",
        evidenceId: source.id,
      },
      currency: "SEK",
      currencyScale: 2,
      paymentTerms: "Synthetic 14 calendar days",
      dateOffsets: { issueDays: "0", supplyDays: "0", dueDays: "14" },
      lines: [
        {
          id: "recurring_service",
          description: "Synthetic recurring service",
          quantity: "3",
          unitPriceMinor: "1001",
          discountMinor: "2",
          chargeMinor: "4",
          treatment: { kind: "unresolved" },
        },
      ],
    },
    reason: "Retain current commercial inputs for explicit recovery",
  });
  await call(`${path}/scheduling`, {
    expectedGeneration: "0",
    enabled: true,
    firstAutomaticCycle: "1",
    duePolicy: "local_calendar_date_v1",
    confirmFirstAutomaticCycle: true,
    reason: "Synthetic confirmed enrollment",
  });
  const admin = new Client({ connectionString: config.adminUrl });
  await admin.connect();
  const agreementLiteral = admin.escapeLiteral(agreement.id);

  try {
    await admin.query(`CREATE FUNCTION openerp.browser_recurring_refusal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.book_id='book_synthetic' AND NEW.agreement_id=${agreementLiteral} THEN RAISE EXCEPTION 'synthetic late recurrence refusal' USING ERRCODE='P0001', DETAIL='StaleDependency'; END IF; RETURN NEW; END $$`);
    await admin.query(
      "CREATE TRIGGER browser_recurring_refusal BEFORE INSERT ON openerp.recurring_invoice_occurrences FOR EACH ROW EXECUTE FUNCTION openerp.browser_recurring_refusal()",
    );
  } finally {
    await admin.end();
  }

  const child = spawn("bun", ["scripts/preparation-runner.ts"], {
    cwd: config.api,
    env: {
      ...process.env,
      DATABASE_URL: config.runtimeUrl,
      OPENERP_PREPARATION_TOKEN: config.accessToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });

  async function close() {
    try {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);

        try {
          await exited;
        } finally {
          clearTimeout(deadline);
        }
      }
    } finally {
      await writeFile(join(config.artifacts, "recurring-runner.log"), log, { mode: 0o600 });
    }
  }

  try {
    let scheduling;
    const deadline = Date.now() + 30000;

    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("Synthetic recurring runner exited before failure discovery");
      scheduling = await call(`${path}/scheduling`);

      if (scheduling.history.some((job) => job.state === "failed")) break;
      await new Promise((done) => setTimeout(done, 100));
    }

    const failed = scheduling?.history.find(
      (job) => job.cycleOrdinal === "1" && job.state === "failed",
    );

    if (!failed || failed.reason !== "StaleDependency" || failed.draftId !== null)
      throw new Error("Synthetic recurrence needs a retained atomic occurrence failure");
    const cleanupAdmin = new Client({ connectionString: config.adminUrl });
    await cleanupAdmin.connect();

    try {
      await cleanupAdmin.query(
        "DROP TRIGGER browser_recurring_refusal ON openerp.recurring_invoice_occurrences",
      );
      await cleanupAdmin.query("DROP FUNCTION openerp.browser_recurring_refusal()");
    } finally {
      await cleanupAdmin.end();
    }

    const fixture = {
      agreementId: agreement.id,
      jobId: failed.id,
      title: agreement.title,
      cycleOrdinal: "1",
    };

    await writeFile(
      join(config.artifacts, "recurring-fixture.json"),
      JSON.stringify(fixture, null, 2),
    );

    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}
