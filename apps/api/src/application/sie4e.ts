import * as Accounting from "@open-erp/contracts/accounting";
import * as Sie4E from "@open-erp/contracts/sie4e";
import {
  buildSie4EMembership,
  compareSie4E,
  maximumLines,
  maximumVouchers,
  renderSie4E,
} from "@open-erp/jurisdiction-se/sie4e";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { readEvidence, readTableAccess } from "../db/commerce/access";
import * as StatementDb from "../db/report-statements";
import * as SieDb from "../db/sie4e";
import { lockBookForShare, lockBookForUpdate } from "../db/posting";
import type { Transaction } from "../db/transaction";
import {
  decode,
  exactKeys,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
} from "./commerce/support";
import { canonicalText, digest } from "./json";
import { failure } from "./failures";
import { isoNow, newId, replay, saveCommand } from "./posting";
import { base64, sha256HexOf } from "./sie";
import { parseSie } from "./sie-import-parser";

// NEXT-11: complete selected-book SIE4E export.
//
// Capture is one book-scoped transaction under the book writer lock. Rendering
// and the independent semantic comparison run outside every transaction. The
// verified object manifest is bound in a second short transaction that
// re-resolves current authority, the capture identity and the retained
// legal-identity evidence. The export is a read-only artifact: it never posts,
// never consumes an approval and never moves a ledger counter.

const CaptureSchema = Sie4E.Sie4EExport;

const ViewSchema = Sie4E.Sie4EView;

const RowsSchema = Sie4E.Sie4ERowsPage;

const ListSchema = Sie4E.Sie4EList;

const RowSchema = Sie4E.Sie4ERow;

const inputKeys = [
  "fiscalYearId",
  "asOf",
  "legalName",
  "organizationNumber",
  "legalNameEvidenceId",
  "accountClassifications",
] as const;

const listCursor = /^sb1_[a-f0-9]+$/u;

const rowCursor = /^[a-z][a-z0-9_-]{2,127}:[1-9][0-9]{0,9}$/u;

const cursorOrdinal = /^(0|[1-9][0-9]{0,18})$/u;

const calendarDate = /^\d{4}-\d{2}-\d{2}$/u;

type BookRow = {
  readonly entityId: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly profile: string;
  readonly authority: string;
  readonly committedSequence: string;
};

type Retained = {
  readonly capture: typeof Sie4E.Sie4EExport.Type;
  readonly rows: ReadonlyArray<typeof Sie4E.Sie4ERow.Type>;
};

// A refusal that carries its own diagnostic text. The public error family stays
// unchanged; the detail states exactly which captured fact blocked the export.
function blocked(message: string) {
  return new Accounting.AccountingError({ code: "UnsupportedProfile", message });
}

function asDomainFailure(error: unknown) {
  return error instanceof Accounting.AccountingError ? error : failure("InternalError");
}

function requireSieBookAccess(transaction: Transaction, write: boolean) {
  const tables = [...SieDb.sieBookTables];

  return readTableAccess(transaction, tables).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== tables.length) return unsupported();

      if (rows.some((row) => !row.canSelect)) return unsupported();

      return write &&
        rows.some((row) =>
          SieDb.sieBookWriteTables.some((name) => name === row.tableName && !row.canInsert),
        )
        ? unsupported()
        : Effect.void;
    }),
  );
}

// This narrow release supports only the released native synthetic profile and
// its exact currency unit, exactly as the retained SIE4I owner does. A three
// letter currency string is not accepted as a valid ISO currency.
function requireNativeProfile(row: BookRow | undefined) {
  if (row === undefined) return failure("NotFound");

  if (row.profile !== "synthetic-core-v1" || row.authority !== "native") return unsupported();

  if (row.currency !== "SEK" || row.currencyScale !== 2) return unsupported();

  return Effect.void;
}

