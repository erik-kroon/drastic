import { Client } from "pg";
import * as Schema from "effect/Schema";
import {
  DatabaseInventory,
  ReleaseManifest,
  RoleInventory,
} from "../../../../packages/contracts/src/operations";
import { refuse } from "./safety";

export async function roleInventory(client: Client) {
  const result = await client.query<{ body: unknown }>(`
    SELECT jsonb_build_object('name', r.rolname, 'superuser', r.rolsuper, 'inherit', r.rolinherit,
      'createRole', r.rolcreaterole, 'createDatabase', r.rolcreatedb, 'login', r.rolcanlogin,
      'replication', r.rolreplication, 'bypassRls', r.rolbypassrls, 'connectionLimit', r.rolconnlimit,
      'expiresAt', r.rolvaliduntil::text,
      'memberships', coalesce((SELECT jsonb_agg(jsonb_build_object('role', g.rolname, 'grantor', pg_get_userbyid(m.grantor), 'admin', m.admin_option,
        'inherit', m.inherit_option, 'set', m.set_option) ORDER BY g.rolname COLLATE "C", pg_get_userbyid(m.grantor) COLLATE "C")
        FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid), '[]')) AS body
    FROM pg_roles r WHERE r.rolname !~ '^pg_' ORDER BY r.rolname COLLATE "C"`);

  return result.rows.map((row) => Schema.decodeUnknownSync(RoleInventory)(row.body));
}

