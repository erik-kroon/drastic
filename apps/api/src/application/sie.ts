import { digest as digestNative } from "./json";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Review from "@open-erp/contracts/accountant-review";
import * as Sie from "@open-erp/contracts/sie";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import { renderSie } from "@open-erp/jurisdiction-se/sie";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { failure } from "./failures";

import { lockBookForShare, lockBookForUpdate } from "../db/posting";
import * as SieDb from "../db/sie-transactions";
import type { Transaction } from "../db/transaction";
import { isoNow, newId, replay, saveCommand } from "./posting";
import {
  decode,
  exactKeys,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
} from "./commerce/support";

type PrepareInput = typeof Sie.PrepareSie.Type;

type JournalLine = typeof Review.ReviewJournalLine.Type;

const CaptureSchema = Sie.SieCapture;

const ViewSchema = Sie.SieView;

const ListSchema = Sie.SieList;

const PackSchema = Review.ReviewPack;

const JournalLineSchema = Review.ReviewJournalLine;

const BalanceLineSchema = Review.ReviewBalance;

const captureInputKeys = [
  "packId",
  "packDigest",
  "selection",
  "legalName",
  "legalNameEvidenceId",
] as const;

const generatorVersion = "openerp-sie4i-v1";

const specificationSha256 = "96fcd3f7931b2aa22d18fbd518a33f863b57edd5562a78af195251e2bf38bac1";

const maximumArtifactBytes = 8388608;

const maximumCaptureBytes = 8388608;

const maximumLines = 5000;

const maximumVouchers = 1000;

const maximumAccounts = 1000;

const pageSize = 25;

const canonicalBase64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const sha256Hex = /^[a-f0-9]{64}$/u;

const cursorOrdinal = /^(0|[1-9][0-9]{0,18})$/u;

function textField(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "string" ? found : null;
}

function requireSieAccess(transaction: Transaction, write: boolean) {
  return SieDb.readSieAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      const denied = SieDb.sieTables.some((name) => {
        const access = rows.find((row) => row.tableName === name);

        return access === undefined || !access.canSelect || (write && !access.canInsert);
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function base64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function decodeBase64(value: string) {
  if (!canonicalBase64.test(value) || value.length < 4) return failure("InvalidJournal");

  return Effect.try({
    try: () => Uint8Array.from(atob(value), (character) => character.charCodeAt(0)),
    catch: () => failure("InvalidJournal"),
  }).pipe(
    Effect.filterOrElse(
      (bytes) => bytes.length >= 1 && bytes.length <= maximumArtifactBytes,
      () => failure("InvalidJournal"),
    ),
  );
}

function sha256HexOf(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", copy),
    catch: () => failure("InternalError"),
  }).pipe(
    Effect.map((hash) =>
      Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );
}

function digestBody(body: JsonObject) {
  return digestNative(body).pipe(
    Effect.map((digest): JsonObject => Object.assign({}, body, { digest })),
  );
}

function canonicalText(value: JsonObject) {
  return Effect.gen(function* () {
    const canonical = yield* Effect.sync(() => canonicalizeJson(value));

    if (Result.isFailure(canonical)) return yield* failure("InternalError");

    return canonical.success.json;
  });
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);

    if (!Number.isInteger(byte)) return failure("InvalidJournal");
    bytes[index] = byte;
  }

  return Effect.succeed(bytes);
}

function requireVoucherIntegrity(lines: ReadonlyArray<JournalLine>) {
  return Effect.gen(function* () {
    const byVoucher = new Map<string, Array<JournalLine>>();

    for (const line of lines) {
      const group = byVoucher.get(line.voucherId);

      if (group) group.push(line);
      else byVoucher.set(line.voucherId, [line]);
    }

    for (const group of byVoucher.values()) {
      const ordinals = new Set(group.map((line) => line.ordinal));

      const balanced = group.reduce(
        (total, line) => total + (BigInt(line.debitMinor) - BigInt(line.creditMinor)),
        0n,
      );

      const metadata = new Set(
        group.map((line) =>
          [
            line.series,
            line.voucherNumber,
            line.postingDate,
            line.fiscalYearId,
            line.periodId,
            line.sequence,
            line.receiptId,
            line.planDigest,
            line.changeSetId,
            line.eventId,
            line.postingPurpose,
            line.correctsVoucherId,
            line.approvalId,
            line.approvedBy,
          ].join("\u0000"),
        ),
      );

      if (
        group.length < 2 ||
        Math.min(...group.map((line) => line.ordinal)) !== 1 ||
        Math.max(...group.map((line) => line.ordinal)) !== group.length ||
        ordinals.size !== group.length ||
        balanced !== 0n ||
        metadata.size !== 1
      ) {
        return yield* failure("InvalidJournal");
      }
    }

    if (byVoucher.size > maximumVouchers) return yield* failure("InvalidJournal");
    const bySeries = new Map<string, Set<string>>();

    for (const line of lines) {
      const identity = `${line.series}\u0000${line.voucherNumber}`;
      const vouchers = bySeries.get(identity);

      if (vouchers) vouchers.add(line.voucherId);
      else bySeries.set(identity, new Set([line.voucherId]));
    }

    for (const vouchers of bySeries.values()) {
      if (vouchers.size > 1) return yield* failure("InvalidJournal");
    }
  });
}