function isRealDate(value: string) {
  if (!calendarDate.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);

  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function arrayOf(value: JsonObject, key: string) {
  const parsed = Schema.decodeUnknownOption(Schema.Array(Schema.JsonObject))(value[key]);

  return Option.isSome(parsed) ? parsed.value : null;
}

function text(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "string" ? found : null;
}

function toHex(value: string) {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function fromHex(value: string) {
  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);

  return bytes;
}

function listEnvelope(scope: Scope, cutoff: bigint, after: bigint) {
  return canonicalText({
    version: 1,
    scope: { entityId: scope.entityId, bookId: scope.bookId },
    cutoff: cutoff.toString(),
    after: after.toString(),
  }).pipe(Effect.map((json) => `sb1_${toHex(json)}`));
}

function readListCursor(value: string, scope: Scope) {
  return Effect.gen(function* () {
    if (!listCursor.test(value)) return yield* failure("InvalidJournal");

    const bytes = fromHex(value.slice(4));

    const parsed = yield* Effect.try({
      try: () =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
      catch: () => failure("InvalidJournal"),
    });

    const cursor = yield* toJsonObject(parsed);
    yield* exactKeys(cursor, ["version", "scope", "cutoff", "after"]);

    const cutoff = text(cursor, "cutoff");
    const after = text(cursor, "after");

    if (
      cursor.version !== 1 ||
      JSON.stringify(cursor.scope) !==
        JSON.stringify({ entityId: scope.entityId, bookId: scope.bookId }) ||
      cutoff === null ||
      after === null ||
      !cursorOrdinal.test(cutoff) ||
      !cursorOrdinal.test(after) ||
      BigInt(after) > BigInt(cutoff)
    )
      return yield* failure("InvalidJournal");

    return { cutoff: BigInt(cutoff), after: BigInt(after) };
  });
}

function readRowCursor(value: string, exportId: string) {
  if (!rowCursor.test(value)) return null;

  const [named, ordinal] = value.split(":");
  const parsed = Number(ordinal);

  return named === exportId && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function readView(transaction: Transaction, bookId: string, id: string) {
  return Effect.gen(function* () {
    const row = (yield* SieDb.readSieBookExport(transaction, bookId, id))[0];

    if (row === undefined) return yield* failure("NotFound");

    const capture = yield* decode(CaptureSchema, row.body);
    const artifact = (yield* SieDb.readSieBookArtifact(transaction, bookId, id))[0];

    return yield* decode(
      ViewSchema,
      artifact === undefined
        ? { capture, artifact: null }
        : {
            capture,
            artifact: Object.assign({}, artifact.descriptor, {
              contentBase64: base64(artifact.content),
            }),
          },
    );
  });
}

export const getSie4E = Effect.fn("sie4e.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireSieBookAccess(transaction, false);

    return yield* readView(transaction, input.scope.bookId, input.id);
  });
});

export const sie4ERows = Effect.fn("sie4e.rows")(function* (
  token: string,
  input: { scope: Scope; id: string; after?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireSieBookAccess(transaction, false);
    yield* lockBookForShare(transaction, input.scope);

    const stored = (yield* SieDb.readSieBookExport(transaction, input.scope.bookId, input.id))[0];

    if (stored === undefined) return yield* failure("NotFound");

    const anchor =
      input.after === undefined || input.after === "" ? 0 : readRowCursor(input.after, input.id);

    if (anchor === null) return yield* failure("InvalidJournal");

    if (
      anchor > 0 &&
      (yield* SieDb.readSieBookRowAnchor(transaction, input.scope.bookId, input.id, anchor))
        .length !== 1
    )
      return yield* failure("NotFound");

    const counted = (yield* SieDb.countSieBookRows(transaction, input.scope.bookId, input.id))[0];

    const page = (yield* SieDb.readSieBookRowPage(
      transaction,
      input.scope.bookId,
      input.id,
      anchor,
      SieDb.sieBookRowPageSize,
    ))[0];

    if (counted === undefined || page === undefined) return yield* failure("InternalError");

    const items = arrayOf(page, "items");

    if (items === null) return yield* failure("InternalError");

    return yield* decode(RowsSchema, {
      exportId: input.id,
      order: "retained_membership_ordinal",
      total: counted.total,
      items: yield* Effect.forEach(items, (item) => decode(RowSchema, item)),
      next: page.nextOrdinal === null ? null : `${input.id}:${BigInt(page.nextOrdinal).toString()}`,
    });
  });
});

