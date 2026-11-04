import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { config } from "../src/lib/config";
import {
  assertStagingTarget,
  verifyDatabaseTarget,
} from "../src/lib/test-target";
const c = config(),
  ref = assertStagingTarget(c),
  adminUrl = process.env.STAGING_ADMIN_DATABASE_URL;
if (adminUrl) verifyDatabaseTarget(adminUrl, ref);
const db = new Pool({
  connectionString: adminUrl || c.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 10000,
});
try {
  await db.query("begin read only");
  const identity = (
    await db.query(
      `select current_database() as database,current_user as role,r.rolsuper,r.rolbypassrls,exists(select 1 from pg_stat_ssl where pid=pg_backend_pid() and ssl) as tls from pg_roles r where r.rolname=current_user`,
    )
  ).rows[0];
  const tables = (
    await db.query(
      "select tablename,rowsecurity from pg_tables where schemaname='public' order by tablename",
    )
  ).rows;
  const managed = (
    await db.query(
      "select to_regclass('auth.users') is not null as real_auth_present,to_regclass('storage.objects') is not null as real_storage_present,to_regclass('supabase_migrations.schema_migrations') is not null as migration_history_present",
    )
  ).rows[0];
  const migrations = managed.migration_history_present
    ? (
        await db.query(
          "select version,name from supabase_migrations.schema_migrations order by version",
        )
      ).rows
    : [];
  const roles = (
    await db.query(
      "select rolname,rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname in ('hireflow_backend','hireflow_web')",
    )
  ).rows;
  const policies = (
    await db.query(
      "select tablename,policyname,roles,cmd from pg_policies where schemaname='public' order by tablename,policyname",
    )
  ).rows;
  const grants = (
    await db.query(
      "select grantee,table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','hireflow_backend') order by table_name,grantee,privilege_type",
    )
  ).rows;
  await db.query("rollback");
  const runtimeDb = new Pool({
    connectionString: c.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  let runtime: Record<string, unknown>;
  try {
    const identity = (
      await runtimeDb.query(
        "select current_user as role,r.rolsuper,r.rolbypassrls,r.rolcreaterole from pg_roles r where r.rolname=current_user",
      )
    ).rows[0];
    let authDenied = false;
    try {
      await runtimeDb.query("select id from auth.users limit 0");
    } catch (error) {
      authDenied = (error as { code?: string }).code === "42501";
    }
    const privileged =
      identity.rolsuper ||
      identity.rolbypassrls ||
      identity.rolcreaterole ||
      !authDenied;
    runtime = {
      ...identity,
      auth_users_denied: authDenied,
      restricted: !privileged,
    };
    if (privileged) process.exitCode = 1;
  } catch (error) {
    runtime = {
      verified: false,
      code:
        (error as { code?: string }).code || "RUNTIME_CONNECTION_UNAVAILABLE",
    };
    process.exitCode = 1;
  } finally {
    await runtimeDb.end();
  }
  const storage = createClient(c.SUPABASE_URL, c.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const bucket = await storage.storage.getBucket("candidate-cvs");
  const settings = await fetch(c.SUPABASE_URL + "/auth/v1/settings", {
    headers: { apikey: c.SUPABASE_ANON_KEY },
    signal: AbortSignal.timeout(10000),
  });
  const authSettings = settings.ok ? await settings.json() : {};
  console.log(
    JSON.stringify(
      {
        project_ref: ref,
        read_only: true,
        inspection_connection: identity,
        runtime_connection: runtime,
        managed,
        tables,
        migrations,
        roles,
        policies,
        grants,
        bucket: bucket.data
          ? {
              id: bucket.data.id,
              public: bucket.data.public,
              file_size_limit: bucket.data.file_size_limit,
              allowed_mime_types: bucket.data.allowed_mime_types,
            }
          : { available: false },
        auth: {
          reachable: settings.ok,
          disable_signup: authSettings.disable_signup,
        },
        auth_redirect_configuration:
          "Requires Management API/dashboard verification; config.toml does not configure hosted Auth.",
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      code: "STAGING_INSPECTION_FAILED",
      database_code: (e as { code?: string }).code || null,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
