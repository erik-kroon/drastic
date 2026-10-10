import type * as Presence from "@open-erp/contracts/presence";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import * as Effect from "effect/Effect";
import { admitHumanActor, hashToken } from "../db/human-actor";
import * as Db from "../db/presence";
import { databaseFailure, withTransaction } from "../db/transaction";
import { RequestEnvironment } from "../runtime/environment";
import { authorize, presenceBinding, presenceGesture } from "./authority";
import { requireTableAccess, toJsonObject, withBook, type Scope } from "./commerce/support";
import { failure } from "./failures";
import { newId } from "./identifiers";

const challengeLifetimeSeconds = 300;

const enrollmentLifetimeSeconds = 600;

const relyingPartyName = "Drastic";

// The relying party is the origin the session cookie belongs to, resolved as the
// same-origin check in transport/http/auth.ts resolves it.
const relyingParty = Effect.gen(function* () {
  const { bindings, url } = yield* RequestEnvironment;
  const baseURL = bindings.BETTER_AUTH_URL;

  const origin = baseURL
    ? yield* Effect.try({ try: () => new URL(baseURL), catch: () => failure("Unavailable") })
    : url;

  return { id: origin.hostname, origin: origin.origin };
});

function randomChallenge() {
  return crypto.getRandomValues(new Uint8Array(32));
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");

  return Uint8Array.from(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)), (character) =>
    character.charCodeAt(0),
  );
}

// The WebAuthn library leaves optional members undefined; the wire carries JSON.
function wireOptions(
  options: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON,
) {
  return toJsonObject(JSON.parse(JSON.stringify(options)));
}

// A verifier refusal is a refused proof, not a service failure.
function verified<A>(verify: () => Promise<A>) {
  return Effect.tryPromise({ try: verify, catch: () => failure("Forbidden") });
}

function withPresenceTables<A, E, R>(
  token: string,
  operation: (
    transaction: Parameters<Parameters<typeof withTransaction>[0]>[0],
    actor: { readonly actorId: string; readonly sessionId: string },
  ) => Effect.Effect<A, E, R>,
) {
  return withTransaction((transaction) =>
    Effect.gen(function* () {
      const actor = yield* admitHumanActor(transaction, token);
      yield* requireTableAccess(transaction, Db.presenceTables, true);

      return yield* operation(transaction, actor);
    }).pipe(Effect.mapError(databaseFailure)),
  );
}

// The enrolling session's actor must match the ticket; the ticket must be current
// and not yet redeemed. A session alone never enrolls an authenticator.
function admitTicket(
  transaction: Parameters<Parameters<typeof withTransaction>[0]>[0],
  actorId: string,
  ticket: string,
) {
  return Effect.gen(function* () {
    const row = (yield* Db.readTicket(transaction, yield* hashToken(ticket)))[0];

    if (row === undefined || row.actorId !== actorId || !row.current || row.redeemed)
      return yield* failure("Forbidden");

    return row;
  });
}

export const beginPresenceEnrollment = Effect.fn("presence.beginEnrollment")(function* (
  token: string,
  input: typeof Presence.BeginEnrollment.Type,
) {
  const party = yield* relyingParty;

  return yield* withPresenceTables(token, (transaction, actor) =>
    Effect.gen(function* () {
      const ticket = yield* admitTicket(transaction, actor.actorId, input.ticket);
      const existing = yield* Db.readActorAuthenticators(transaction, actor.actorId);

      const options = yield* Effect.promise(() =>
        generateRegistrationOptions({
          rpName: relyingPartyName,
          rpID: party.id,
          userName: actor.actorId,
          userID: new TextEncoder().encode(actor.actorId),
          challenge: randomChallenge(),
          attestationType: "none",
          authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
          excludeCredentials: existing.map((row) => ({ id: row.credentialId })),
          supportedAlgorithmIDs: [-7, -257],
        }),
      );

      const id = newId("presence_enrollment");

      const created = (yield* Db.insertEnrollmentChallenge(transaction, {
        id,
        ticketId: ticket.id,
        actorId: actor.actorId,
        sessionId: actor.sessionId,
        challenge: options.challenge,
        lifetimeSeconds: enrollmentLifetimeSeconds,
      }))[0];

      if (created === undefined) return yield* failure("InternalError");

      return { id, expiresAt: created.expiresAt, options: yield* wireOptions(options) };
    }),
  );
});

