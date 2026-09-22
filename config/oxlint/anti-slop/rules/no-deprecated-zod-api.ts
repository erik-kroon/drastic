import { defineRule } from "@oxlint/plugins";

const DEPRECATED_STRING_FORMATS = new Set([
  "base64",
  "base64url",
  "cidrv4",
  "cidrv6",
  "cuid",
  "cuid2",
  "date",
  "datetime",
  "duration",
  "e164",
  "email",
  "emoji",
  "ipv4",
  "ipv6",
  "jwt",
  "nanoid",
  "time",
  "ulid",
  "url",
  "uuid",
]);

function memberName(node: unknown) {
  if (!node || typeof node !== "object") return undefined;
  const member = node as {
    computed?: boolean;
    property?: { name?: string; type?: string; value?: unknown };
    type?: string;
  };
  if (member.type !== "MemberExpression") return undefined;
  if (!member.computed && member.property?.type === "Identifier") return member.property.name;
  if (member.property?.type === "Literal" && typeof member.property.value === "string")
    return member.property.value;
  return undefined;
}

function isNamedMember(node: unknown, name: string) {
  return memberName(node) === name;
}

function isZodFactoryCall(node: unknown, factory: string) {
  if (!node || typeof node !== "object") return false;
  const call = node as { callee?: unknown; type?: string };
  if (call.type !== "CallExpression" || !isNamedMember(call.callee, factory)) return false;
  const callee = call.callee as { object?: { name?: string; type?: string } };
  return callee.object?.type === "Identifier" && callee.object.name === "z";
}

function isZodNumberSchema(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (isZodFactoryCall(node, "number")) return true;
  const call = node as { callee?: unknown; type?: string };
  if (call.type !== "CallExpression" || !call.callee || typeof call.callee !== "object")
    return false;
  const callee = call.callee as { object?: unknown; type?: string };
  if (callee.type !== "MemberExpression") return false;
  if (isNamedMember(callee.object, "coerce")) {
    const coerce = callee.object as { object?: { name?: string; type?: string } };
    if (coerce.object?.type === "Identifier" && coerce.object.name === "z") return true;
  }
  return isZodNumberSchema(callee.object);
}

/** Ban Zod v3 method chains that Zod v4 replaced or made redundant. */
export const noDeprecatedZodApiRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow deprecated or redundant Zod v3 method chains." },
    messages: {
      finite: "Remove `.finite()`; Zod v4 number schemas reject infinite values by default.",
      stringFormat:
        "Replace this deprecated `z.string()` format method with its Zod v4 top-level format schema.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        const format = memberName(node.callee);
        if (format && DEPRECATED_STRING_FORMATS.has(format)) {
          const callee = node.callee as { object?: unknown };
          if (isZodFactoryCall(callee.object, "string"))
            context.report({ node, messageId: "stringFormat" });
        }
        if (isNamedMember(node.callee, "finite")) {
          const callee = node.callee as { object?: unknown };
          if (isZodNumberSchema(callee.object)) context.report({ node, messageId: "finite" });
        }
      },
    };
  },
});
