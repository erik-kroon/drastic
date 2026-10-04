import * as Schema from "effect/Schema";

const object = Schema.Record(Schema.String, Schema.Json);

const paths = Schema.Record(Schema.String, object);

const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

export function describeAuthentication(input: typeof object.Type) {
  const document = Schema.decodeSync(object)(input);
  const components = Schema.decodeUnknownSync(object)(document.components);
  const schemes = Schema.decodeUnknownSync(object)(components.securitySchemes);
  const describedPaths = new Map<string, typeof object.Type>();

  for (const [path, item] of Object.entries(Schema.decodeUnknownSync(paths)(document.paths))) {
    const described = { ...item };

    for (const [method, value] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      const operation = Schema.decodeUnknownSync(object)(value);
      const publicProbe = path === "/api/health" || path === "/api/v1/system";

      described[method] = {
        ...operation,
        security: publicProbe
          ? []
          : [{ AutomationBearer: [] }, { BrowserSession: [] }, { SecureBrowserSession: [] }],
      };
    }

    describedPaths.set(path, described);
  }

  return {
    ...document,
    paths: Object.fromEntries(describedPaths),
    components: {
      ...components,
      securitySchemes: {
        ...schemes,
        AutomationBearer: {
          type: "http",
          scheme: "bearer",
          description:
            "Book-scoped API token. Current identity, membership and operation authority are checked by the application.",
        },
        BrowserSession: {
          type: "apiKey",
          in: "cookie",
          name: "openerp.session_token",
          description:
            "Better Auth session on local HTTP. Browser mutations require the configured same-origin Origin header.",
        },
        SecureBrowserSession: {
          type: "apiKey",
          in: "cookie",
          name: "__Secure-openerp.session_token",
          description:
            "Better Auth session on HTTPS. Browser mutations require the configured same-origin Origin header.",
        },
      },
    },
  };
}
