import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import * as Source from "@open-erp/contracts/source-intake";
import * as Workspace from "@open-erp/contracts/workspace";
import { documentSelfHost } from "./support/document-self-host";
import {
  decoded,
  environment,
  failure,
  fixture,
  key,
  persisted,
  request,
} from "./support/fixtures";

test("external retention verifies orphan bytes and preserves distinct acquisitions", async () => {
  const book = await fixture();
  const before = await persisted(book);
  const directory = join(environment().scratch, "retention-orphan-objects");
  const host = await documentSelfHost("http://127.0.0.1:1", book.agentToken, directory);
  const bytes = Buffer.from("Synthetic orphan supplier original");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const objectPath = join(directory, "v1", book.bookId, hash);

  const input = {
    sourceSystem: "orphan_recovery_fixture",
    sourceAccountId: "supplier_source",
    occurrenceKey: "first_acquisition",
    sourceRevision: "1",
    filename: "supplier.txt",
    mediaType: "text/plain",
    contentBase64: bytes.toString("base64"),
    destination: "supplier_inbox",
  };

  const commandKey = key();

  const send = (body: typeof input, identity: string) =>
    fetch(`${host.origin}${book.path}/source-occurrences`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${book.token}`,
        "content-type": "application/json",
        "idempotency-key": identity,
      },
      body: JSON.stringify(body),
    });

  try {
    await mkdir(dirname(objectPath), { recursive: true });
    await writeFile(objectPath, bytes, { flag: "wx" });
    const first = await decoded(await send(input, commandKey), Source.SourceOccurrence);
    expect(await decoded(await send(input, commandKey), Source.SourceOccurrence)).toEqual(first);

    const second = await decoded(
      await send({ ...input, occurrenceKey: "second_acquisition" }, key()),
      Source.SourceOccurrence,
    );

    expect(second.id).not.toBe(first.id);
    expect(first.sha256).toBe(`sha256:${hash}`);
    expect(second.sha256).toBe(first.sha256);
    expect(await readFile(objectPath)).toEqual(bytes);

    const attention = await decoded(
      await request(book, "/attention?kind=document"),
      Workspace.AttentionPage,
    );

    expect(attention.total).toBe("2");
    expect(attention.items.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
    expect(await persisted(book)).toEqual(before);
    await writeFile(
      join(environment().artifacts, "source-retention-orphan-recovery.json"),
      JSON.stringify({ first, second, attention, objectSha256: hash }, null, 2),
    );
  } finally {
    await host.close();
  }
});

test("external retention refuses corrupt objects without overwrite or published work", async () => {
  const book = await fixture();
  const before = await persisted(book);
  const directory = join(environment().scratch, "retention-corrupt-objects");
  const host = await documentSelfHost("http://127.0.0.1:1", book.agentToken, directory);
  const bytes = Buffer.from("Synthetic correct supplier original");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const objectPath = join(directory, "v1", book.bookId, hash);
  const commandKey = key();
  const observations: Array<{ corruptLength: number; workCount: string }> = [];

  try {
    await mkdir(dirname(objectPath), { recursive: true });

    for (const corrupt of [Buffer.alloc(bytes.length, 120), Buffer.from("short")]) {
      await writeFile(objectPath, corrupt);

      const response = await fetch(`${host.origin}${book.path}/source-occurrences`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${book.token}`,
          "content-type": "application/json",
          "idempotency-key": commandKey,
        },
        body: JSON.stringify({
          sourceSystem: "corrupt_recovery_fixture",
          sourceAccountId: "supplier_source",
          occurrenceKey: "corrupt_acquisition",
          sourceRevision: "1",
          filename: "supplier.txt",
          mediaType: "text/plain",
          contentBase64: bytes.toString("base64"),
          destination: "supplier_inbox",
        }),
      });

      await failure(response, 422, "MissingEvidence");
      expect(await readFile(objectPath)).toEqual(corrupt);

      const attention = await decoded(
        await request(book, "/attention?kind=document"),
        Workspace.AttentionPage,
      );

      expect(attention.total).toBe("0");
      observations.push({ corruptLength: corrupt.length, workCount: attention.total });
    }

    expect(await persisted(book)).toEqual(before);
    await writeFile(
      join(environment().artifacts, "source-retention-corrupt-refusal.json"),
      JSON.stringify({ observations, expectedObjectSha256: hash }, null, 2),
    );
  } finally {
    await host.close();
  }
});