export const listSie4Es = Effect.fn("sie4e.list")(function* (
  token: string,
  input: { scope: Scope; after?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireSieBookAccess(transaction, false);
    yield* lockBookForShare(transaction, input.scope);

    const highest = (yield* SieDb.readSieBookHighestOrdinal(transaction, input.scope.bookId))[0];
    const current = BigInt(highest?.ordinal ?? "0");

    const cursor =
      input.after === undefined || input.after === ""
        ? { cutoff: current, after: 0n }
        : yield* readListCursor(input.after, input.scope);

    if (cursor.cutoff > current) return yield* failure("InvalidJournal");

    const counted = (yield* SieDb.countSieBookExports(
      transaction,
      input.scope.bookId,
      cursor.cutoff,
    ))[0];

    if (counted === undefined) return yield* failure("InternalError");

    if (BigInt(counted.total) !== cursor.cutoff) return yield* failure("InvalidJournal");

    const rows = yield* SieDb.listSieBookExports(
      transaction,
      input.scope.bookId,
      cursor.after,
      cursor.cutoff,
      SieDb.sieBookListPageSize,
    );

    const page = rows.slice(0, SieDb.sieBookListPageSize);
    const last = page[page.length - 1];
    const boundary = last === undefined ? cursor.after : BigInt(last.ordinal);

    return yield* decode(ListSchema, {
      scope: input.scope,
      cutoff: cursor.cutoff.toString(),
      total: counted.total.toString(),
      first: yield* listEnvelope(input.scope, cursor.cutoff, 0n),
      items: yield* Effect.forEach(page, (entry) =>
        Effect.map(decode(CaptureSchema, entry.body), (capture) => ({
          id: capture.id,
          captureDigest: capture.digest,
          asOf: capture.asOf,
          artifactAttached: entry.artifactAttached,
          createdAt: capture.createdAt,
        })),
      ),
      next:
        rows.length > SieDb.sieBookListPageSize && boundary < cursor.cutoff
          ? yield* listEnvelope(input.scope, cursor.cutoff, boundary)
          : null,
    });
  });
});

