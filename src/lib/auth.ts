import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { config } from "./config";
import { query, transaction } from "./db";
import { AppError } from "./errors";
import type { PoolClient } from "pg";
export type Staff = {
  id: string;
  display_name: string;
  role: "hr" | "admin";
  active: boolean;
  calendar_id: string | null;
};
export async function authClient() {
  const jar = await cookies(),
    c = config();
  return createServerClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) =>
            jar.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: new URL(c.APP_URL).protocol === "https:",
            }),
          );
        } catch {
          /* Server Components cannot persist cookie refreshes. */
        }
      },
    },
  });
}
export function storageClient() {
  const c = config();
  return createClient(c.SUPABASE_URL, c.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function requireStaff(admin = false): Promise<Staff> {
  const supabase = await authClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user)
    throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
  const staff = (
    await query<Staff>(
      "select id,display_name,role,active,calendar_id from staff where id=$1 and active=true",
      [user.id],
    )
  ).rows[0];
  if (!staff || (admin && staff.role !== "admin"))
    throw new AppError(
      "FORBIDDEN",
      "An active staff membership is required.",
      403,
    );
  return staff;
}
export async function staffTransaction<T>(
  actor: string,
  fn: (db: PoolClient, staff: Staff) => Promise<T>,
  admin = false,
) {
  return transaction(async (db) => {
    const staff = (
      await db.query<Staff>(
        "select * from staff where id=$1 and active=true for share",
        [actor],
      )
    ).rows[0];
    if (!staff || (admin && staff.role !== "admin"))
      throw new AppError(
        "FORBIDDEN",
        "An active staff membership is required.",
        403,
      );
    return fn(db, staff);
  });
}
