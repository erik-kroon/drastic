import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type Parameter = ESTree.ParamPattern;
type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

function returnsTypePredicate(node: ParameterOwner): boolean {
  return node.returnType?.typeAnnotation.type === "TSTypePredicate";
}

function functionName(node: ParameterOwner): string | null {
  if ((node.type === "FunctionDeclaration" || node.type === "FunctionExpression") && node.id)
    return node.id.name;
  const parent = node.parent;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name;
  if (parent.type === "MethodDefinition" && parent.key.type === "Identifier")
    return parent.key.name;
  return null;
}

function isBoundaryParser(node: ParameterOwner): boolean {
  const name = functionName(node);
  return name !== null && /^(?:as|coerce|decode|is|normalize|parse|read|validate)/u.test(name);
}

function isGenericUiOrTestFile(filename: string): boolean {
  return (
    /(?:^|\/)packages\/ui\/src\/components\//u.test(filename) ||
    /(?:^|\/)apps\/server\/src\/components\/pdf\//u.test(filename) ||
    /(?:^|\/)(?:tests?|e2e)\//u.test(filename) ||
    /\.(?:test|spec|vitest)\.[cm]?[jt]sx?$/u.test(filename)
  );
}

function parameterAnnotation(parameter: Parameter): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") {
    return parameterAnnotation(parameter.parameter);
  }
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
  }
  return parameter.typeAnnotation;
}

function parameterName(parameter: Parameter, sourceText: string): string {
  if (parameter.type === "TSParameterProperty") {
    return parameterName(parameter.parameter, sourceText);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameterName(parameter.left, sourceText);
  }
  if (parameter.type === "RestElement") {
    return parameterName(parameter.argument, sourceText);
  }
  return parameter.type === "Identifier"
    ? parameter.name
    : sourceText.replace(/\s*:\s*unknown\s*$/u, "");
}

/** Disallow unknown inputs except explicitly named error-cause enrichment. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow explicitly unknown function parameters except `cause`; decode unknown input at its I/O boundary instead.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.",
    },
  },
  create(context) {
    if (isGenericUiOrTestFile(context.filename)) return {};
    const checkParameters = (node: ParameterOwner) => {
      if (returnsTypePredicate(node) || isBoundaryParser(node)) return;
      for (const parameter of node.params) {
        const annotation = parameterAnnotation(parameter);
        if (annotation?.typeAnnotation.type !== "TSUnknownKeyword") continue;
        const name = parameterName(parameter, context.sourceCode.getText(parameter));
        if (name === "cause" || name === "error" || name === "value") continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId: "unknownParameter",
          data: { parameter: name },
        });
      }
    };

    return {
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      TSCallSignatureDeclaration: checkParameters,
      TSConstructSignatureDeclaration: checkParameters,
      TSConstructorType: checkParameters,
      TSDeclareFunction: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      TSFunctionType: checkParameters,
      TSMethodSignature: checkParameters,
    };
  },
});