const captureSie4E = Effect.fn("sie4e.capture")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Sie4E.PrepareSie4E.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const payload = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_sie_book_export",
        principal.actorId,
        payload,
        CaptureSchema,
      );

      if (request.previous) return request.previous;
      yield* requireSieBookAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(payload, inputKeys);

      const input = command.input;

      if (!isRealDate(input.asOf) || input.legalName.trim() !== input.legalName)
        return yield* failure("InvalidJournal");

      const book = (yield* SieDb.readSieBookBook(transaction, command.scope.bookId))[0];

      yield* requireNativeProfile(book);

      if (book === undefined) return yield* failure("NotFound");

      const year = (yield* SieDb.readSieBookFiscalYear(
        transaction,
        command.scope.bookId,
        input.fiscalYearId,
      ))[0];

      if (year === undefined) return yield* failure("NotFound");

      if (input.asOf < year.startsOn || input.asOf > year.endsOn)
        return yield* failure("InvalidJournal");

      const evidence = (yield* readEvidence(
        transaction,
        command.scope.bookId,
        input.legalNameEvidenceId,
      ))[0];

      if (evidence === undefined) return yield* failure("MissingEvidence");

      const dimensions = yield* SieDb.readSieBookDimensions(
        transaction,
        command.scope.bookId,
        input.asOf,
      );

      if (dimensions.length > 0)
        return yield* blocked(
          `This book declares dimension ${dimensions[0]?.code ?? ""} effective at ${input.asOf}. This release has no reviewed dimension-assignment owner, so no object declaration or object assignment can be represented and an empty object group is not a substitute. The complete-book export is blocked for this book until that owner exists.`,
        );

      const boundary = book.committedSequence;

      const base = (yield* StatementDb.readStatementOpeningBase(
        transaction,
        command.scope.bookId,
        year.id,
      ))[0];

      const openingVoucherId =
        base?.mode === "opening_set" ? (base.openingVoucherId ?? null) : null;

      const prior = (yield* SieDb.readSieBookPriorVoucher(
        transaction,
        command.scope.bookId,
        year.startsOn,
        boundary,
      ))[0];

      const establishedOpening = openingVoucherId !== null || prior?.present === true;

      const accounts = yield* SieDb.readSieBookAccounts(
        transaction,
        command.scope.bookId,
        SieDb.maximumSieBookAccounts,
      );

      if (accounts.length > SieDb.maximumSieBookAccounts) return yield* unsupported();

      const opening = yield* StatementDb.readStatementOpeningLines(
        transaction,
        command.scope.bookId,
        year.startsOn,
        boundary,
        openingVoucherId,
        SieDb.maximumSieBookAccounts,
      );

      if (opening.length > SieDb.maximumSieBookAccounts) return yield* unsupported();

      const lines = yield* SieDb.readSieBookLines(
        transaction,
        command.scope.bookId,
        year.startsOn,
        input.asOf,
        boundary,
        openingVoucherId,
        maximumLines,
      );

      if (lines.length > maximumLines) return yield* unsupported();

      // A voucher dated inside the selected window but labelled with another
      // fiscal year is an inconsistent selection, never a silently dropped one.
      if (lines.some((line) => line.fiscalYearId !== year.id))
        return yield* blocked(
          `A voucher dated between ${year.startsOn} and ${input.asOf} carries a fiscal year other than ${year.id}. The selected-year membership is not consistent and was not narrowed to hide it.`,
        );

      const membership = yield* Effect.try({
        try: () =>
          buildSie4EMembership({
            accounts: accounts.map((account) => ({
              accountId: account.id,
              code: account.code,
              name: account.name,
              active: account.active,
              version: account.version,
            })),
            classifications: input.accountClassifications,
            opening: opening.map((entry) => ({ accountId: entry.accountId, minor: entry.minor })),
            lines: lines.map((line) => ({
              voucherId: line.voucherId,
              lineId: line.lineId,
              ordinalInVoucher: line.ordinal,
              sequence: line.sequence,
              fiscalYearId: line.fiscalYearId,
              series: line.series,
              number: line.number,
              postingDate: line.postingDate,
              eventId: line.eventId,
              changeSetId: line.changeSetId,
              correctsVoucherId: line.correctsVoucherId,
              accountId: line.accountId,
              accountCode: line.accountCode,
              debitMinor: line.debitMinor,
              creditMinor: line.creditMinor,
              description: line.description,
            })),
            establishedOpening,
          }),
        catch: asDomainFailure,
      });

      if (membership.vouchers > maximumVouchers) return yield* unsupported();

      // One membership position per retained row, and the persisted row body
      // carries that same position, so a page cursor and a retained row can
      // never disagree about the order.
      const retained = [...membership.accounts, ...membership.balances, ...membership.lines].map(
        (row, index) => Object.assign({}, row, { ordinal: index + 1 }),
      );

      const sourceDigest = yield* digest(yield* toJsonObject({ rows: retained }));
      const cutoff = yield* isoNow(transaction);

      const body = yield* toJsonObject({
        kind: "complete_book_sie_v1",
        id: newId("siebook"),
        scope: command.scope,
        fiscalYear: { id: year.id, startsOn: year.startsOn, endsOn: year.endsOn },
        asOf: input.asOf,
        ledgerBoundary: boundary,
        recordedCutoff: cutoff,
        generationDate: cutoff.slice(0, 10),
        currency: book.currency,
        currencyScale: 2,
        legalName: input.legalName,
        organizationNumber: input.organizationNumber,
        legalNameEvidenceSha256: evidence.sha256,
        openingBasis: {
          representation:
            openingVoucherId === null ? "prior_native_balance" : "opening_set_voucher",
          basisId: openingVoucherId === null ? year.id : (base?.sourcePlanId ?? year.id),
          openingVoucherId,
          established: establishedOpening,
          reviewed: false,
        },
        dimensions: [],
        counts: {
          accounts: membership.accounts.length,
          balances: membership.balances.length,
          vouchers: membership.vouchers,
          lines: membership.lines.length,
        },
        openingControlTotalMinor: membership.controlTotals.openingMinor.toString(),
        movementControlTotalMinor: membership.controlTotals.movementMinor.toString(),
        closingControlTotalMinor: membership.controlTotals.closingMinor.toString(),
        sourceDigest,
        rendererRelease: {
          version: "openerp-sie4e-v1",
          format: "SIE4E",
          specificationEdition: "4C-2025-08-06",
          specificationSha256: "96fcd3f7931b2aa22d18fbd518a33f863b57edd5562a78af195251e2bf38bac1",
        },
        emittedRecords: {
          recordProfile: [
            "#FLAGGA",
            "#PROGRAM",
            "#FORMAT",
            "#GEN",
            "#SIETYP",
            "#ORGNR",
            "#FNAMN",
            "#RAR",
            "#VALUTA",
            "#PROSA",
            "#KONTO",
            "#IB",
            "#UB",
            "#RES",
            "#VER",
            "#TRANS",
          ],
          objectRecords: "absent",
          priorYearRecords: "absent",
        },
        coverageLimitations: [
          ...membership.limitations,
          ...(input.asOf < year.endsOn
            ? [
                {
                  code: "year_to_date_scope" as const,
                  detail: `This export is year-to-date through ${input.asOf}. The fiscal year ends ${year.endsOn} and no future activity is fabricated.`,
                },
              ]
            : []),
          {
            code: "no_object_owner" as const,
            detail:
              "This book declares no dimension at the as-of date and this release stores no line dimension assignment, so an object group is empty because nothing is assigned, not because an assignment was reviewed away.",
          },
        ],
        createdBy: principal.actorId,
        createdAt: cutoff,
        noFinancialEffect: true,
        receipt: {
          key: command.idempotencyKey,
          operation: "prepare_sie_book_export",
          actorId: principal.actorId,
        },
      });

      const capture = yield* decode(
        CaptureSchema,
        Object.assign({}, body, { digest: yield* digest(body) }),
      );

      const highest = (yield* SieDb.readSieBookHighestOrdinal(
        transaction,
        command.scope.bookId,
      ))[0];

      const ordinal = BigInt(highest?.ordinal ?? "0") + 1n;

      if (ordinal > 9223372036854775807n) return yield* unsupported();

      yield* SieDb.insertSieBookExport(transaction, {
        bookId: command.scope.bookId,
        id: capture.id,
        ordinal,
        fiscalYearId: year.id,
        asOf: input.asOf,
        sequence: BigInt(boundary),
        evidenceId: input.legalNameEvidenceId,
        actorId: principal.actorId,
        body: yield* toJsonObject(capture),
      });

      yield* SieDb.insertSieBookExportRows(
        transaction,
        yield* Effect.forEach(retained, (row, index) =>
          Effect.map(toJsonObject(row), (encoded) => ({
            bookId: command.scope.bookId,
            exportId: capture.id,
            ordinal: index + 1,
            rowId: row.rowId,
            body: encoded,
          })),
        ),
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_sie_book_export",
        principal.actorId,
        yield* toJsonObject(capture),
      );

      return capture;
    },
    "update",
  );
});

