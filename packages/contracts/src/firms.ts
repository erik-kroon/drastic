import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CompanySetup } from "./company-setup";
import { DeadlineList } from "./deadlines";
import { BankWorkspace, BankWorkspaceAccount } from "./bank-workspace";
import { BankInventorySignoffList } from "./bank-inventory-signoffs";
import { ClosingReadiness } from "./closing";

const Revision = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2147483646 }));

export const FirmRole = Schema.Literals(["admin", "accountant"]);

export const Firm = Schema.Struct({
  id: Accounting.Identifier,
  name: Schema.String,
  role: FirmRole,
});

export const FirmList = Schema.Array(Firm).check(Schema.isMaxLength(100));

export const Member = Schema.Struct({
  actorId: Accounting.Identifier,
  name: Schema.String,
  email: Schema.String,
  role: FirmRole,
  active: Schema.Boolean,
  signInEnabled: Schema.Boolean,
  revision: Revision,
});

export const Client = Schema.Struct({
  book: Accounting.Book,
  leadId: Schema.NullOr(Accounting.Identifier),
  leadAvailable: Schema.Boolean,
  nextReviewOn: Schema.NullOr(Accounting.AccountingDate),
  note: Schema.String,
  revision: Revision,
  eligibleLeadIds: Schema.Array(Accounting.Identifier),
});

export const AccessRequestState = Schema.Literals(["requested", "revoked"]);

export const AccessRequest = Schema.Struct({
  id: Accounting.Identifier,
  clientName: Schema.String,
  organizationNumber: Schema.NullOr(Schema.String),
  leadId: Schema.NullOr(Accounting.Identifier),
  leadAvailable: Schema.Boolean,
  requestedBy: Accounting.Identifier,
  state: AccessRequestState,
  revision: Revision,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const SaveAccessRequest = Schema.Struct({
  id: Accounting.Identifier,
  clientName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  organizationNumber: Schema.NullOr(Schema.String.check(Schema.isPattern(/^\d{10}$/))),
  leadId: Schema.NullOr(Accounting.Identifier),
  state: AccessRequestState,
  expectedRevision: Revision,
});

export const Workspace = Schema.Struct({
  firm: Firm,
  actorId: Accounting.Identifier,
  clients: Schema.Array(Client).check(Schema.isMaxLength(200)),
  members: Schema.Array(Member).check(Schema.isMaxLength(100)),
  accessRequests: Schema.Array(AccessRequest).check(Schema.isMaxLength(200)),
});

export const PortfolioClientFacts = Schema.Struct({
  scope: Accounting.Scope,
  company: CompanySetup,
  period: Schema.NullOr(Accounting.BookSetup.fields.periods.value),
  openTasks: Schema.NullOr(Accounting.MinorUnits),
  deadlines: DeadlineList,
  bank: Schema.NullOr(BankWorkspace),
  bankObservations: Schema.Array(
    Schema.Struct({
      startsOn: Accounting.AccountingDate,
      endsOn: Accounting.AccountingDate,
      checkedAt: Schema.String,
      account: BankWorkspaceAccount,
    }),
  ).check(Schema.isMaxLength(100)),
  bankInventorySignoffs: Schema.Array(
    Schema.Struct({
      ...BankInventorySignoffList.fields.items.value.fields,
      accountIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(100)),
      dependenciesCurrent: Schema.Boolean,
      reviewScope: Schema.Literal("whole_declared_bank_inventory"),
      coverage: Schema.Literal("declared_inventory_only"),
      companyCompleteness: Schema.Literal("not_established"),
      financialCloseReady: Schema.Literal(false),
      signedArtifact: Schema.NullOr(
        Schema.Struct({ sha256: Accounting.Digest, byteLength: Schema.Int }),
      ),
    }),
  ).check(Schema.isMaxLength(200)),
  closing: Schema.NullOr(ClosingReadiness),
});

export const Portfolio = Schema.Struct({
  workspace: Workspace,
  observedFrom: Schema.String,
  observedUntil: Schema.String,
  clients: Schema.Array(PortfolioClientFacts).check(Schema.isMaxLength(200)),
});

export const CreateFirm = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});

export const SaveClient = Schema.Struct({
  scope: Accounting.Scope,
  leadId: Schema.NullOr(Accounting.Identifier),
  nextReviewOn: Schema.NullOr(Accounting.AccountingDate),
  note: Schema.String.check(Schema.isMaxLength(2000)),
  expectedRevision: Revision,
});

