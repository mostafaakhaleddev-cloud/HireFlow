import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
// SQL-only test harness. The stub auth/storage schemas are NOT Supabase Auth/Storage.
const adminUrl =
  process.env.TEST_POSTGRES_URL ||
  "postgresql://postgres@127.0.0.1:55432/postgres";
const url = new URL(adminUrl);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("Native SQL harness is loopback-only.");
const admin = new Pool({ connectionString: adminUrl, max: 1 }),
  name = "hireflow_test_" + randomBytes(6).toString("hex");
await admin.query(`create database "${name}"`);
url.pathname = "/" + name;
const db = new Pool({ connectionString: url.toString(), max: 1 });
let exit = 1;
try {
  // Earlier harness runs may have created the cluster-wide role. Exercise RLS
  // explicitly rather than letting a retained BYPASSRLS flag hide policy defects.
  await admin.query(
    "do $$ begin if exists(select 1 from pg_roles where rolname='hireflow_backend') then alter role hireflow_backend nobypassrls; end if; end $$",
  );
  await db.query(`create schema auth; create schema storage; create schema extensions;
    do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
    create table auth.users(id uuid primary key,email text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for (const migration of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.query(await readFile("supabase/migrations/" + migration, "utf8"));
  await db.end();
  const secret = () => randomBytes(32).toString("hex");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "tests/database.integration.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        SYNTHETIC_SQL_HARNESS: "true",
        DATABASE_URL: url.toString(),
        APP_URL: "http://127.0.0.1:3000",
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_ANON_KEY: secret(),
        SUPABASE_SERVICE_ROLE_KEY: secret(),
        N8N_WEBHOOK_BASE_URL: "http://127.0.0.1:4001",
        WEB_TO_N8N_SECRET: secret(),
        WF01_KEY: secret(),
        WF02_KEY: secret(),
        WF03_KEY: secret(),
        WF04_KEY: secret(),
        BOOKING_SIGNING_KEY: secret(),
      },
    },
  );
  exit = result.status ?? 1;
} finally {
  await db.end().catch(() => {});
  await admin.query(`drop database "${name}" with (force)`);
  await admin.end();
}
process.exitCode = exit;