function readView(transaction: Transaction, bookId: string, id: string) {
  return Effect.gen(function* () {
    const row = (yield* SieDb.readCapture(transaction, bookId, id))[0];

    if (!row) return yield* failure("NotFound");
    const capture = yield* decode(CaptureSchema, row.body);
    const artifact = (yield* SieDb.readArtifact(transaction, bookId, id))[0];

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

export const getSie = Effect.fn("sie.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireSieAccess(transaction, false);

    return yield* readView(transaction, input.scope.bookId, input.id);
  });
});

function sieCursor(scope: Scope, cutoff: bigint, after: bigint) {
  return canonicalText({
    version: 1,
    scope: { entityId: scope.entityId, bookId: scope.bookId },
    cutoff: cutoff.toString(),
    after: after.toString(),
  }).pipe(Effect.map((json) => `si1_${toHex(new TextEncoder().encode(json))}`));
}

function readCursor(value: string, scope: Scope) {
  return Effect.gen(function* () {
    const bytes = yield* fromHex(value.slice(4));

    const parsed = yield* Effect.try({
      try: () =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
      catch: () => failure("InvalidJournal"),
    });

    const cursor = yield* toJsonObject(parsed);
    yield* exactKeys(cursor, ["version", "scope", "cutoff", "after"]);

    if (
      cursor.version !== 1 ||
      JSON.stringify(cursor.scope) !==
        JSON.stringify({ entityId: scope.entityId, bookId: scope.bookId })
    ) {
      return yield* failure("InvalidJournal");
    }

    const cutoff = cursor.cutoff;
    const after = cursor.after;

    if (typeof cutoff !== "string" || typeof after !== "string") {
      return yield* failure("InvalidJournal");
    }

    if (!cursorOrdinal.test(cutoff) || !cursorOrdinal.test(after)) {
      return yield* failure("InvalidJournal");
    }

    if (BigInt(after) > BigInt(cutoff)) return yield* failure("InvalidJournal");

    return { cutoff: BigInt(cutoff), after: BigInt(after) };
  });
}

export const listSie = Effect.fn("sie.list")(function* (
  token: string,
  input: { scope: Scope; after?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireSieAccess(transaction, false);
    yield* lockBookForShare(transaction, input.scope);
    const highest = (yield* SieDb.readHighestOrdinal(transaction, input.scope.bookId))[0];
    const current = BigInt(highest?.ordinal ?? "0");

    const cursor =
      input.after === undefined || input.after === ""
        ? { cutoff: current, after: 0n }
        : yield* readCursor(input.after, input.scope);

    if (cursor.cutoff > current) return yield* failure("InvalidJournal");
    const counted = yield* SieDb.countCaptures(transaction, input.scope.bookId, cursor.cutoff);
    const total = BigInt(counted[0]?.total ?? 0);

    if (total !== cursor.cutoff) return yield* failure("InvalidJournal");

    const rows = yield* SieDb.listCaptures(
      transaction,
      input.scope.bookId,
      cursor.after,
      cursor.cutoff,
    );

    const expected = Number(
      cursor.cutoff - cursor.after > BigInt(pageSize) ? pageSize : cursor.cutoff - cursor.after,
    );

    if (rows.length !== expected) return yield* failure("InvalidJournal");

    const items = rows.map((row) => ({
      id: row.id,
      packId: row.packId,
      captureDigest: textField(row.body, "digest") ?? "",
      createdAt: textField(row.body, "createdAt") ?? "",
    }));

    const last = cursor.after + BigInt(items.length);

    return yield* decode(ListSchema, {
      scope: input.scope,
      cutoff: cursor.cutoff.toString(),
      total: total.toString(),
      first: yield* sieCursor(input.scope, cursor.cutoff, 0n),
      items,
      next: last < cursor.cutoff ? yield* sieCursor(input.scope, cursor.cutoff, last) : null,
    });
  });
});

