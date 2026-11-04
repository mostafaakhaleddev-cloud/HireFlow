import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { config } from "../src/lib/config";
import { pool, audit } from "../src/lib/db";
import { staffTransaction } from "../src/lib/auth";
const c = config(),
  [email, name, role] = process.argv.slice(2);
const input = z
  .object({
    email: z.email().max(254),
    name: z.string().min(2).max(120),
    role: z.enum(["hr", "admin"]),
  })
  .strict()
  .parse({ email, name, role });
const auth = createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const login = await auth.auth.signInWithPassword({
  email: process.env.PROVISION_ADMIN_EMAIL || "",
  password: process.env.PROVISION_ADMIN_PASSWORD || "",
});
if (login.error || !login.data.user)
  throw new Error(
    "Provisioning requires a valid active admin sign-in, not just a service key.",
  );
const service = createClient(c.SUPABASE_URL, c.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
let createdId: string | undefined;
try {
  const invitation = await staffTransaction(
    login.data.user.id,
    async (db) => {
      // generateLink creates the Auth invitation but sends no email.
      const result = await service.auth.admin.generateLink({
        type: "invite",
        email: input.email,
      });
      if (result.error || !result.data.user)
        throw new Error(
          "Could not create staff invitation. Existing users must be managed explicitly.",
        );
      createdId = result.data.user.id;
      await db.query(
        "insert into staff(id,display_name,role) values($1,$2,$3)",
        [createdId, input.name, input.role],
      );
      await audit(
        db,
        login.data.user!.id,
        "staff.provisioned",
        createdId,
        randomUUID(),
        { role: input.role },
      );
      return {
        id: createdId,
        link:
          c.APP_URL +
          "/auth/callback?type=invite&token_hash=" +
          encodeURIComponent(result.data.properties.hashed_token),
      };
    },
    true,
  );
  await mkdir("test-results", { recursive: true });
  const file = "test-results/staff-invite-" + invitation.id + ".json";
  await writeFile(
    file,
    JSON.stringify(
      { staff_id: invitation.id, invitation_url: invitation.link },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Staff provisioned. Invitation saved in ignored " +
      file +
      ". Deliver through an approved private channel; no email was sent.",
  );
} catch (error) {
  // A failed membership transaction leaves no staff access; remove the new Auth record if possible.
  // If the file write failed after commit, preserve the active member and ask operator to regenerate a link.
  if (createdId) {
    const { rows } = await pool().query("select id from staff where id=$1", [
      createdId,
    ]);
    if (!rows.length) await service.auth.admin.deleteUser(createdId);
  }
  throw error;
} finally {
  await auth.auth.signOut();
  await pool().end();
}