// Rendering and the independent comparison hold no transaction, no lock and no
// database connection. The frozen capture and its retained rows are the only
// input, so the produced bytes cannot depend on live ledger state.
const renderSie4EExport = Effect.fn("sie4e.render")(function* (retained: Retained) {
  const bytes = yield* Effect.try({
    try: () => renderSie4E(retained.capture, retained.rows),
    catch: asDomainFailure,
  });

  const parsed = parseSie(bytes, "ibm437");
  const compared = compareSie4E(retained.capture, retained.rows, parsed);

  if (!compared.matched)
    return yield* blocked(
      `The rendered bytes failed the independent SIE re-parse and comparison against the frozen capture: ${compared.reasons.join(" ")}`,
    );

  return {
    bytes,
    sha256: yield* sha256HexOf(bytes),
    validation: {
      checkedBy: "independent_sie_reparse_v1" as const,
      recordsCompared: compared.records,
      vouchersCompared: compared.vouchers,
      linesCompared: compared.lines,
      controlTotalsCompared: compared.controls,
      accountDeclarationsCompared: compared.accounts,
      openingMovementClosingIdentity: true,
      parserDiagnostics: parsed.diagnostics.map((entry) => entry.code),
      destinationAcceptance: "not_established" as const,
    },
  };
});

