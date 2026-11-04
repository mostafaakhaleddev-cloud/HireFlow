import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
const file = ".env.local";
if (existsSync(file))
  throw new Error(
    ".env.local already exists. Preserve it; review .env.example for new names.",
  );
let data: Record<string, string>;
try {
  data = JSON.parse(
    execFileSync(
      process.execPath,
      ["node_modules/supabase/dist/supabase.js", "status", "-o", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
} catch {
  throw new Error(
    "Local Supabase is unavailable. Enable Docker and run npm run db:start, then rerun setup:local. No credentials were written.",
  );
}
if (
  !data.API_URL ||
  !["127.0.0.1", "localhost"].includes(new URL(data.API_URL).hostname)
)
  throw new Error("Refusing setup against a hosted project.");
const secret = () => randomBytes(32).toString("hex");
const values = {
  APP_URL: "http://127.0.0.1:3000",
  SUPABASE_URL: data.API_URL,
  SUPABASE_ANON_KEY: data.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: data.SERVICE_ROLE_KEY,
  DATABASE_URL:
    data.DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  INTEGRATION_MODE: "simulator",
  N8N_WEBHOOK_BASE_URL: "http://127.0.0.1:4001",
  WEB_TO_N8N_SECRET: secret(),
  WF01_KEY: secret(),
  WF02_KEY: secret(),
  WF03_KEY: secret(),
  WF04_KEY: secret(),
  BOOKING_SIGNING_KEY: secret(),
  UPLOAD_MAX_BYTES: "5242880",
  INVITATION_TTL_HOURS: "48",
  TRUST_PROXY: "false",
  ALLOW_SYNTHETIC_UNSCANNED: "true",
  BOOTSTRAP_EMAIL: "hr@example.test",
  BOOTSTRAP_PASSWORD: secret().slice(0, 24),
};
if (!values.SUPABASE_ANON_KEY || !values.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error(
    "Supabase status did not return local keys. Check CLI output format.",
  );
writeFileSync(
  file,
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Created ignored .env.local with local service keys and a random staff password. Read it locally; do not share it.",
);
