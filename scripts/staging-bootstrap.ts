import { createClient } from "@supabase/supabase-js";
import { config } from "../src/lib/config";
import { assertStagingTarget } from "../src/lib/test-target";
import { transaction, pool, audit } from "../src/lib/db";
import { randomUUID } from "node:crypto";
const c = config(),
  ref = assertStagingTarget(c),
  email = process.env.BOOTSTRAP_EMAIL,
  password = process.env.BOOTSTRAP_PASSWORD;
if (!email?.endsWith("@example.test") || !password || password.length < 16)
  throw new Error(
    "Staging bootstrap requires synthetic BOOTSTRAP_EMAIL and a random BOOTSTRAP_PASSWORD (16+ chars).",
  );
const auth = createClient(c.SUPABASE_URL, c.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
let created: string | undefined;
try {
  // Auth owns identity lookup. A restricted runtime DB role must not read auth.users.
  // createUser rejects existing email; never reset a password or promote an existing user.
  const result = await auth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { hireflow_test_project: ref, synthetic: true },
  });
  if (result.error || !result.data.user)
    throw new Error("Staging synthetic Auth user could not be created.");
  created = result.data.user.id;
  await transaction(async (db) => {
    await db.query(
      "insert into staff(id,display_name,role,calendar_id) values($1,'Staging Test Admin','admin','synthetic-calendar@example.test')",
      [created],
    );
    await audit(
      db,
      "staging-operator",
      "staff.synthetic_bootstrap",
      created!,
      randomUUID(),
      { project_ref: ref },
    );
  });
  console.log(
    "Staging synthetic admin created without email. Use BOOTSTRAP_EMAIL/PASSWORD from ignored .env.local.",
  );
} catch {
  if (created) await auth.auth.admin.deleteUser(created);
  console.error(
    "STAGING_BOOTSTRAP_FAILED: existing account or unavailable Auth/membership; no existing user was modified.",
  );
  process.exitCode = 1;
} finally {
  await pool().end();
}
