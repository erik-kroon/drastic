import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { apiDirectory, database, environment, fixture, ledger, run } from "./support/fixtures";

// Failure contract: an unauthenticated client cannot approve itself; only the
// signed-in operator can consent. An S256 code is single-use, cannot be exchanged
// with a different verifier/redirect URI, and never extends firm/book authority.
// Refresh rotation races and revocation must not restore a revoked authorization.
test("OAuth code, bounded reads, membership removal, expiry and revocation races preserve authority and journals", async () => {
  const book = await fixture();
  const foreign = await fixture();
  const before = await ledger(book);
  const email = `${book.actorId}@oauth.e2e.invalid`;
  const password = randomBytes(24).toString("hex");
  await run("bun", ["--no-env-file", "scripts/create-user.ts", book.actorId], {
    cwd: apiDirectory,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      DATABASE_ADMIN_URL: environment().adminUrl,
      OPENERP_EMAIL: email,
      OPENERP_PASSWORD: password,
    },
  });
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();

  if (!address || typeof address === "string") throw new Error("No OAuth test port");
  const issuer = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  const objectDirectory = join(environment().scratch, `oauth-objects-${book.actorId}`);
  await mkdir(objectDirectory, { mode: 0o700 });

  const native = spawn("bun", ["--no-env-file", "scripts/native-browser-api.ts"], {
    cwd: apiDirectory,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      DATABASE_URL: environment().runtimeUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BETTER_AUTH_URL: issuer,
      OPENERP_NATIVE_API_PORT: String(address.port),
      OPENERP_OBJECT_DIRECTORY: objectDirectory,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines = createInterface({ input: native.stdout });

  try {
    const startup = new Promise<string>((resolve, reject) => {
      native.once("error", reject);
      native.once("exit", () =>
        reject(new Error("OAuth synthetic native API exited before ready")),
      );
      lines.on("line", (line) => {
        if (line.startsWith('{"nativeApi":true,')) resolve(JSON.parse(line).url as string);
      });
    });

    const url = await startup;

    const issuerRequest = async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("origin", issuer);

      return fetch(`${url}${path}`, { ...init, redirect: "manual", headers });
    };

    const signin = await issuerRequest("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    expect(signin.status).toBe(200);

    const cookie = signin.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    expect(cookie).not.toBe("");
    const metadata = await issuerRequest("/.well-known/oauth-authorization-server/api/auth");
    expect(metadata.status).toBe(200);

    const config = (await metadata.json()) as {
      issuer: string;
      code_challenge_methods_supported: string[];
    };

    expect(config.issuer).toBe(`${issuer}/api/auth`);
    expect(config.code_challenge_methods_supported).toContain("S256");

    const resourceMetadata = await issuerRequest("/.well-known/oauth-protected-resource/api/mcp");

    expect(resourceMetadata.status).toBe(200);

    const resource = (await resourceMetadata.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };

    expect(resource).toMatchObject({
      resource: `${issuer}/api/mcp`,
      authorization_servers: [`${issuer}/api/auth`],
      scopes_supported: ["mcp:read"],
    });

    const registered = await issuerRequest("/api/auth/oauth2/create-client", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        client_name: "Synthetic agent",
        redirect_uris: ["https://agent.e2e.invalid/callback"],
        token_endpoint_auth_method: "none",
      }),
    });

    expect(registered.status).toBe(201);
    const client = (await registered.json()) as { client_id: string };
    expect(client.client_id).toBeTruthy();

    const createFirm = await issuerRequest("/api/v1/firms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ name: "Synthetic OAuth bureau" }),
    });

    expect(createFirm.status).toBe(200);
    const firm = (await createFirm.json()) as { firmId: string };

    const linked = await issuerRequest(`/api/v1/firms/${firm.firmId}/clients`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        scope: { entityId: book.entityId, bookId: book.bookId },
        leadId: null,
        nextReviewOn: null,
        note: "Synthetic OAuth grant",
        expectedRevision: 0,
      }),
    });

    expect(linked.status).toBe(200);

    const unselected = await issuerRequest("/api/auth/oauth2/selected-grant", {
      headers: { cookie },
    });

    expect(unselected.status).toBe(200);
    expect(await unselected.json()).toEqual({ grant: null });

    const selected = await issuerRequest("/api/auth/oauth2/select-grant", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ firmId: firm.firmId, bookId: book.bookId }),
    });

    expect(selected.status).toBe(201);
    const grant = (await selected.json()) as { grantId: string; firmId: string; bookId: string };
    expect(grant.firmId).toBe(firm.firmId);
    expect(grant.bookId).toBe(book.bookId);

    const selectedView = await issuerRequest("/api/auth/oauth2/selected-grant", {
      headers: { cookie },
    });

    expect(selectedView.status).toBe(200);
    expect(await selectedView.json()).toMatchObject({
      grant: { id: grant.grantId, firmId: firm.firmId, bookId: book.bookId, available: true },
    });
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL("/api/auth/oauth2/authorize", issuer);

    for (const [name, value] of Object.entries({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "https://agent.e2e.invalid/callback",
      scope: "openid offline_access mcp:read",
      resource: `${issuer}/api/mcp`,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state: "synthetic-state",
      nonce: "synthetic-nonce",
    }))
      authorize.searchParams.set(name, value);

    const response = await issuerRequest(`${authorize.pathname}${authorize.search}`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    const authorization = (await response.json()) as { redirect: true; url: string };
    expect(authorization.redirect).toBe(true);
    const consent = new URL(authorization.url, issuer);
    expect(consent.pathname).toBe("/oauth/consent");

    const accepted = await issuerRequest("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        accept: true,
        oauth_query: consent.search.slice(1),
        scope: "openid offline_access mcp:read",
      }),
    });

    expect(accepted.status).toBe(200);
    const destination = new URL(((await accepted.json()) as { url: string }).url);
    expect(destination.origin).toBe("https://agent.e2e.invalid");
    expect(destination.searchParams.get("state")).toBe("synthetic-state");

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: "https://agent.e2e.invalid/callback",
      code: destination.searchParams.get("code") ?? "",
      code_verifier: verifier,
    });

    const exchanged = await issuerRequest("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });

    expect(exchanged.status).toBe(200);
    const token = (await exchanged.json()) as { access_token: string; refresh_token?: string };
    expect(token.access_token).toBeTruthy();
    expect(token.refresh_token).toBeTruthy();

    const prematureMcp = await issuerRequest("/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        "content-type": "application/json",
        accept: "application/json",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    expect(prematureMcp.status).toBe(200);

    const catalog = (await prematureMcp.json()) as {
      result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> };
    };

    expect(catalog.result.tools.length).toBeGreaterThan(0);
    expect(catalog.result.tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    expect(catalog.result.tools.some((tool) => tool.name === "ledger_snapshot")).toBe(true);
    expect(catalog.result.tools.some((tool) => tool.name === "changes_execute")).toBe(false);

    const ordinaryHttp = await issuerRequest("/api/v1/books", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });

    expect(ordinaryHttp.status).toBeGreaterThanOrEqual(400);

    const callMcp = (name: string, argumentsForTool: object) =>
      issuerRequest("/api/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.access_token}`,
          "content-type": "application/json",
          accept: "application/json",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name, arguments: argumentsForTool },
        }),
      });

    const scope = { entityId: book.entityId, bookId: book.bookId };
    const snapshot = await callMcp("ledger_snapshot", { scope });
    expect(snapshot.status).toBe(200);
    expect(
      (
        (await snapshot.json()) as {
          result: { isError: boolean; structuredContent: { result: unknown } };
        }
      ).result,
    ).toMatchObject({ isError: false, structuredContent: { result: before } });
    const refusedWrite = await callMcp("changes_execute", { scope });
    expect(((await refusedWrite.json()) as { error: { code: number } }).error.code).toBe(-32602);
    const provisioning = await database();

    try {
      await provisioning.query(
        "insert into openerp.memberships(book_id, actor_id, role) values ($1, $2, 'operator')",
        [foreign.bookId, book.actorId],
      );

      const foreignRead = await callMcp("ledger_snapshot", {
        scope: { entityId: foreign.entityId, bookId: foreign.bookId },
      });

      expect(((await foreignRead.json()) as { result: { isError: boolean } }).result.isError).toBe(
        true,
      );

      const directory = await callMcp("book_list", {});
      expect(
        (
          (await directory.json()) as {
            result: { structuredContent: { result: Array<{ id: string }> } };
          }
        ).result.structuredContent.result.map((entry) => entry.id),
      ).toEqual([book.bookId]);

      for (const removal of [
        {
          sql: "update openerp.firm_members set active = false where firm_id = $1 and actor_id = $2",
          restore:
            "update openerp.firm_members set active = true where firm_id = $1 and actor_id = $2",
          values: [firm.firmId, book.actorId],
        },
        {
          sql: "update openerp.memberships set role = 'agent' where book_id = $1 and actor_id = $2",
          restore:
            "update openerp.memberships set role = 'operator' where book_id = $1 and actor_id = $2",
          values: [book.bookId, book.actorId],
        },
      ]) {
        await provisioning.query(removal.sql, removal.values);
        expect((await callMcp("ledger_snapshot", { scope })).status).toBeGreaterThanOrEqual(400);
        await provisioning.query(removal.restore, removal.values);
      }

      await provisioning.query(
        "insert into openerp.identity_admissions(actor_id, provider_id, subject, enabled) values ($1, 'oauth-synthetic', $1, false)",
        [book.actorId],
      );
      expect((await callMcp("ledger_snapshot", { scope })).status).toBe(401);
      await provisioning.query(
        "update openerp.identity_admissions set enabled = true where actor_id = $1",
        [book.actorId],
      );
      expect((await callMcp("ledger_snapshot", { scope })).status).toBe(200);

      const accessHash = createHash("sha256").update(token.access_token).digest("hex");
      await provisioning.query(
        "update openerp_auth.oauth_access_token set expires_at = clock_timestamp() - interval '1 second' where token = $1",
        [accessHash],
      );
      expect((await callMcp("ledger_snapshot", { scope })).status).toBe(401);
      await provisioning.query(
        "update openerp_auth.oauth_access_token set expires_at = clock_timestamp() + interval '1 hour' where token = $1",
        [accessHash],
      );
    } finally {
      await provisioning.end();
    }

    const invalidResource = new URL(authorize);
    invalidResource.searchParams.set("resource", "https://foreign.e2e.invalid/api/mcp");

    const wrongResourceResponse = await issuerRequest(
      `${invalidResource.pathname}${invalidResource.search}`,
      { headers: { cookie } },
    );

    const wrongResourceBody = (await wrongResourceResponse.json()) as {
      url?: string;
      error?: string;
    };

    const wrongResourceError =
      wrongResourceBody.error ??
      (wrongResourceBody.url
        ? new URL(wrongResourceBody.url, issuer).searchParams.get("error")
        : null);

    expect(
      wrongResourceResponse.status >= 400 || Boolean(wrongResourceError),
      `Wrong resource error: ${wrongResourceError}`,
    ).toBe(true);

    const persisted = await database();
    let referenceBound = false;

    try {
      const tokens = await persisted.query<{
        reference_id: string | null;
        resources: string[] | null;
      }>(
        "SELECT reference_id, resources FROM openerp_auth.oauth_access_token WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
        [book.actorId],
      );

      referenceBound =
        tokens.rows[0]?.reference_id === grant.grantId &&
        tokens.rows[0]?.resources?.includes(`${issuer}/api/mcp`) === true;
      expect(referenceBound).toBe(true);
    } finally {
      await persisted.end();
    }

    async function freshCode() {
      const fresh = new URL(authorize);
      fresh.searchParams.set("prompt", "consent");
      fresh.searchParams.set("state", crypto.randomUUID());

      const response = await issuerRequest(`${fresh.pathname}${fresh.search}`, {
        headers: { cookie },
      });

      expect(response.status).toBe(200);
      const redirect = new URL(((await response.json()) as { url: string }).url, issuer);
      expect(redirect.pathname).toBe("/oauth/consent");

      const consent = await issuerRequest("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          accept: true,
          oauth_query: redirect.search.slice(1),
          scope: "openid offline_access mcp:read",
        }),
      });

      expect(consent.status).toBe(200);

      return (
        new URL(((await consent.json()) as { url: string }).url).searchParams.get("code") ?? ""
      );
    }

    const exchange = (body: URLSearchParams) =>
      issuerRequest("/api/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });

    for (const field of ["code_verifier", "redirect_uri"]) {
      const invalid = new URLSearchParams(form);
      invalid.set("code", await freshCode());
      invalid.set(
        field,
        field === "code_verifier"
          ? randomBytes(32).toString("base64url")
          : "https://foreign.e2e.invalid/callback",
      );
      expect((await exchange(invalid)).status).toBeGreaterThanOrEqual(400);
    }

    const refresh = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: token.refresh_token ?? "",
    });

    const baselineRefresh = await issuerRequest("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: refresh,
    });

    const refreshError = baselineRefresh.ok
      ? null
      : (((await baselineRefresh.clone().json()) as { error?: string }).error ?? "unknown");

    expect(baselineRefresh.status, `Refresh error code: ${refreshError}`).toBe(200);

    const rotated = (await baselineRefresh.json()) as { refresh_token?: string; scope?: string };

    expect(
      rotated.refresh_token,
      `Refresh response scope: ${rotated.scope ?? "unknown"}`,
    ).toBeTruthy();

    refresh.set("refresh_token", rotated.refresh_token ?? "");

    const refreshAttempts = await Promise.all(
      [0, 1].map(() =>
        issuerRequest("/api/auth/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: refresh,
        }),
      ),
    );

    const refreshStatuses = refreshAttempts.map((attempt) => attempt.status);
    const refreshSuccesses = refreshStatuses.filter((status) => status === 200).length;

    expect(refreshSuccesses).toBeLessThanOrEqual(1);

    const successfulRefresh = refreshAttempts.find((attempt) => attempt.status === 200);

    const refreshed = successfulRefresh
      ? ((await successfulRefresh.json()) as { refresh_token?: string })
      : null;

    expect(refreshed?.refresh_token).toBeTruthy();

    refresh.set("refresh_token", refreshed?.refresh_token ?? "");

    const afterConcurrentReplay = await issuerRequest("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: refresh,
    });

    expect(afterConcurrentReplay.status).toBeGreaterThanOrEqual(400);

    const replay = await issuerRequest("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });

    expect(replay.status).toBeGreaterThanOrEqual(400);

    const freshExchange = new URLSearchParams(form);
    freshExchange.set("code", await freshCode());
    const freshResponse = await exchange(freshExchange);
    expect(freshResponse.status).toBe(200);

    const raceToken = (await freshResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };

    const [revoked, raceRefresh] = await Promise.all([
      issuerRequest("/api/auth/oauth2/revoke-grant", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ grantId: grant.grantId }),
      }),
      exchange(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: client.client_id,
          refresh_token: raceToken.refresh_token,
        }),
      ),
    ]);

    if (raceRefresh.ok) {
      const issued = (await raceRefresh.json()) as { access_token: string; refresh_token: string };

      const revokedAccess = await issuerRequest("/api/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${issued.access_token}`,
          "content-type": "application/json",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }),
      });

      expect(revokedAccess.status).toBe(401);
      expect(
        (
          await exchange(
            new URLSearchParams({
              grant_type: "refresh_token",
              client_id: client.client_id,
              refresh_token: issued.refresh_token,
            }),
          )
        ).status,
      ).toBeGreaterThanOrEqual(400);
    } else {
      expect(raceRefresh.status).toBe(400);
    }

    expect(revoked.status).toBe(200);
    expect((await callMcp("ledger_snapshot", { scope })).status).toBe(401);
    expect(await ledger(book)).toEqual(before);
    expect(
      (
        await issuerRequest("/api/auth/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: client.client_id,
            refresh_token: token.refresh_token ?? "",
          }),
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);

    const afterRevocation = await database();

    try {
      const rows = await afterRevocation.query<{ grant_id: string }>(
        "SELECT grant_id FROM openerp.oauth_agent_revocations WHERE grant_id = $1",
        [grant.grantId],
      );

      expect(rows.rows[0]?.grant_id).toBe(grant.grantId);
    } finally {
      await afterRevocation.end();
    }

    const authorizationAfterRevocation = await issuerRequest(
      `${authorize.pathname}${authorize.search}`,
      { headers: { cookie } },
    );

    expect(authorizationAfterRevocation.status).toBeGreaterThanOrEqual(400);

    await writeFile(
      join(environment().artifacts, "oauth-mcp-code-flow.json"),
      JSON.stringify(
        {
          status: "scoped_read_only_mcp",
          provider: "@better-auth/oauth-provider@1.7.5",
          issuerMatchesDiscovery: config.issuer === `${issuer}/api/auth`,
          mcpResourceDiscoveryMatchesIssuer: resource.resource === `${issuer}/api/mcp`,
          s256Advertised: config.code_challenge_methods_supported.includes("S256"),
          signedIn: signin.status === 200,
          publicClientCreated: registered.status === 201,
          grantBoundToFirmAndBook: grant.firmId === firm.firmId && grant.bookId === book.bookId,
          consentAccepted: accepted.status === 200,
          codeExchanged: exchanged.status === 200,
          tokenBoundToImmutableReferenceAndResource: referenceBound,
          mcpBearerAdmittedToReadOnlyCatalog: prematureMcp.status === 200,
          codeReplayRefused: replay.status >= 400,
          baselineRefreshSucceeded: baselineRefresh.status === 200,
          concurrentRefreshStatuses: refreshStatuses,
          concurrentRefreshDidNotDoubleIssue: refreshSuccesses <= 1,
          refreshFamilyInvalidatedAfterReplay: afterConcurrentReplay.status >= 400,
          appendOnlyRevocationRecorded: revoked.status === 200,
          authorizationAfterRevocationRefused: authorizationAfterRevocation.status >= 400,
          foreignBookRefusedAfterMembershipAdded: true,
          removedMembershipRefused: true,
          expiredTokenRefused: true,
          ordinaryHttpRefused: ordinaryHttp.status === 401,
          revokedGrantRefused: true,
          unchangedLedger: true,
          invalidVerifierAndRedirectRefused: true,
          refreshVersusRevocationDidNotRestoreAccess: true,
          pending: ["consent UI browser qualification"],
        },
        null,
        2,
      ),
    );
  } finally {
    lines.close();

    if (native.pid && native.exitCode === null) {
      const exited = once(native, "exit");
      process.kill(-native.pid, "SIGTERM");
      await exited;
    }
  }
});
