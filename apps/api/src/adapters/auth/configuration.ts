import * as Effect from "effect/Effect";
import { failure } from "../../application/failures";
import type { Bindings } from "../../runtime/environment";

// Namespace the immutable subject by both issuer and application registration.
// Reconfiguring a provider cannot reinterpret an existing subject-to-actor binding.
export async function oidcProviderId(issuer: string, clientId: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([issuer, clientId])),
  );

  return `oidc_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function authConfiguration(bindings: Bindings) {
  return Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => new URL(bindings.BETTER_AUTH_URL ?? ""),
      catch: () => failure("Unavailable"),
    });

    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return yield* failure("Unavailable");
    const mode = bindings.OPENERP_AUTH_MODE ?? (local ? "local" : "oidc");

    if (mode === "local" && local)
      return { method: "password" as const, url, local, provider: null };

    if (
      mode !== "oidc" ||
      !bindings.OIDC_ISSUER ||
      !bindings.OIDC_CLIENT_ID ||
      !bindings.OIDC_CLIENT_SECRET
    )
      return yield* failure("Unavailable");

    const issuer = yield* Effect.try({
      try: () => new URL(bindings.OIDC_ISSUER ?? ""),
      catch: () => failure("Unavailable"),
    });

    if (
      issuer.protocol !== "https:" ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash
    )
      return yield* failure("Unavailable");

    const providerId = yield* Effect.tryPromise({
      try: () => oidcProviderId(bindings.OIDC_ISSUER ?? "", bindings.OIDC_CLIENT_ID ?? ""),
      catch: () => failure("Unavailable"),
    });

    return {
      method: "oidc" as const,
      url,
      local,
      provider: {
        providerId,
        issuer: bindings.OIDC_ISSUER,
        clientId: bindings.OIDC_CLIENT_ID,
        clientSecret: bindings.OIDC_CLIENT_SECRET,
      },
    };
  });
}
