import { z } from "zod";

const schema = z.object({
  APP_URL: z.url(),
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  DATABASE_URL: z.url().regex(/^postgres(ql)?:\/\//),
  INTEGRATION_MODE: z.enum(["simulator", "live"]).default("simulator"),
  N8N_WEBHOOK_BASE_URL: z.url(),
  WEB_TO_N8N_SECRET: z.string().min(32),
  WF01_KEY: z.string().min(32),
  WF02_KEY: z.string().min(32),
  WF03_KEY: z.string().min(32),
  WF04_KEY: z.string().min(32),
  BOOKING_SIGNING_KEY: z.string().min(32),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(5 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  ALLOW_SYNTHETIC_UNSCANNED: z.enum(["true", "false"]).default("false"),
  SCANNER_URL: z.url().optional(),
  SCANNER_TOKEN: z.string().min(32).optional(),
  STAGING_PROJECT_REF: z
    .string()
    .regex(/^[a-z0-9]{20}$/)
    .optional(),
  STAGING_SYNTHETIC_ONLY: z.enum(["true", "false"]).default("false"),
});
export function isLoopback(url: string) {
  return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
}
let cached: z.infer<typeof schema> | undefined;
export function parseConfig(environment: Record<string, string | undefined>) {
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(environment).filter(([, v]) => v !== "")),
  );
  if (!parsed.success)
    throw new Error(
      "Configuration missing or invalid: " +
        [
          ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
        ].join(", ") +
        ". See .env.example; never log values.",
    );
  const c = parsed.data;
  if (c.SCANNER_URL && !c.SCANNER_TOKEN)
    throw new Error(
      "Configuration missing or invalid: SCANNER_TOKEN. See .env.example; never log values.",
    );
  for (const value of [
    c.APP_URL,
    c.N8N_WEBHOOK_BASE_URL,
    c.SUPABASE_URL,
    ...(c.SCANNER_URL ? [c.SCANNER_URL] : []),
  ]) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("Service URLs require HTTP(S).");
    if (url.username || url.password || url.hash)
      throw new Error("Service URLs cannot contain credentials or fragments.");
    if (!isLoopback(value) && url.protocol !== "https:")
      throw new Error("Hosted services require HTTPS.");
  }
  if (
    c.ALLOW_SYNTHETIC_UNSCANNED === "true" &&
    (!isLoopback(c.APP_URL) ||
      !isLoopback(c.SUPABASE_URL) ||
      c.INTEGRATION_MODE !== "simulator")
  )
    throw new Error(
      "Unscanned mode requires loopback web/Supabase and synthetic simulator mode.",
    );
  return c;
}
export function config() {
  return (cached ??= parseConfig(process.env));
}
export function configured() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}
