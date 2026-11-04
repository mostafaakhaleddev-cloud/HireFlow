import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { syntheticPdf } from "./fixtures";
import { assertStagingTarget } from "../src/lib/test-target";
// Preserve the operator's supplied secrets; fill only non-provider local defaults.
const file = ".env.local";
let original: string;
try {
  original = await readFile(file, "utf8");
} catch {
  throw new Error(
    "Create ignored .env.local with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL and STAGING_PROJECT_REF. Never paste credentials in chat.",
  );
}
const existing = Object.fromEntries(
  original
    .split(/\r?\n/)
    .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, "$2"),
      ];
    }),
);
const secret = () => randomBytes(32).toString("hex");
const defaults = {
  APP_URL: "http://127.0.0.1:3000",
  INTEGRATION_MODE: "simulator",
  STAGING_SYNTHETIC_ONLY: "true",
  N8N_WEBHOOK_BASE_URL: "http://127.0.0.1:4001",
  WEB_TO_N8N_SECRET: secret(),
  WF01_KEY: secret(),
  WF02_KEY: secret(),
  WF03_KEY: secret(),
  WF04_KEY: secret(),
  BOOKING_SIGNING_KEY: secret(),
  TRUST_PROXY: "false",
  UPLOAD_MAX_BYTES: "5242880",
  INVITATION_TTL_HOURS: "48",
  BOOTSTRAP_EMAIL: "hr-staging@example.test",
  BOOTSTRAP_PASSWORD: secret().slice(0, 24),
};
const additions = Object.entries(defaults).filter(([key]) => !existing[key]);
const values = {
  ...Object.fromEntries(additions),
  ...Object.fromEntries(Object.entries(existing).filter(([, v]) => v)),
};
for (const name of [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "STAGING_PROJECT_REF",
])
  if (!values[name])
    throw new Error("Missing " + name + " in ignored .env.local.");
assertStagingTarget(
  values as unknown as Parameters<typeof assertStagingTarget>[0],
);
await writeFile(
  file,
  original.replace(/\s*$/, "") +
    "\n" +
    additions.map(([k, v]) => `${k}=${v}`).join("\n") +
    "\n",
  { mode: 0o600 },
);
await mkdir("test-results", { recursive: true });
for (const [name, label] of [
  ["synthetic-cv-v1.pdf", "Backend CV v1"],
  ["synthetic-cv-v2.pdf", "Frontend CV v2"],
  ["synthetic-email-cv.pdf", "Email CV"],
])
  await writeFile("test-results/" + name, syntheticPdf(label));
console.log(
  "Staging target matched. Generated local integration secrets/test password and three synthetic PDF fixtures without printing values. No network calls or database changes performed.",
);
