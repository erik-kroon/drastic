import { eslintCompatPlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";
import { noDeprecatedZodApiRule } from "./rules/no-deprecated-zod-api.ts";
import { noDesignSystemEscapeHatchesRule } from "./rules/no-design-system-escape-hatches.ts";
import { noHardcodedDesignValuesRule } from "./rules/no-hardcoded-design-values.ts";
import { noFeatureReactHooksRule } from "./rules/no-feature-react-hooks.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noLongCommentsRule } from "./rules/no-long-comments.ts";
import { noModuleMockingRule } from "./rules/no-module-mocking.ts";
import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noOverzealousDestructuringRule } from "./rules/no-overzealous-destructuring.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";
import { noRawHtmlLayoutRule } from "./rules/no-raw-html-layout.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.ts";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.ts";
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.ts";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts";
import { noTypeAssertionsRule } from "./rules/no-type-assertions.ts";
import { noUiPresenceTestsRule } from "./rules/no-ui-presence-tests.ts";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";
import { requireReadableSpacingRule } from "./rules/require-readable-spacing.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts";

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
    "no-deprecated-zod-api": noDeprecatedZodApiRule,
    "no-design-system-escape-hatches": noDesignSystemEscapeHatchesRule,
    "no-hardcoded-design-values": noHardcodedDesignValuesRule,
    "no-feature-react-hooks": noFeatureReactHooksRule,
    "no-known-value-widening": noKnownValueWideningRule,
    "no-long-comments": noLongCommentsRule,
    "no-module-mocking": noModuleMockingRule,
    "no-object-parameters": noObjectParametersRule,
    "no-overzealous-destructuring": noOverzealousDestructuringRule,
    "no-reflect-apply": noReflectApplyRule,
    "no-reflect-get": noReflectGetRule,
    "no-raw-html-layout": noRawHtmlLayoutRule,
    "no-runtime-typeof": noRuntimeTypeofRule,
    "no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
    "no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
    "no-unknown-parameters": noUnknownParametersRule,
    "no-unknown-returns": noUnknownReturnsRule,
    "no-unknown-type-aliases": noUnknownTypeAliasesRule,
    "no-type-assertions": noTypeAssertionsRule,
    "no-ui-presence-tests": noUiPresenceTestsRule,
    "no-widen-then-assert": noWidenThenAssertRule,
    "require-readable-spacing": requireReadableSpacingRule,
    "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
  },
});

export default antiSlopPlugin;