const attachSie4E = Effect.fn("sie4e.attach")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  const retained = yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireSieBookAccess(transaction, false);

    const row = (yield* SieDb.readSieBookExport(transaction, input.scope.bookId, input.id))[0];

    if (row === undefined) return yield* failure("NotFound");

    const capture = yield* decode(CaptureSchema, row.body);
    const stored = yield* SieDb.readSieBookAllRows(transaction, input.scope.bookId, input.id);

    return {
      capture,
      rows: yield* Effect.forEach(stored, (entry) => decode(RowSchema, entry.body)),
    } satisfies Retained;
  });

  const rendered = yield* renderSie4EExport(retained);

  return yield* withBook(
    token,
    input.scope,
    false,
    function* (transaction, principal) {
      yield* requireSieBookAccess(transaction, true);
      yield* lockBookForUpdate(transaction, input.scope);

      const row = (yield* SieDb.readSieBookExport(transaction, input.scope.bookId, input.id))[0];

      if (row === undefined) return yield* failure("NotFound");

      if (row.actorId !== principal.actorId) return yield* failure("Forbidden");

      const saved = yield* decode(CaptureSchema, row.body);

      if (
        saved.digest !== retained.capture.digest ||
        saved.sourceDigest !== retained.capture.sourceDigest ||
        saved.rendererRelease.version !== retained.capture.rendererRelease.version ||
        saved.rendererRelease.specificationSha256 !==
          retained.capture.rendererRelease.specificationSha256
      )
        return yield* failure("StaleDependency");

      // The legal identity is re-proved against its retained evidence, so a
      // replaced or withdrawn evidence record cannot back a new artifact.
      const evidence = (yield* readEvidence(transaction, input.scope.bookId, row.evidenceId))[0];

      if (evidence === undefined) return yield* failure("MissingEvidence");

      if (evidence.sha256 !== saved.legalNameEvidenceSha256)
        return yield* failure("StaleDependency");

      const existing = (yield* SieDb.readSieBookArtifact(
        transaction,
        input.scope.bookId,
        input.id,
      ))[0];

      if (existing !== undefined) {
        const same =
          existing.content.length === rendered.bytes.length &&
          existing.content.every((byte, position) => byte === rendered.bytes[position]);

        if (!same) return yield* failure("IdempotencyConflict");

        return yield* readView(transaction, input.scope.bookId, input.id);
      }

      yield* SieDb.insertSieBookExportArtifact(transaction, {
        bookId: input.scope.bookId,
        exportId: input.id,
        descriptor: yield* toJsonObject({
          exportId: input.id,
          scope: input.scope,
          captureDigest: saved.digest,
          sourceDigest: saved.sourceDigest,
          renderer: saved.rendererRelease,
          filename: `${input.id}.SE`,
          encoding: "CP437",
          mediaType: "application/octet-stream",
          byteLength: rendered.bytes.length,
          sha256: rendered.sha256,
          sealedAt: yield* isoNow(transaction),
          validation: rendered.validation,
          destinationAcceptance: "not_established",
        }),
        content: rendered.bytes,
      });

      return yield* readView(transaction, input.scope.bookId, input.id);
    },
    "update",
  );
});

export const resumeSie4E = Effect.fn("sie4e.resume")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* attachSie4E(token, input);
});

export const prepareSie4E = Effect.fn("sie4e.prepare")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Sie4E.PrepareSie4E.Type },
) {
  const capture = yield* captureSie4E(token, command);

  return yield* attachSie4E(token, { scope: command.scope, id: capture.id });
});
