import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/client";

// TanStack Query owns remote state; use Better Auth's plain client for auth commands.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [oauthProviderClient()],
  fetchOptions: { timeout: 20_000 },
});
