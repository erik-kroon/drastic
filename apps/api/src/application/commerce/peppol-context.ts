import * as Contracts from "@open-erp/contracts/peppol-exchange";
import * as Effect from "effect/Effect";
import * as Db from "../../db/commerce/peppol-exchange";
import type { Transaction } from "../../db/transaction";
import { RequestEnvironment } from "../../runtime/environment";
import { configuredPeppolAccessPoint } from "../../adapters/peppol/local-fixture";
import { readPeppolDocument, bindingSubject, partyDigest } from "./peppol-document";
import { decode, type Scope } from "./support";
import { failure } from "../failures";

export function accessPoint() {
  return Effect.gen(function* () {
    const settings = (yield* RequestEnvironment).bindings;

    const provider = yield* Effect.try({
      try: () => settings.PEPPOL_EXCHANGE ?? configuredPeppolAccessPoint(settings),
      catch: () => failure("Unavailable"),
    });

    if (!provider) return yield* failure("Unavailable");

    return provider;
  });
}

export function readBinding(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readBinding(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contracts.Binding, row.body);
  });
}

export function currentBinding(
  tx: Transaction,
  scope: Scope,
  binding: typeof Contracts.Binding.Type,
) {
  return Effect.gen(function* () {
    const current = (yield* Db.readCurrentBinding(
      tx,
      scope.bookId,
      binding.role,
      binding.subjectKey,
    ))[0];

    if (!binding.active || !current || current.body.id !== binding.id)
      return yield* failure("StaleDependency");
  });
}

export function capturePeppol(tx: Transaction, scope: Scope, input: typeof Contracts.Prepare.Type) {
  return Effect.gen(function* () {
    const document = yield* readPeppolDocument(tx, scope, input.document);
    const sender = yield* readBinding(tx, scope, input.senderBindingId);
    const recipient = yield* readBinding(tx, scope, input.recipientBindingId);
    yield* currentBinding(tx, scope, sender);
    yield* currentBinding(tx, scope, recipient);

    if (
      sender.role !== "sender" ||
      recipient.role !== "recipient" ||
      sender.providerAccount !== recipient.providerAccount ||
      sender.partyDigest !== (yield* partyDigest(document.seller)) ||
      recipient.partyDigest !== (yield* partyDigest(document.buyer)) ||
      sender.subjectKey !== (yield* bindingSubject(document, "sender")) ||
      recipient.subjectKey !== (yield* bindingSubject(document, "recipient"))
    )
      return yield* failure("InvalidJournal");

    return { document, sender, recipient };
  });
}