const captureSie = Effect.fn("sie.capture")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: PrepareInput },
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
        "capture_sie_transaction",
        principal.actorId,
        payload,
        CaptureSchema,
      );

      if (request.previous) return request.previous;
      yield* requireSieAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const input = command.input;
      yield* exactKeys(payload, captureInputKeys);

      if (input.legalName.trim() !== input.legalName || input.legalName.length < 1) {
        return yield* failure("InvalidJournal");
      }

      if (input.selection !== "all_pack_movement_vouchers") return yield* unsupported();
      const packRow = (yield* SieDb.readPack(transaction, command.scope.bookId, input.packId))[0];

      if (!packRow) return yield* failure("NotFound");
      const pack = yield* decode(PackSchema, packRow.body);

      if (pack.digest !== input.packDigest) return yield* failure("StaleDependency");

      if (
        pack.basis.profile !== "synthetic-core-v1" ||
        pack.basis.writerAuthority !== "native" ||
        pack.basis.currencyScale !== 2 ||
        pack.basis.currency !== "SEK"
      ) {
        return yield* unsupported();
      }

      const evidence = (yield* SieDb.readEvidenceDigest(
        transaction,
        command.scope.bookId,
        input.legalNameEvidenceId,
      ))[0];

      if (!evidence) return yield* failure("MissingEvidence");
      const counted = yield* SieDb.countPackRows(transaction, command.scope.bookId, input.packId);

      if (BigInt(counted[0]?.total ?? 0) !== BigInt(pack.counts.journal)) {
        return yield* failure("InvalidJournal");
      }

      const stored = yield* SieDb.readPackRows(
        transaction,
        command.scope.bookId,
        input.packId,
        "journal",
      );

      const lines = yield* Effect.forEach(
        stored.filter((row) => textField(row.body, "part") === "movement"),
        (row) => decode(JournalLineSchema, row.body),
      );

      const ordered = [...lines].sort((left, right) =>
        BigInt(left.sequence) === BigInt(right.sequence)
          ? left.ordinal - right.ordinal
          : Number(BigInt(left.sequence) - BigInt(right.sequence)),
      );

      if (ordered.length < 2 || ordered.length > maximumLines) return yield* unsupported();

      if (
        ordered.some(
          (line) =>
            line.postingDate < pack.report.startsOn || line.postingDate > pack.report.endsOn,
        )
      ) {
        return yield* failure("InvalidJournal");
      }

      const movementVouchers = new Set(ordered.map((line) => line.voucherId));

      if (
        stored.some((row) => {
          const voucherId = textField(row.body, "voucherId");

          return (
            textField(row.body, "part") !== "movement" &&
            voucherId !== null &&
            movementVouchers.has(voucherId)
          );
        })
      ) {
        return yield* failure("InvalidJournal");
      }

      yield* requireVoucherIntegrity(ordered);

      const balances = yield* Effect.forEach(
        yield* SieDb.readPackRows(transaction, command.scope.bookId, input.packId, "balances"),
        (row) => decode(BalanceLineSchema, row.body),
      );

      const used = new Set(ordered.map((line) => line.accountId));

      const accounts = balances
        .filter((row) => used.has(row.accountId))
        .map((row) => ({ accountId: row.accountId, code: row.code, name: row.name }))
        .sort((left, right) =>
          left.accountId < right.accountId ? -1 : left.accountId > right.accountId ? 1 : 0,
        );

      if (
        accounts.length > maximumAccounts ||
        new Set(accounts.map((row) => row.accountId)).size !== accounts.length ||
        new Set(accounts.map((row) => row.code)).size !== accounts.length
      ) {
        return yield* failure("InvalidJournal");
      }

      const declared = new Set(accounts.map((row) => `${row.accountId} ${row.code}`));

      if (ordered.some((line) => !declared.has(`${line.accountId} ${line.accountCode}`))) {
        return yield* failure("InvalidJournal");
      }

      const highest = (yield* SieDb.readHighestOrdinal(transaction, command.scope.bookId))[0];
      const ordinal = BigInt(highest?.ordinal ?? "0") + 1n;

      if (ordinal > 9223372036854775807n) return yield* unsupported();
      const now = yield* isoNow(transaction);
      const source: JsonObject = { accounts, lines: ordered };

      const body = yield* digestBody({
        id: newId("sie_capture"),
        scope: command.scope,
        input,
        legalNameEvidenceSha256: evidence.sha256,
        generatorVersion,
        specificationSha256,
        format: "SIE4I",
        generatedOn: now.slice(0, 10),
        startsOn: pack.report.startsOn,
        endsOn: pack.report.endsOn,
        currency: pack.basis.currency,
        currencyScale: 2,
        sequence: pack.basis.sequence,
        source,
        sourceDigest: yield* digestNative(source),
        createdBy: principal.actorId,
        createdAt: now,
        syntheticOnly: true,
        externalAcceptance: "not_established",
      });

      if (JSON.stringify(body).length > maximumCaptureBytes) return yield* unsupported();
      const capture = yield* decode(CaptureSchema, body);
      yield* SieDb.insertCapture(transaction, {
        bookId: command.scope.bookId,
        id: capture.id,
        ordinal: Number(ordinal),
        packId: input.packId,
        evidenceId: input.legalNameEvidenceId,
        actorId: principal.actorId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "capture_sie_transaction",
        principal.actorId,
        capture,
      );

      return capture;
    },
    "update",
  );
});

