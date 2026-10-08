import * as Collections from "@open-erp/contracts/collections";
import * as Schema from "effect/Schema";
import { assertUniqueJsonKeys } from "../json-keys";

export type ReminderWireMessage = {
  readonly externalIdentity: string;
  readonly messageDigest: string;
  readonly destination: string;
  readonly subject: string;
  readonly plainText: string;
  readonly html: string;
  readonly attachments: readonly (typeof Collections.ReminderAttachment.Type & {
    readonly contentBase64: string;
  })[];
};

export interface ReminderDelivery {
  readonly identity: "local-fixture-v1";
  submit(
    message: ReminderWireMessage,
  ): Promise<typeof Collections.ReminderProviderObservation.Type>;
  reconcile(externalIdentity: string): Promise<typeof Collections.ReminderProviderObservation.Type>;
}

export function configuredReminderDelivery(settings: {
  readonly OPENERP_REMINDER_DELIVERY?: string;
  readonly OPENERP_REMINDER_ENDPOINT?: string;
  readonly OPENERP_REMINDER_SECRET?: string;
}): ReminderDelivery | undefined {
  if (
    settings.OPENERP_REMINDER_DELIVERY === undefined ||
    settings.OPENERP_REMINDER_DELIVERY === "disabled"
  )
    return undefined;

  if (settings.OPENERP_REMINDER_DELIVERY !== "local-fixture")
    throw new Error("Reminder delivery profile is unavailable.");
  const endpoint = settings.OPENERP_REMINDER_ENDPOINT;
  const secret = settings.OPENERP_REMINDER_SECRET;

  if (!endpoint || !secret || secret.length < 32 || secret.length > 512)
    throw new Error("Authenticated reminder fixture configuration is required.");
  const origin = new URL(endpoint);

  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.port === "" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("Reminder fixture must use a bare loopback HTTP origin with an explicit port.");

  async function exchange(path: string, method: "POST" | "GET", input?: ReminderWireMessage) {
    const response = await fetch(new URL(path, origin), {
      ...(method === "GET" ? { method: "GET" } : { method: "POST", body: JSON.stringify(input) }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        accept: "application/json",
      },
    });

    if (!response.ok || response.body === null)
      throw new Error("Reminder fixture outcome unavailable.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    let body = "";
    let size = 0;

    try {
      for (;;) {
        const chunk = await reader.read();

        if (chunk.done) break;
        size += chunk.value.byteLength;

        if (size > 8192) throw new Error("Reminder fixture response exceeds its bound.");
        body += decoder.decode(chunk.value, { stream: true });
      }

      body += decoder.decode();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }

    assertUniqueJsonKeys(new TextEncoder().encode(body));

    return Schema.decodeSync(Schema.fromJsonString(Collections.ReminderProviderObservation))(body);
  }

  return {
    identity: "local-fixture-v1",
    submit: (message) => exchange("/messages", "POST", message),
    reconcile: (identity) => exchange(`/messages/${encodeURIComponent(identity)}`, "GET"),
  };
}
