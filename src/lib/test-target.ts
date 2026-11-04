import { config, isLoopback } from "./config";
export type Target = {
  APP_URL: string;
  SUPABASE_URL: string;
  DATABASE_URL: string;
  INTEGRATION_MODE: string;
  STAGING_PROJECT_REF?: string;
  STAGING_SYNTHETIC_ONLY: string;
};
export function verifyDatabaseTarget(connection: string, ref: string) {
  let url: URL;
  try {
    url = new URL(connection);
  } catch {
    throw new Error("Invalid database URL; value redacted.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Expected PostgreSQL URL.");
  const direct = url.hostname === `db.${ref}.supabase.co`;
  const session =
    url.hostname.endsWith(".pooler.supabase.com") &&
    decodeURIComponent(url.username).endsWith("." + ref);
  if (!direct && !session)
    throw new Error(
      "Database endpoint does not bind to STAGING_PROJECT_REF. Use the project direct or session-pooler URL.",
    );
  if (url.port === "6543")
    throw new Error(
      "Use direct or session pooler, not transaction pooler, for staging verification.",
    );
  if (url.searchParams.get("sslmode") !== "verify-full")
    throw new Error(
      "Hosted DATABASE_URL requires sslmode=verify-full (and sslrootcert if required by the project CA).",
    );
  for (const name of [
    "host",
    "hostaddr",
    "port",
    "user",
    "password",
    "dbname",
    "ssl",
    "uselibpqcompat",
  ])
    if (url.searchParams.has(name))
      throw new Error("Database URL query overrides are not allowed: " + name);
  return url;
}
export function assertStagingTarget(c: Target) {
  if (
    !c.STAGING_PROJECT_REF ||
    c.STAGING_SYNTHETIC_ONLY !== "true" ||
    c.INTEGRATION_MODE !== "simulator"
  )
    throw new Error(
      "Staging test commands require STAGING_PROJECT_REF, STAGING_SYNTHETIC_ONLY=true and INTEGRATION_MODE=simulator.",
    );
  if (!isLoopback(c.APP_URL))
    throw new Error(
      "This staging verification path keeps the web and simulator on loopback.",
    );
  if (
    new URL(c.SUPABASE_URL).origin !==
    `https://${c.STAGING_PROJECT_REF}.supabase.co`
  )
    throw new Error(
      "SUPABASE_URL does not match the explicitly selected staging project.",
    );
  verifyDatabaseTarget(c.DATABASE_URL, c.STAGING_PROJECT_REF);
  return c.STAGING_PROJECT_REF;
}
export function assertSyntheticTestTarget(c = config()) {
  if (
    isLoopback(c.APP_URL) &&
    isLoopback(c.SUPABASE_URL) &&
    isLoopback(c.DATABASE_URL) &&
    c.INTEGRATION_MODE === "simulator"
  )
    return "local";
  return assertStagingTarget(c);
}
