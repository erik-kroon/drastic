import { createServer } from "node:http";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("bureau selects one book and explicitly consents to read-only OAuth access", async ({
  app,
  browser,
  screen,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const headers = { cookie, origin, "content-type": "application/json" };

  const call = (path: string, body?: object) =>
    fetch(`${origin}${path}`, {
      method: body ? "POST" : "GET",
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      redirect: "manual",
    });

  const ledgerPath = "/api/v1/entities/entity_synthetic/books/book_synthetic/ledger";
  const beforeResponse = await call(ledgerPath);
  expect(beforeResponse.status).toBe(200);
  const before = await beforeResponse.json();
  let callbackCode: string | null = null;
  let callbackState: string | null = null;
  let callbackError: string | null = null;

  const callback = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://callback.invalid");
    callbackCode = url.searchParams.get("code");
    callbackState = url.searchParams.get("state");
    callbackError = url.searchParams.get("error");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      callbackError
        ? "<!doctype html><html lang=sv><title>Klientens svar</title><h1>Åtkomsten nekades</h1></html>"
        : "<!doctype html><html lang=sv><title>Klientens svar</title><h1>Åtkomsten har godkänts</h1></html>",
    );
  });

  callback.listen(0, "127.0.0.1");
  await once(callback, "listening");
  const address = callback.address();

  if (!address || typeof address === "string") throw new Error("No synthetic callback port");
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;

  try {
    const registered = await call("/api/auth/oauth2/create-client", {
      client_name: "Bokföringsassistenten",
      client_uri: "https://assistent.example.test",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      application_type: "native",
    });

    expect(registered.status).toBe(201);
    const client = (await registered.json()) as { client_id: string };
    const created = await call("/api/v1/firms", { name: "Sund Redovisning AB" });
    expect(created.status).toBe(200);
    const firm = (await created.json()) as { firmId: string };

    const linked = await call(`/api/v1/firms/${firm.firmId}/clients`, {
      scope: { entityId: "entity_synthetic", bookId: "book_synthetic" },
      leadId: null,
      nextReviewOn: null,
      note: "Synthetic OAuth consent",
      expectedRevision: 0,
    });

    expect(linked.status).toBe(200);
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(16).toString("hex");
    const authorize = new URL("/api/auth/oauth2/authorize", origin);

    for (const [name, value] of Object.entries({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: "openid offline_access mcp:read",
      resource: `${origin}/api/mcp`,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      state,
      nonce: randomBytes(16).toString("hex"),
    }))
      authorize.searchParams.set(name, value);
    const authorization = await call(`${authorize.pathname}${authorize.search}`);
    expect(authorization.status).toBe(200);
    const selection = (await authorization.json()) as { url: string };
    await app.open(selection.url);
    await expect(screen.getByRole("heading", "Välj byrå och bok", { exact: true })).toBeVisible();
    expect(
      await browser.evaluate(() =>
        Array.from(document.querySelectorAll("select"), (select) => select.value),
      ),
    ).toEqual(["", ""]);
    await expect(screen.getByRole("button", "Välj byrå och bok", { exact: true })).toBeDisabled();
    await expect(screen.getByRole("combobox", "Byrå", { exact: true })).toBeEnabled();
    await expect(screen.getByText("Hämtar åtkomsten…", { exact: true })).not.toBeVisible();
    await browser.evaluate(async () => {
      await document.fonts.ready;

      return document.fonts.status;
    });
    const selectionScreenshot = await app.screenshot("oauth-selection-empty");
    await screen
      .getByRole("combobox", "Byrå", { exact: true })
      .selectOption({ label: "Sund Redovisning AB" });
    await expect(screen.getByRole("combobox", "Bok", { exact: true })).toBeEnabled();
    await screen
      .getByRole("combobox", "Bok", { exact: true })
      .selectOption({ label: "Fjällby Konsult AB" });
    await screen.getByRole("button", "Fortsätt", { exact: true }).click();
    await expect(screen.getByRole("heading", "Ge appen läsåtkomst", { exact: true })).toBeVisible();
    await expect(screen.getByText("Sund Redovisning AB", { exact: true })).toBeVisible();
    await expect(screen.getByText("Bokföringsassistenten", { exact: true })).toBeVisible();
    const consentUrl = await browser.url();
    await app.open(consentUrl);
    await expect(screen.getByRole("heading", "Ge appen läsåtkomst", { exact: true })).toBeVisible();
    await browser.evaluate(async () => {
      await document.fonts.ready;

      return document.fonts.status;
    });
    await expect(screen.getByRole("button", "Tillåt läsåtkomst", { exact: true })).toBeEnabled();
    const consentScreenshot = await app.screenshot("oauth-consent-retained");
    await screen.getByRole("button", "Tillåt läsåtkomst", { exact: true }).focus();
    await browser.keyboard.press("Enter");
    await expect(
      screen.getByRole("heading", "Åtkomsten har godkänts", { exact: true }),
    ).toBeVisible();
    expect(String(callbackState)).toBe(state);
    expect(callbackCode).toBeTruthy();

    const exchange = await fetch(`${origin}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code: callbackCode ?? "",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    expect(exchange.status).toBe(200);
    const token = (await exchange.json()) as { access_token: string };

    const catalog = await fetch(`${origin}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        "content-type": "application/json",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(20_000),
    });

    expect(catalog.status).toBe(200);

    const tools = (
      (await catalog.json()) as {
        result: { tools: Array<{ annotations: { readOnlyHint: boolean } }> };
      }
    ).result.tools;

    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);

    const deniedState = randomBytes(16).toString("hex");
    authorize.searchParams.set("state", deniedState);
    authorize.searchParams.set("prompt", "consent");
    const deniedAuthorization = await call(`${authorize.pathname}${authorize.search}`);
    expect(deniedAuthorization.status).toBe(200);
    const denied = (await deniedAuthorization.json()) as { url: string };
    await app.open(denied.url);
    await expect(screen.getByRole("button", "Neka", { exact: true })).toBeEnabled();
    await screen.getByRole("button", "Neka", { exact: true }).click();
    await expect(screen.getByRole("heading", "Åtkomsten nekades", { exact: true })).toBeVisible();
    expect(String(callbackState)).toBe(deniedState);
    expect(String(callbackError)).toBe("access_denied");
    expect(callbackCode).toBeNull();

    const selected = (await (await call("/api/auth/oauth2/selected-grant")).json()) as {
      grant: { id: string };
    };

    expect(
      (await call("/api/auth/oauth2/revoke-grant", { grantId: selected.grant.id })).status,
    ).toBe(200);
    await app.open(consentUrl);
    await expect(screen.getByText("Åtkomsten gäller inte längre", { exact: true })).toBeVisible();
    await expect(
      screen.getByRole("button", "Åtkomsten gäller inte längre", { exact: true }),
    ).toBeDisabled();
    expect(await (await call(ledgerPath)).json()).toEqual(before);

    if (!process.env.OPENERP_E2E_OUTPUT) throw new Error("Missing synthetic output");
    await writeFile(
      join(process.env.OPENERP_E2E_OUTPUT, "oauth-consent.json"),
      JSON.stringify(
        {
          status: "local_synthetic",
          noPreselectedScope: true,
          nativeSelectChoices: true,
          keyboardConsent: true,
          denialIssuedNoCode: true,
          reloadRetainedGrant: true,
          explicitConsent: true,
          callbackStatePreserved: true,
          readOnlyCatalog: true,
          revokedGrantBlocked: true,
          unchangedLedger: true,
          screenshots: { selection: selectionScreenshot, consent: consentScreenshot },
        },
        null,
        2,
      ),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      callback.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
