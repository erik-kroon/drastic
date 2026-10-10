import * as Schema from "effect/Schema";
import * as Inbox from "@open-erp/contracts/supplier-inbox";

const FixtureItem = Schema.Struct({
  fileId: Inbox.IntakeItem.fields.fileId,
  revision: Inbox.IntakeItem.fields.revision,
  filename: Inbox.IntakeItem.fields.filename,
  mediaType: Inbox.IntakeItem.fields.mediaType,
  contentBase64: Schema.NullOr(Inbox.IntakeItem.fields.contentBase64),
  state: Schema.Literals(["available", "refused", "timeout", "expired"]),
});

export const FixturePage = Schema.Struct({
  items: Schema.Array(FixtureItem).check(Schema.isMaxLength(32)),
  nextCursor: Schema.NullOr(Inbox.CloudIntake.fields.cursor),
});

export function configuredIntakeFeed(settings: {
  readonly OPENERP_INTAKE_FEED?: string;
  readonly OPENERP_INTAKE_ENDPOINT?: string;
  readonly OPENERP_INTAKE_SECRET?: string;
}) {
  if (settings.OPENERP_INTAKE_FEED === undefined || settings.OPENERP_INTAKE_FEED === "disabled")
    return undefined;

  if (settings.OPENERP_INTAKE_FEED !== "local-fixture")
    throw new Error("Intake feed profile unavailable");
  const { OPENERP_INTAKE_ENDPOINT: endpoint, OPENERP_INTAKE_SECRET: secret } = settings;

  if (!endpoint || !secret || secret.length < 32 || secret.length > 512)
    throw new Error("Authenticated intake fixture configuration required");
  const origin = new URL(endpoint);

  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    !origin.port ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("Intake fixture requires bare loopback origin with explicit port");

  return async (
    provider: "drive" | "dropbox",
    account: string,
    folder: string,
    cursor: string | null,
  ) => {
    const url = new URL("/page", origin);
    url.searchParams.set("provider", provider);
    url.searchParams.set("account", account);
    url.searchParams.set("folder", folder);

    if (cursor !== null) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });

    if (response.status !== 200 || response.redirected || response.body === null)
      throw new Error("Intake fixture page unavailable");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
      for (;;) {
        const chunk = await reader.read();

        if (chunk.done) break;
        size += chunk.value.byteLength;

        if (size > 8 * 1024 * 1024) throw new Error("Intake fixture page too large");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }

    const bytes = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return Schema.decodeUnknownSync(FixturePage)(JSON.parse(new TextDecoder().decode(bytes)));
  };
}