export const resumeSie = Effect.fn("sie.resume")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  const view = yield* getSie(token, input);

  if (view.artifact) return view;

  const bytes = yield* Effect.try({
    try: () => renderSie(view.capture),
    catch: (error) =>
      error instanceof Accounting.AccountingError ? error : failure("InternalError"),
  });

  return yield* sealSie(token, {
    scope: input.scope,
    id: input.id,
    sealed: {
      captureDigest: view.capture.digest,
      sourceDigest: view.capture.sourceDigest,
      generatorVersion: view.capture.generatorVersion,
      contentBase64: base64(bytes),
      sha256: yield* sha256HexOf(bytes),
      byteLength: bytes.length,
    },
  });
});

const sealSie = Effect.fn("sie.seal")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    sealed: {
      captureDigest: string;
      sourceDigest: string;
      generatorVersion: string;
      contentBase64: string;
      sha256: string;
      byteLength: number;
    };
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      yield* requireSieAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);

      if (!sha256Hex.test(command.sealed.sha256)) return yield* failure("InvalidJournal");
      const row = (yield* SieDb.readCapture(transaction, command.scope.bookId, command.id))[0];

      if (!row) return yield* failure("NotFound");

      if (row.actorId !== principal.actorId) return yield* failure("Forbidden");
      const capture = yield* decode(CaptureSchema, row.body);

      if (
        capture.digest !== command.sealed.captureDigest ||
        capture.sourceDigest !== command.sealed.sourceDigest ||
        capture.generatorVersion !== command.sealed.generatorVersion
      ) {
        return yield* failure("StaleDependency");
      }

      const pack = (yield* SieDb.readPack(transaction, command.scope.bookId, row.packId))[0];

      if (!pack || pack.body.digest !== capture.input.packDigest) {
        return yield* failure("StaleDependency");
      }

      const evidence = (yield* SieDb.readEvidenceDigest(
        transaction,
        command.scope.bookId,
        row.evidenceId,
      ))[0];

      if (!evidence || evidence.sha256 !== capture.legalNameEvidenceSha256) {
        return yield* failure("StaleDependency");
      }

      const bytes = yield* decodeBase64(command.sealed.contentBase64);

      if (
        bytes.length !== command.sealed.byteLength ||
        (yield* sha256HexOf(bytes)) !== command.sealed.sha256
      ) {
        return yield* failure("InvalidJournal");
      }

      const head = new TextDecoder("latin1").decode(bytes.subarray(0, 11));
      const tail = bytes.subarray(bytes.length - 2);

      if (head !== "#FLAGGA 0\r\n" || tail[0] !== 0x0d || tail[1] !== 0x0a) {
        return yield* failure("InvalidJournal");
      }

      const existing = (yield* SieDb.readArtifact(
        transaction,
        command.scope.bookId,
        command.id,
      ))[0];

      if (existing) {
        if (!bytesEqual(existing.content, bytes)) return yield* failure("IdempotencyConflict");

        return yield* readView(transaction, command.scope.bookId, command.id);
      }

      const sealedAt = yield* isoNow(transaction);

      if (capture.generatedOn !== sealedAt.slice(0, 10)) return yield* failure("StaleDependency");
      yield* SieDb.insertArtifact(transaction, {
        bookId: command.scope.bookId,
        captureId: command.id,
        descriptor: {
          captureId: command.id,
          scope: command.scope,
          captureDigest: capture.digest,
          sourceDigest: capture.sourceDigest,
          packDigest: capture.input.packDigest,
          generatorVersion: capture.generatorVersion,
          format: "SIE4I",
          filename: `${command.id}.SI`,
          encoding: "CP437",
          mediaType: "application/octet-stream",
          byteLength: bytes.length,
          sha256: command.sealed.sha256,
          sealedAt,
          syntheticOnly: true,
          externalAcceptance: "not_established",
        },
        content: bytes,
      });

      return yield* readView(transaction, command.scope.bookId, command.id);
    },
    "update",
  );
});

export const prepareSie = Effect.fn("sie.prepare")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: PrepareInput },
) {
  const capture = yield* captureSie(token, command);

  return yield* resumeSie(token, { scope: command.scope, id: capture.id });
});
