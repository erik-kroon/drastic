import { createAuthClient } from "better-auth/client";

// TanStack Query owns remote state; use Better Auth's plain client for auth commands.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  fetchOptions: { timeout: 20_000 },
});
