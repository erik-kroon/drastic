import { genericOAuth } from "better-auth/plugins/generic-oauth";

export function oidcPlugin(config: {
  providerId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
}) {
  const plugin = genericOAuth({
    config: [
      {
        providerId: config.providerId,
        name: "Organization sign-in",
        discoveryUrl: `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scopes: ["openid", "profile", "email"],
        pkce: true,
        responseType: "code",
        responseMode: "query",
        requireIdTokenVerification: true,
        disableImplicitSignUp: true,
        disableSignUp: true,
        overrideUserInfo: false,
        disableProviderLogout: true,
      },
    ],
  });
  const init: typeof plugin.init = async (context) => {
    const result = await plugin.init(context);
    const provider = result.context.socialProviders.find((item) => item.id === config.providerId);
    if (!provider || provider.issuer !== config.issuer)
      throw new Error("OIDC discovery does not match the configured issuer.");
    const getUserInfo = provider.getUserInfo;
    // The SDK verifies signature, issuer, audience and the request nonce. Require a
    // token even when the provider also offers a userinfo-only OAuth fallback.
    provider.getUserInfo = (tokens) =>
      tokens.idToken ? getUserInfo(tokens) : Promise.resolve(null);
    return result;
  };
  return { ...plugin, init };
}