export const completePresenceEnrollment = Effect.fn("presence.completeEnrollment")(function* (
  token: string,
  input: typeof Presence.CompleteEnrollment.Type,
) {
  const party = yield* relyingParty;

  return yield* withPresenceTables(token, (transaction, actor) =>
    Effect.gen(function* () {
      const ticket = yield* admitTicket(transaction, actor.actorId, input.ticket);
      const challenge = (yield* Db.readEnrollmentChallenge(transaction, input.challengeId))[0];

      if (
        challenge === undefined ||
        !challenge.current ||
        challenge.ticketId !== ticket.id ||
        challenge.actorId !== actor.actorId ||
        challenge.sessionId !== actor.sessionId
      )
        return yield* failure("Forbidden");

      const result = yield* verified(() =>
        verifyRegistrationResponse({
          response: {
            id: input.response.id,
            rawId: input.response.rawId,
            type: input.response.type,
            response: {
              clientDataJSON: input.response.response.clientDataJSON,
              attestationObject: input.response.response.attestationObject,
            },
            clientExtensionResults: {},
          },
          expectedChallenge: challenge.challenge,
          expectedOrigin: party.origin,
          expectedRPID: party.id,
          requireUserVerification: true,
        }),
      );

      if (!result.verified || result.registrationInfo === undefined)
        return yield* failure("Forbidden");
      const credential = result.registrationInfo.credential;

      yield* Db.insertAuthenticator(transaction, {
        credentialId: credential.id,
        actorId: actor.actorId,
        ticketId: ticket.id,
        publicKey: toBase64Url(credential.publicKey),
        counter: credential.counter,
      });

      return { credentialId: credential.id };
    }),
  );
});

export const beginPresence = Effect.fn("presence.begin")(function* (
  token: string,
  command: { readonly scope: Scope; readonly input: typeof Presence.BeginPresence.Type },
) {
  const party = yield* relyingParty;
  const gesture = presenceGesture(command.input.gesture);

  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* requireTableAccess(transaction, Db.presenceTables, true);

    // Presence is a property of a person at a browser. An API credential has none.
    const person = yield* authorize(principal, "request_presence_challenge");
    const authenticators = yield* Db.readActorAuthenticators(transaction, person.actorId);

    if (authenticators.length === 0) return yield* failure("PresenceRequired");

    const bindingDigest = yield* presenceBinding(
      gesture,
      command.scope.bookId,
      person.actorId,
      command.input.subject,
    );

    const options = yield* Effect.promise(() =>
      generateAuthenticationOptions({
        rpID: party.id,
        challenge: randomChallenge(),
        allowCredentials: authenticators.map((row) => ({ id: row.credentialId })),
        userVerification: "required",
      }),
    );

    const id = newId("presence_challenge");

    const created = (yield* Db.insertChallenge(transaction, {
      id,
      actorId: person.actorId,
      bookId: command.scope.bookId,
      sessionId: person.sessionId,
      gesture,
      bindingDigest,
      challenge: options.challenge,
      lifetimeSeconds: challengeLifetimeSeconds,
    }))[0];

    if (created === undefined) return yield* failure("InternalError");

    return {
      id,
      gesture: command.input.gesture,
      bindingDigest,
      expiresAt: created.expiresAt,
      options: yield* wireOptions(options),
    };
  });
});

export const completePresence = Effect.fn("presence.complete")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly challengeId: string;
    readonly input: typeof Presence.CompletePresence.Type;
  },
) {
  const party = yield* relyingParty;

  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* requireTableAccess(transaction, Db.presenceTables, true);
    const person = yield* authorize(principal, "request_presence_challenge");

    const challenge = (yield* Db.readChallenge(
      transaction,
      command.scope.bookId,
      command.challengeId,
    ))[0];

    if (
      challenge === undefined ||
      !challenge.current ||
      challenge.asserted ||
      challenge.actorId !== person.actorId ||
      challenge.sessionId !== person.sessionId
    )
      return yield* failure("Forbidden");

    const response = command.input.response;
    const key = (yield* Db.lockAuthenticator(transaction, response.id))[0];

    if (key === undefined || key.revoked || key.actorId !== person.actorId)
      return yield* failure("Forbidden");

    // The verifier checks origin, relying party, user presence and verification,
    // the signature and that a nonzero signature counter advanced.
    const result = yield* verified(() =>
      verifyAuthenticationResponse({
        response: {
          id: response.id,
          rawId: response.rawId,
          type: response.type,
          response: {
            clientDataJSON: response.response.clientDataJSON,
            authenticatorData: response.response.authenticatorData,
            signature: response.response.signature,
            userHandle: response.response.userHandle,
          },
          clientExtensionResults: {},
        },
        expectedChallenge: challenge.challenge,
        expectedOrigin: party.origin,
        expectedRPID: party.id,
        credential: {
          id: response.id,
          publicKey: fromBase64Url(key.publicKey),
          counter: Number(key.counter),
        },
        requireUserVerification: true,
      }),
    );

    if (!result.verified || !result.authenticationInfo.userVerified)
      return yield* failure("Forbidden");

    yield* Db.insertAssertion(transaction, {
      challengeId: command.challengeId,
      credentialId: response.id,
      counter: result.authenticationInfo.newCounter,
    });

    return { challengeId: command.challengeId, verified: true as const };
  });
});
