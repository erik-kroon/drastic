import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { Browser } from "@e2e-dev/web";
import * as Schema from "effect/Schema";

const SyntheticSession = Schema.Struct({
  url: Schema.String,
  workspace: Schema.String,
  email: Schema.String,
  password: Schema.String,
});

export async function signInSyntheticOperator(browser: Browser, baseUrl: string | undefined) {
  const sessionFile = process.env.OPENERP_E2E_SESSION;

  if (
    !sessionFile ||
    basename(sessionFile) !== "session.json" ||
    !basename(dirname(sessionFile)).startsWith("openerp-paper-")
  ) {
    throw new Error("Run bun run test:browser to provision a disposable synthetic session");
  }

  const session = Schema.decodeUnknownSync(SyntheticSession)(
    JSON.parse(await readFile(sessionFile, "utf8")),
  );

  if (
    session.url !== new URL(baseUrl ?? "http://invalid.test").origin ||
    new URL(session.url).hostname !== "127.0.0.1" ||
    session.workspace !== `${session.url}/entities/entity_synthetic/books/book_synthetic`
  )
    throw new Error("Synthetic session does not match the test target");

  const login = await fetch(`${session.url}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: session.url },
    body: JSON.stringify({ email: session.email, password: session.password }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!login.ok) throw new Error(`Synthetic sign-in failed: HTTP ${login.status}`);

  const cookies = login.headers.getSetCookie().map((header) => {
    const pair = header.split(";")[0];

    if (!pair) throw new Error("Missing session cookie");

    const separator = pair.indexOf("=");

    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      url: session.url,
      httpOnly: true,
      sameSite: "Lax" as const,
    };
  });

  if (!cookies.length) throw new Error("Sign-in returned no session cookies");

  await browser.setCookies(cookies);

  return session.workspace;
}
