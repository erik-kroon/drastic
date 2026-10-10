import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const { Client } = createRequire(new URL("../../apps/api/package.json", import.meta.url))("pg");

export const supplierExpiryAccounts = [
  { id: "expiry_consulting", code: "6550", name: "Konsultarvoden" },
  { id: "expiry_payable", code: "2440", name: "Leverantörsskulder" },
];

export async function seedSupplierExpiry(config) {
  const { fixture, scratch } = config;

  const api = new URL(config.apiUrl);
  const database = new URL(config.adminUrl);
  const scope = { entityId: "entity_synthetic", bookId: "book_synthetic" };
  const actorId = "actor_operator";
  const date = "2026-10-03";
  const period = fixture.periods.find((item) => item.startsOn <= date && item.endsOn >= date);

  if (
    api.protocol !== "http:" ||
    api.hostname !== "127.0.0.1" ||
    api.pathname !== "/" ||
    database.protocol !== "postgresql:" ||
    database.hostname !== "127.0.0.1" ||
    database.username !== "postgres" ||
    database.pathname !== "/postgres" ||
    !basename(scratch).startsWith("openerp-paper-") ||
    fixture.entity.id !== scope.entityId ||
    fixture.book.id !== scope.bookId ||
    fixture.actor.id !== actorId ||
    fixture.actor.role !== "operator" ||
    !period
  )
    throw new Error("Supplier expiry seed requires its owned disposable synthetic runtime");

  const client = new Client({ connectionString: config.adminUrl, connectionTimeoutMillis: 5000 });
  const base = `${api.origin}/api/v1/entities/${scope.entityId}/books/${scope.bookId}`;

  async function call(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        origin: api.origin,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (response.status !== 200)
      throw new Error(`Supplier expiry seed ${path}: HTTP ${response.status}`);

    return response.json();
  }

  try {
    await client.connect();

    const settings = await client.query(`select current_database() as database,
      current_setting('data_directory') as directory,
      current_setting('unix_socket_directories') as socket,
      current_setting('port') as port`);

    const server = settings.rows[0];
    const data = await realpath(join(scratch, "pgdata"));
    const postmaster = (await readFile(join(data, "postmaster.pid"), "utf8")).split("\n");
    const provision = JSON.parse(await readFile(join(scratch, "book.json"), "utf8"));

    if (
      server.database !== "postgres" ||
      (await realpath(server.directory)) !== data ||
      server.socket !== scratch ||
      server.port !== database.port ||
      (await realpath(postmaster[1])) !== data ||
      postmaster[3] !== database.port ||
      postmaster[4] !== scratch ||
      !isDeepStrictEqual(provision, fixture)
    )
      throw new Error("Supplier expiry seed cluster does not match its launcher witness");

    const principal = await client.query(
      `select c.actor_id from openerp.credentials c
       join openerp.memberships m on m.actor_id=c.actor_id and m.book_id=$2
       join openerp.books b on b.id=m.book_id and b.entity_id=$3
       where c.token_hash=$1 and c.actor_id=$4 and c.revoked_at is null
         and c.expires_at>clock_timestamp() and m.role='operator'`,
      [
        createHash("sha256").update(config.accessToken).digest("hex"),
        scope.bookId,
        scope.entityId,
        actorId,
      ],
    );

    if (principal.rows.length !== 1)
      throw new Error("Supplier expiry seed requires its current native operator credential");

    const before = await call("/ledger");

    const evidence = await call("/evidence", {
      title: "Vinter & Co AB, faktura 882",
      content: "Synthetic service invoice 882: base249000, tax0, gross249000 SEK minor units.",
      mediaType: "text/plain",
      origin: "Isolated supplier expiry verification, no payment or statutory qualification",
    });

    const supplier = await call("/commerce/counterparties", {
      kind: "synthetic_counterparty_v1",
      externalKey: randomUUID(),
      role: "supplier",
      displayName: "Vinter & Co AB",
      evidenceId: evidence.id,
      reason: "Synthetic supplier expiry fixture",
    });

    const identity = {
      legalName: supplier.displayName,
      registrationId: "5560000000",
      taxId: null,
      address: "Synthetic street 1",
      countryCode: "SE",
      evidenceId: evidence.id,
    };

    async function prepare(number, title) {
      const draft = await call("/commerce/supplier-invoice-drafts", {
        draftKey: `expiry_${randomUUID()}`,
        content: {
          title,
          counterpartyId: supplier.id,
          counterpartyRevision: supplier.revision,
          supplier: identity,
          buyer: identity,
          sourceEvidenceId: evidence.id,
          supplierDocumentNumber: number,
          currency: "SEK",
          currencyScale: 2,
          documentDate: date,
          supplyDate: date,
          dueDate: "2026-10-14",
          paymentTerms: "Synthetic terms",
          sourceTotalMinor: "249000",
          lines: [
            {
              id: "synthetic_service",
              description: "Synthetic consulting service",
              quantity: "1",
              unitPriceMinor: "249000",
              baseMinor: "249000",
              discountMinor: "0",
              chargeMinor: "0",
              taxMinor: "0",
              taxDescription: "Synthetic zero tax",
              taxEvidenceId: evidence.id,
              sourceGrossMinor: "249000",
            },
          ],
        },
      });

      const plan = await call("/commerce/supplier-acceptance-reviews", {
        profile: "synthetic-manual-supplier-v1",
        draftId: draft.id,
        expectedRevision: draft.revision,
        expectedDigest: draft.digest,
        debitAccountId: "expiry_consulting",
        controlAccountId: "expiry_payable",
        accountingPeriodId: period.id,
        series: "A",
        reason: "Isolated synthetic supplier expiry verification",
        acknowledgeSyntheticOnly: true,
      });

      const lines = plan.postingPlan.groups.flatMap((group) =>
        group.actions.flatMap((action) => action.lines),
      );

      if (
        !isDeepStrictEqual(plan.scope, scope) ||
        !isDeepStrictEqual(plan.postingPlan.scope, scope) ||
        plan.input.draftId !== draft.id ||
        plan.draftSnapshot.id !== draft.id ||
        plan.draftSnapshot.totals.grossMinor !== "249000" ||
        lines.length !== 2 ||
        lines[0].accountId !== "expiry_consulting" ||
        lines[0].debitMinor !== "249000" ||
        lines[0].creditMinor !== "0" ||
        lines[1].accountId !== "expiry_payable" ||
        lines[1].debitMinor !== "0" ||
        lines[1].creditMinor !== "249000"
      )
        throw new Error("Supplier expiry seed requires the independently specified saved proposal");

      return plan;
    }

    const target = await prepare("882", "Vinter & Co AB, faktura 882");
    const donor = await prepare("SYNTHETIC-BASIS", "Syntetiskt underlag för behörighet");

    const grant = await call(`/commerce/supplier-acceptance-reviews/${donor.id}/approvals`, {
      version: donor.version,
      digest: donor.digest,
      acknowledgeSyntheticOnly: true,
    });

    const approvalId = `supplier_approval_fixture_${randomUUID().replaceAll("-", "")}`;

    const inserted = await client.query(
      `with target as (
        select r.* from openerp.supplier_acceptance_reviews r
        join openerp.books b on b.id=r.book_id
        where r.book_id=$1 and b.entity_id=$2 and r.id=$3
          and r.body->>'digest'=$4 and r.draft_id=$5
          and r.change_set_id=$6
          and not exists(select 1 from openerp.supplier_acceptance_approvals a
            where a.book_id=r.book_id and a.review_id=r.id)
          and not exists(select 1 from openerp.supplier_acceptances s
            where s.book_id=r.book_id and s.review_id=r.id)
        for update of r
      ), donor as (
        select a.body->'authorityBasis' as basis
        from openerp.supplier_acceptance_approvals a
        where a.book_id=$1 and a.id=$7 and a.review_id=$8 and a.digest=$9
          and a.actor_id=$10 and a.ordinal=1
          and a.body->>'id'=a.id and a.body->>'reviewId'=a.review_id
          and a.body->>'digest'=a.digest and a.body->>'actorId'=a.actor_id
          and a.body->'authorityBasis'->>'policy'='generic-posting-authority-v1'
          and a.body->'authorityBasis'->>'permission'='approve_change'
          and a.body->'authorityBasis'->>'actorId'=$10
          and a.body->'authorityBasis'->'scope'->>'entityId'=$2
          and a.body->'authorityBasis'->'scope'->>'bookId'=$1
          and a.body->'authorityBasis'->'authentication'->>'credentialHash'=$11
          and not (a.body->'authorityBasis' ?| array['reviewId','draftId','planDigest','reviewDigest'])
      ), timing as (
        select (((clock_timestamp() at time zone 'Europe/Stockholm')::date-1
          + time '15:05') at time zone 'Europe/Stockholm') as expires_at
      ), inserted as (
        insert into openerp.supplier_acceptance_approvals
          (book_id,id,review_id,ordinal,actor_id,digest,expires_at,body)
        select t.book_id,$12,t.id,1,$10,$4,clock.expires_at,
          jsonb_build_object('id',$12::text,'scope',jsonb_build_object('entityId',$2::text,
            'bookId',$1::text),'reviewId',t.id,'digest',$4::text,'version',1,
            'actorId',$10::text,'ordinal',1,'authorityBasis',d.basis,
            'createdAt',to_char((clock.expires_at-interval '1 hour') at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'expiresAt',to_char(clock.expires_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'receipt',jsonb_build_object('key',$13::text,
              'operation','approve_supplier_acceptance','actorId',$10::text))
        from target t cross join donor d cross join timing clock
        returning id,body
      ) select i.id,i.body->>'createdAt' as "createdAt",
        i.body->>'expiresAt' as "expiresAt",i.body->'authorityBasis'=d.basis as "basisRetained"
      from inserted i cross join donor d`,
      [
        scope.bookId,
        scope.entityId,
        target.id,
        target.digest,
        target.input.draftId,
        target.postingPlan.id,
        grant.id,
        donor.id,
        donor.digest,
        actorId,
        createHash("sha256").update(config.accessToken).digest("hex"),
        approvalId,
        randomUUID(),
      ],
    );

    const historical = inserted.rows[0];

    if (inserted.rows.length !== 1 || !historical.basisRetained)
      throw new Error("Supplier expiry seed requires one exact append-only historical grant");

    const saved = await call(`/commerce/supplier-acceptance-reviews/${target.id}`);
    const attention = await call("/attention?status=open&sort=oldest");
    const rows = attention.items.filter((item) => item.supplierReview?.reviewId === target.id);

    if (
      !isDeepStrictEqual(saved.plan, target) ||
      saved.approval?.id !== approvalId ||
      saved.approval.ordinal !== 1 ||
      saved.approvalObservation.state !== "expired" ||
      !saved.approvalObservation.callerMatches ||
      !saved.approvalObservation.proposalMatches ||
      !saved.dependenciesCurrent ||
      saved.approvalUsable ||
      saved.acceptance !== null ||
      rows.length !== 1 ||
      rows[0].supplierReview.approvalObservation.state !== "expired" ||
      Date.parse(historical.expiresAt) - Date.parse(historical.createdAt) !== 3600000 ||
      new Intl.DateTimeFormat("sv-SE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Stockholm",
      }).format(new Date(historical.expiresAt)) !== "15:05" ||
      !isDeepStrictEqual(await call("/ledger"), before)
    )
      throw new Error(
        "Supplier expiry seed readback does not establish the unchanged expired state",
      );

    const workspace = `/entities/${scope.entityId}/books/${scope.bookId}`;

    const result = {
      synthetic: true,
      scope,
      draftId: target.input.draftId,
      reviewId: target.id,
      postingPlanId: target.postingPlan.id,
      approvalId,
      digest: target.digest,
      expectedGrossMinor: "249000",
      approvalCreatedAt: historical.createdAt,
      approvalExpiresAt: historical.expiresAt,
      historicalApprovalFixture: true,
      posted: false,
      route: `${workspace}/`,
      purchaseRoute: `${workspace}/purchases?${new URLSearchParams({
        view: "supplier-drafts",
        record: target.input.draftId,
        review: target.id,
      })}`,
      nativeDonorApprovalId: grant.id,
      copiedBasisRetained: true,
      limitation:
        "Historical timing fixture with a current native principal basis. Donor grant and receipts remain unchanged; this is not past-authentication or production qualification.",
    };

    await writeFile(
      join(config.artifacts, "supplier-expiry-seed.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );

    return result;
  } finally {
    await client.end();
  }
}
