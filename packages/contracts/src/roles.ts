import * as Schema from "effect/Schema";

// The reviewed account-role vocabulary. It lives in its own leaf so every family
// section of a rule release can name a role without importing another family's
// contract module.
export const RoleKind = Schema.Literals(["bank", "commerce", "owner", "subledger", "tax", "vat"]);
