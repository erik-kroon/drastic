import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const destination = new URL(".env", import.meta.url);
const secret = () => randomBytes(32).toString("hex");
await writeFile(
  destination,
  [
    "OPENERP_PUBLIC_URL=http://localhost:3000",
    "OPENERP_PORT=3000",
    `POSTGRES_PASSWORD=${secret()}`,
    `OPENERP_RUNTIME_PASSWORD=${secret()}`,
    `BETTER_AUTH_SECRET=${secret()}`,
    "",
  ].join("\n"),
  { flag: "wx", mode: 0o600 },
);
console.info(
  "Created infra/self-host/.env with independent secrets. Existing configuration is never overwritten.",
);
