import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { apiDirectory, database, environment, fixture, run } from "./support/fixtures";

// Failure contract: an unauthenticated client cannot approve itself; only the
// signed-in operator can consent. An S256 code is single-use, cannot be exchanged
// with a different verifier/redirect URI, and never extends firm/book authority.
// Refresh rotation races and revocation must not restore a revoked authorization.
test("signed-in operator completes S256 OAuth code exchange against real PostgreSQL", async () => {
  const book = await fixture();
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
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.identity_admissions(actor_id, provider_id, subject, enabled) VALUES ($1, 'oauth-synthetic', $2, true)",
      [book.actorId, book.actorId],
    );
  } finally {
    await admin.end();
  }

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

    const issuerRequest = async (path: string, init?: RequestInit) =>
      fetch(`${url}${path}`, {
        ...init,
        redirect: "manual",
        headers: { origin: issuer, ...init?.headers },
      });

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

    const selected = await issuerRequest("/api/auth/oauth2/select-grant", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ firmId: firm.firmId, bookId: book.bookId }),
    });

    expect(selected.status).toBe(201);
    const grant = (await selected.json()) as { grantId: string; firmId: string; bookId: string };
    expect(grant.firmId).toBe(firm.firmId);
    expect(grant.bookId).toBe(book.bookId);
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

    expect(prematureMcp.status).toBe(401);
    expect(prematureMcp.headers.get("www-authenticate")).toContain(
      `resource_metadata="${issuer}/.well-known/oauth-protected-resource/api/mcp"`,
    );

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

    const revoked = await issuerRequest("/api/auth/oauth2/revoke-grant", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ grantId: grant.grantId }),
    });

    expect(revoked.status).toBe(200);

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
          status: "code_flow_only",
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
          mcpBearerDisabledUntilScopedAdmission: prematureMcp.status === 401,
          codeReplayRefused: replay.status >= 400,
          baselineRefreshSucceeded: baselineRefresh.status === 200,
          concurrentRefreshStatuses: refreshStatuses,
          concurrentRefreshDidNotDoubleIssue: refreshSuccesses <= 1,
          refreshFamilyInvalidatedAfterReplay: afterConcurrentReplay.status >= 400,
          appendOnlyRevocationRecorded: revoked.status === 200,
          authorizationAfterRevocationRefused: authorizationAfterRevocation.status >= 400,
          pending: [
            "transactional firm/book ceiling admission",
            "MCP bearer admission",
            "grant revocation",
            "refresh-family race",
          ],
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

test.todo("invalid verifier, wrong redirect, wrong resource and expired token refuse");

test.todo(
  "added membership never widens token ceiling; revoked firm/book membership and grant deny admission and transaction recheck",
);

test.todo(
  "refresh rotation/replay and concurrent rotation never restore revoked grant or broaden token family",
);

test.todo(
  "MCP discovery and invocation agree on effect classification and delegated HTTP human approval refuses",
);

test.todo(
  "sanitized repeatable proof records resource discovery, issuer discovery, scope and unchanged journals",
);
