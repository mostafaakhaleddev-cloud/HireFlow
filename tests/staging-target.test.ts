import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertStagingTarget,
  assertSyntheticTestTarget,
  verifyDatabaseTarget,
} from "../src/lib/test-target";
import { parseConfig } from "../src/lib/config";
const ref = "abcdefghijklmnopqrst";
const target = {
  APP_URL: "http://127.0.0.1:3000",
  SUPABASE_URL: `https://${ref}.supabase.co`,
  DATABASE_URL: `postgresql://hireflow_web:synthetic-secret@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`,
  INTEGRATION_MODE: "simulator",
  STAGING_PROJECT_REF: ref,
  STAGING_SYNTHETIC_ONLY: "true",
};
test("staging test target binds both HTTP and database to the selected project", () => {
  assert.equal(assertStagingTarget(target), ref);
  assert.equal(
    verifyDatabaseTarget(
      `postgresql://hireflow_web.${ref}:synthetic@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
      ref,
    ).port,
    "5432",
  );
  for (const variant of [
    { ...target, STAGING_PROJECT_REF: "12345678901234567890" },
    { ...target, SUPABASE_URL: "https://other.supabase.co" },
    { ...target, STAGING_SYNTHETIC_ONLY: "false" },
    { ...target, APP_URL: "https://public.example" },
    { ...target, INTEGRATION_MODE: "live" },
  ])
    assert.throws(() => assertStagingTarget(variant));
});
test("staging database verification rejects wrong project, disabled TLS, transaction pooler and URL overrides", () => {
  for (const url of [
    target.DATABASE_URL.replace("verify-full", "disable"),
    target.DATABASE_URL.replace(ref, "12345678901234567890"),
    target.DATABASE_URL.replace(":5432", ":6543"),
    target.DATABASE_URL + "&host=evil.example",
    target.DATABASE_URL + "&uselibpqcompat=true",
  ])
    assert.throws(() => verifyDatabaseTarget(url, ref));
});
test("configuration diagnostics expose field names without secret values", () => {
  const secret = "never-print-this-secret";
  assert.throws(
    () =>
      parseConfig({
        SUPABASE_SERVICE_ROLE_KEY: secret,
        DATABASE_URL: "invalid-" + secret,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("DATABASE_URL"));
      assert.ok(error.message.includes("SUPABASE_URL"));
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});
test("local synthetic target does not grant access to an unselected hosted project", () => {
  const environment = {
    ...target,
    SUPABASE_ANON_KEY: "synthetic-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    N8N_WEBHOOK_BASE_URL: "http://127.0.0.1:4001",
    WEB_TO_N8N_SECRET: "a".repeat(64),
    WF01_KEY: "b".repeat(64),
    WF02_KEY: "c".repeat(64),
    WF03_KEY: "d".repeat(64),
    WF04_KEY: "e".repeat(64),
    BOOKING_SIGNING_KEY: "f".repeat(64),
  };
  const parsed = parseConfig(environment);
  assert.equal(assertSyntheticTestTarget(parsed), ref);
  assert.throws(() =>
    parseConfig({ ...environment, ALLOW_SYNTHETIC_UNSCANNED: "true" }),
  );
  assert.throws(() =>
    assertSyntheticTestTarget(
      parseConfig({
        ...environment,
        STAGING_SYNTHETIC_ONLY: "false",
        STAGING_PROJECT_REF: undefined,
      }),
    ),
  );
});
