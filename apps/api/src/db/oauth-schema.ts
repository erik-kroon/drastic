import { boolean, index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { user, session } from "./auth-schema";

const auth = pgSchema("openerp_auth");

export const oauthClient = auth.table(
  "oauth_client",
  {
    id: text().primaryKey(),
    clientId: text("client_id").unique().notNull(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled"),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes").array(),
    userId: text("user_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens"),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => [index("oauth_client_user_id_idx").on(table.userId)],
);

export const oauthResource = auth.table("oauth_resource", {
  id: text().primaryKey(),
  identifier: text("identifier").unique().notNull(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required"),
  disabled: boolean("disabled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  policyVersion: integer("policy_version"),
  metadata: jsonb("metadata"),
});

export const oauthClientResource = auth.table(
  "oauth_client_resource",
  {
    id: text().primaryKey(),
    clientId: text("client_id")
      .references(() => oauthClient.clientId, { onDelete: "cascade" })
      .notNull(),
    resourceId: text("resource_id")
      .references(() => oauthResource.identifier, { onDelete: "cascade" })
      .notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("oauth_client_resource_client_id_idx").on(table.clientId),
    index("oauth_client_resource_resource_id_idx").on(table.resourceId),
  ],
);

export const oauthRefreshToken = auth.table(
  "oauth_refresh_token",
  {
    id: text().primaryKey(),
    token: text("token").unique().notNull(),
    clientId: text("client_id")
      .references(() => oauthClient.clientId)
      .notNull(),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id")
      .references(() => user.id)
      .notNull(),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revoked: timestamp("revoked", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at", { withTimezone: true }),
    authTime: timestamp("auth_time", { withTimezone: true }),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauth_refresh_token_client_id_idx").on(table.clientId),
    index("oauth_refresh_token_session_id_idx").on(table.sessionId),
    index("oauth_refresh_token_user_id_idx").on(table.userId),
    index("oauth_refresh_token_authorization_code_id_idx").on(table.authorizationCodeId),
  ],
);

export const oauthAccessToken = auth.table(
  "oauth_access_token",
  {
    id: text().primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .references(() => oauthClient.clientId)
      .notNull(),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revoked: timestamp("revoked", { withTimezone: true }),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauth_access_token_client_id_idx").on(table.clientId),
    index("oauth_access_token_session_id_idx").on(table.sessionId),
    index("oauth_access_token_user_id_idx").on(table.userId),
    index("oauth_access_token_authorization_code_id_idx").on(table.authorizationCodeId),
    index("oauth_access_token_refresh_id_idx").on(table.refreshId),
  ],
);

export const oauthConsent = auth.table(
  "oauth_consent",
  {
    id: text().primaryKey(),
    clientId: text("client_id")
      .references(() => oauthClient.clientId)
      .notNull(),
    userId: text("user_id").references(() => user.id),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("oauth_consent_client_id_idx").on(table.clientId),
    index("oauth_consent_user_id_idx").on(table.userId),
  ],
);

export const oauthClientAssertion = auth.table("oauth_client_assertion", {
  id: text().primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