export async function databaseInventory(
  client: Client,
  release: typeof ReleaseManifest.Type,
  quarantined = false,
) {
  const unsupported = await client.query<{ found: boolean }>(
    `
    SELECT EXISTS(SELECT FROM pg_extension WHERE extname <> 'plpgsql')
      OR EXISTS(SELECT FROM pg_publication) OR EXISTS(SELECT FROM pg_subscription)
      OR EXISTS(SELECT FROM pg_inherits) OR EXISTS(SELECT FROM pg_policy)
      OR EXISTS(SELECT FROM pg_seclabel) OR EXISTS(SELECT FROM pg_shseclabel) OR EXISTS(SELECT FROM pg_foreign_server)
      OR EXISTS(SELECT FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND r.rulename<>'_RETURN')
      OR EXISTS(SELECT FROM pg_index WHERE NOT indisvalid OR NOT indisready)
      OR EXISTS(SELECT FROM pg_db_role_setting WHERE setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname=current_database()))
        AND NOT ($1::boolean AND setrole=0 AND setdatabase<>0 AND setconfig=ARRAY['default_transaction_read_only=on']))
      OR EXISTS(SELECT FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND NOT c.convalidated)
      OR EXISTS(SELECT FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND t.tgenabled NOT IN ('O','A'))
      OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND (c.reltablespace<>0 OR c.relkind NOT IN ('r','i','v','c') OR pg_get_userbyid(c.relowner)<>current_user))
      OR EXISTS(SELECT FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND pg_get_userbyid(n.nspowner)<>current_user AND NOT(n.nspname='public' AND pg_get_userbyid(n.nspowner)='pg_database_owner'))
      OR EXISTS(SELECT FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND (pg_get_userbyid(t.typowner)<>current_user OR t.typtype NOT IN ('d','e','c','b') OR (t.typtype='b' AND t.typelem=0)))
      OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND (p.prokind<>'f' OR l.lanname NOT IN ('sql','plpgsql') OR pg_get_userbyid(p.proowner)<>current_user)) AS found`,
    [quarantined],
  );

  if (unsupported.rows[0]?.found !== false)
    refuse(
      "Unsupported extension, replication, role/database setting, ownership, relation or disabled constraint/trigger requires reviewed recovery support.",
    );

  const metadata = await client.query<{
    owner: string;
    encoding: string;
    collation: string;
    ctype: string;
    localeProvider: string;
  }>(`
    SELECT pg_get_userbyid(datdba) AS owner, pg_encoding_to_char(encoding) AS encoding,
      datcollate AS collation, datctype AS ctype, datlocprovider AS "localeProvider"
    FROM pg_database WHERE datname=current_database() AND datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND dattablespace=(SELECT oid FROM pg_tablespace WHERE spcname='pg_default')`);

  const database = metadata.rows[0];

  if (!database || database.localeProvider !== "c")
    refuse("Only explicitly owned libc-locale default-tablespace databases are supported.");

  const extensions = await client.query<{ name: string; version: string }>(
    'SELECT extname AS name, extversion AS version FROM pg_extension ORDER BY extname COLLATE "C"',
  );

  const migrations = await client.query<{ name: string; sha256: string }>(
    'SELECT name, sha256 FROM public.openerp_migrations ORDER BY name COLLATE "C"',
  );

  const files = release.files.filter((file) =>
    /^apps\/api\/migrations\/[^/]+\.sql$/.test(file.path),
  );

  if (
    files.length !== migrations.rows.length ||
    migrations.rows.some(
      (row) =>
        !files.some(
          (file) => file.path === `apps/api/migrations/${row.name}` && file.sha256 === row.sha256,
        ),
    ) ||
    files.length === 0
  ) {
    refuse(
      "Applied migration receipts differ from the captured release. A partial or changed schema cannot be marked complete.",
    );
  }

  const schemaHash = await client.query<{ sha256: string }>(`
    WITH objects(kind, name, body) AS (
      SELECT 'schema', n.nspname, jsonb_build_object('owner',pg_get_userbyid(n.nspowner),
        'acl',(SELECT jsonb_agg(a::text ORDER BY a::text COLLATE "C") FROM unnest(coalesce(n.nspacl,acldefault('n',n.nspowner))) a))
      FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      UNION ALL
      SELECT 'relation', n.nspname||'.'||c.relname, jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
        'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'options',c.reloptions,
        'acl',(SELECT jsonb_agg(a::text ORDER BY a::text COLLATE "C") FROM unnest(coalesce(c.relacl,acldefault('r',c.relowner))) a),
        'view',CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid) ELSE NULL END)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','v','c')
      UNION ALL
      SELECT 'column', n.nspname||'.'||c.relname||'.'||a.attname, jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),
        'ordinal',a.attnum,'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
        'collation',(SELECT q.nspname||'.'||x.collname FROM pg_collation x JOIN pg_namespace q ON q.oid=x.collnamespace WHERE x.oid=a.attcollation),
        'default',pg_get_expr(d.adbin,d.adrelid),'acl',(SELECT jsonb_agg(x::text ORDER BY x::text COLLATE "C") FROM unnest(a.attacl) x))
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','v','c') AND a.attnum>0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'function', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
        jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
          'acl',(SELECT jsonb_agg(a::text ORDER BY a::text COLLATE "C") FROM unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      UNION ALL
      SELECT 'type', n.nspname||'.'||t.typname, jsonb_build_object('kind',t.typtype,'owner',pg_get_userbyid(t.typowner),
        'base',CASE WHEN t.typbasetype<>0 THEN format_type(t.typbasetype,t.typtypmod) ELSE NULL END,
        'element',CASE WHEN t.typelem<>0 THEN format_type(t.typelem,NULL) ELSE NULL END,
        'notNull',t.typnotnull,'default',t.typdefault,
        'enum',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid),
        'acl',(SELECT jsonb_agg(a::text ORDER BY a::text COLLATE "C") FROM unnest(coalesce(t.typacl,acldefault('T',t.typowner))) a))
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      UNION ALL
      SELECT 'constraint', n.nspname||'.'||coalesce(c.relname,t.typname)||'.'||k.conname, to_jsonb(pg_get_constraintdef(k.oid))
      FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace LEFT JOIN pg_class c ON c.oid=k.conrelid LEFT JOIN pg_type t ON t.oid=k.contypid
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      UNION ALL
      SELECT 'index', n.nspname||'.'||c.relname, to_jsonb(pg_get_indexdef(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('i','I')
      UNION ALL
      SELECT 'trigger', n.nspname||'.'||c.relname||'.'||t.tgname, jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND NOT t.tgisinternal
      UNION ALL
      SELECT 'default-acl', pg_get_userbyid(d.defaclrole)||'.'||coalesce(n.nspname,'')||'.'||d.defaclobjtype::text,
        (SELECT jsonb_agg(a::text ORDER BY a::text COLLATE "C") FROM unnest(d.defaclacl) a)
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    ) SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(kind,name,body) ORDER BY kind COLLATE "C",name COLLATE "C",body::text COLLATE "C"),'[]')::text,'UTF8')),'hex') AS sha256 FROM objects`);

  return Schema.decodeUnknownSync(DatabaseInventory)({
    ...database,
    schemaSha256: schemaHash.rows[0]?.sha256,
    extensions: extensions.rows,
    migrations: migrations.rows,
    roles: await roleInventory(client),
  });
}
