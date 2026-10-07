import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { Browser, Cookie } from "@e2e-dev/web";
import * as Schema from "effect/Schema";
import * as Workspace from "../../packages/contracts/src/workspace";

const SyntheticSession = Schema.Struct({
  url: Schema.String,
  workspace: Schema.String,
  email: Schema.String,
  password: Schema.String,
});

const workerSessions = new Map<
  string,
  {
    readonly fingerprint: string;
    readonly cookies: Promise<readonly Cookie[]>;
    actorId?: string;
  }
>();

async function publicSignIn(session: typeof SyntheticSession.Type): Promise<readonly Cookie[]> {
  const login = await fetch(`${session.url}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: session.url },
    body: JSON.stringify({ email: session.email, password: session.password }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!login.ok)
    throw new Error(
      `Synthetic sign-in failed: HTTP ${login.status}: ${(await login.text()).slice(0, 2000)}`,
    );

  const cookies = login.headers.getSetCookie().map((header) => {
    const pair = header.split(";")[0];

    if (!pair) throw new Error("Missing session cookie");

    const separator = pair.indexOf("=");

    if (separator < 1) throw new Error("Invalid session cookie");

    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      url: session.url,
      httpOnly: true,
      sameSite: "Lax" as const,
    };
  });

  if (!cookies.length) throw new Error("Sign-in returned no session cookies");

  return cookies;
}

async function readSyntheticOperator(
  session: typeof SyntheticSession.Type,
  cookies: readonly Cookie[],
) {
  const response = await fetch(
    `${session.url}/api/v1${new URL(session.workspace).pathname}/workspace`,
    {
      headers: {
        origin: session.url,
        cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
      },
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) throw new Error(`Synthetic session validation failed: HTTP ${response.status}`);

  const team = Schema.decodeSync(Schema.fromJsonString(Workspace.Coordination))(
    await response.text(),
  );

  if (
    team.scope.entityId !== "entity_synthetic" ||
    team.scope.bookId !== "book_synthetic" ||
    !team.members.some((member) => member.id === team.actorId && member.role === "operator")
  )
    throw new Error("Synthetic session requires actual scoped operator membership");

  return team.actorId;
}

export async function signInSyntheticOperator(browser: Browser, baseUrl: string | undefined) {
  const sessionFile = process.env.OPENERP_E2E_SESSION;

  if (
    !sessionFile ||
    basename(sessionFile) !== "session.json" ||
    !basename(dirname(sessionFile)).startsWith("openerp-paper-")
  ) {
    throw new Error("Run bun run test:browser to provision a disposable synthetic session");
  }

  const contents = await readFile(sessionFile, "utf8");
  const session = Schema.decodeSync(Schema.fromJsonString(SyntheticSession))(contents);

  if (
    session.url !== new URL(baseUrl ?? "http://invalid.test").origin ||
    new URL(session.url).protocol !== "http:" ||
    new URL(session.url).hostname !== "127.0.0.1" ||
    session.workspace !== `${session.url}/entities/entity_synthetic/books/book_synthetic`
  )
    throw new Error("Synthetic session does not match the test target");

  const key = JSON.stringify([sessionFile, session.url]);
  const fingerprint = createHash("sha256").update(contents).digest("hex");
  const existing = workerSessions.get(key);

  if (!existing || existing.fingerprint !== fingerprint)
    workerSessions.set(key, { fingerprint, cookies: publicSignIn(session) });

  const retained = workerSessions.get(key);

  if (!retained) throw new Error("Synthetic worker session was not retained");

  const cookies = await retained.cookies;
  const actorId = await readSyntheticOperator(session, cookies);

  if (retained.actorId !== undefined && retained.actorId !== actorId)
    throw new Error("Synthetic worker session operator changed");

  retained.actorId = actorId;

  await browser.setCookies(cookies);

  return session.workspace;
}