export const RemoveClient = Schema.Struct({ scope: Accounting.Scope, expectedRevision: Revision });

export const SaveMember = Schema.Struct({
  email: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(254)),
  role: FirmRole,
  active: Schema.Boolean,
  expectedRevision: Revision,
});

export const CommandResult = Schema.Struct({ firmId: Accounting.Identifier, revision: Revision });

const path = Schema.Struct({ firmId: Accounting.Identifier });

const command = {
  ...path.fields,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

export const FirmCapabilities = {
  firm_list: {
    description: "List firms for the signed-in human. Firm membership grants no book access.",
    input: Schema.Struct({}),
    output: FirmList,
    readOnly: true,
  },
  firm_get: {
    description:
      "Read a firm team and only those client books the current human can access. Limited to 200 client links and 100 team members.",
    input: path,
    output: Workspace,
    readOnly: true,
  },
  firm_get_portfolio: {
    description:
      "Read permitted client observations from company, canonical work, deadline, bank and closing owners. Pending access metadata contains no accounting facts. This live observation interval is not an atomic multi-book snapshot, verified company readiness or an access grant.",
    input: path,
    output: Portfolio,
    readOnly: true,
    agentCallable: false,
  },
  firm_create: {
    description:
      "Create a firm workspace for the current provisioned human, without granting any accounting permissions.",
    input: Schema.Struct({ idempotencyKey: command.idempotencyKey, input: CreateFirm }),
    output: CommandResult,
    readOnly: false,
  },
  firm_save_client: {
    description:
      "Link a client or update its responsible accountant, review date and note. Requires book operator authority and the current revision. Linking a new client also requires firm admin authority.",
    input: Schema.Struct({ ...command, input: SaveClient }),
    output: CommandResult,
    readOnly: false,
  },
  firm_remove_client: {
    description:
      "Unlink a client from a firm. Requires firm admin and book operator authority. Does not delete accounting data or revoke book access.",
    input: Schema.Struct({ ...command, input: RemoveClient }),
    output: CommandResult,
    readOnly: false,
  },
  firm_save_member: {
    description:
      "Add an already provisioned human to a firm, change their firm role or remove firm membership. Requires firm admin authority and the current revision. Does not grant or revoke book access.",
    input: Schema.Struct({ ...command, input: SaveMember }),
    output: CommandResult,
    readOnly: false,
  },
  firm_save_access_request: {
    description:
      "Record or revoke a local declared client-access request for a human firm member. Sends no invitation, reveals no accounting facts and grants no book permissions. Requires the current revision; revoked requests are terminal.",
    input: Schema.Struct({ ...command, input: SaveAccessRequest }),
    output: CommandResult,
    readOnly: false,
    agentCallable: false,
  },
};

export const FirmApi = HttpApiGroup.make("firms").add(
  HttpApiEndpoint.get("listFirms", "/v1/firms", { success: FirmList, error: accountingErrors }),
  HttpApiEndpoint.get("getFirm", "/v1/firms/:firmId", {
    params: path,
    success: Workspace,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getFirmPortfolio", "/v1/firms/:firmId/portfolio", {
    params: path,
    success: Portfolio,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("createFirm", "/v1/firms", {
    headers: Accounting.IdempotencyHeaders,
    payload: CreateFirm,
    success: CommandResult,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("saveFirmClient", "/v1/firms/:firmId/clients", {
    params: path,
    headers: Accounting.IdempotencyHeaders,
    payload: SaveClient,
    success: CommandResult,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("removeFirmClient", "/v1/firms/:firmId/clients/remove", {
    params: path,
    headers: Accounting.IdempotencyHeaders,
    payload: RemoveClient,
    success: CommandResult,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("saveFirmMember", "/v1/firms/:firmId/members", {
    params: path,
    headers: Accounting.IdempotencyHeaders,
    payload: SaveMember,
    success: CommandResult,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("saveFirmAccessRequest", "/v1/firms/:firmId/access-requests", {
    params: path,
    headers: Accounting.IdempotencyHeaders,
    payload: SaveAccessRequest,
    success: CommandResult,
    error: accountingErrors,
  }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
);

export const FirmSearch = Schema.Struct({
  firm: Schema.optional(Accounting.Identifier),
  tab: Schema.optional(Schema.Literals(["clients", "team"])),
});
