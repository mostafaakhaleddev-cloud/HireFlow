import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { config, isLoopback } from "../src/lib/config";
import { query, pool } from "../src/lib/db";
import { signBooking } from "../src/lib/signing";
import { dispatchBatch } from "../src/lib/dispatcher";
import { attachment, internal } from "./client";
import { syntheticPdf } from "./fixtures";
import { assertSyntheticTestTarget } from "../src/lib/test-target";
const c = config();
assertSyntheticTestTarget(c);
if (!isLoopback(c.APP_URL) || c.INTEGRATION_MODE !== "simulator")
  throw new Error("Smoke is local synthetic-only.");
const cookies = new Map<string, string>();
const auth = createServerClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
  cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach((i) => cookies.set(i.name, i.value)),
  },
});
const { data, error } = await auth.auth.signInWithPassword({
  email: process.env.BOOTSTRAP_EMAIL || "",
  password: process.env.BOOTSTRAP_PASSWORD || "",
});
assert.equal(error, null, "Local staff sign-in must succeed");
assert.ok(data.user);
const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
async function waitForState(sql:string,id:string,column:string,expected:string){
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){await dispatchBatch();const row=(await query(sql,[id])).rows[0];if(row?.[column]===expected)return;await new Promise(r=>setTimeout(r,800));}
  throw new Error('Timed out waiting for '+expected+'; inspect operations queue.');
}
async function post(path: string, body: unknown, staff = false) {
  const res = await fetch(c.APP_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: c.APP_URL,
      ...(staff ? { Cookie: cookie() } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  assert.ok(res.ok, `${path}: ${res.status} ${result.error?.code || ""}`);
  return result;
}
const code = "JOB-SMOKE-" + String(Date.now()).slice(-6);
const job = await post(
  "/api/jobs",
  {
    job_code: code,
    title: "Synthetic Smoke Backend Engineer",
    description:
      "Synthetic integration smoke role, for local verification only.",
    required_skills: ["ASP.NET Core"],
    preferred_skills: ["Docker"],
    minimum_years: 2,
    status: "open",
  },
  true,
);
const bytes = syntheticPdf(
  c.STAGING_SYNTHETIC_ONLY === "true" ? "Backend CV v1" : "Smoke CV " + code,
);
const uploadResponse = await fetch(
  c.APP_URL + "/api/uploads?job_code=" + code,
  {
    method: "POST",
    headers: {
      Origin: c.APP_URL,
      "Content-Type": "application/pdf",
      "X-File-Name": "synthetic-smoke.pdf",
    },
    body: new Uint8Array(bytes),
  },
);
assert.equal(uploadResponse.status, 201);
const upload = await uploadResponse.json();
const submission = {
  job_code: code,
  name: "Synthetic Smoke Applicant",
  email: "smoke@example.test",
  phone: "",
  consent: true,
  privacy_version: "2026-11-v1",
  upload_handle: upload.upload_handle,
  idempotency_key: randomUUID(),
};
const receipt = await post("/api/applications", submission),
  replay = await post("/api/applications", submission);
assert.equal(receipt.receipt, replay.receipt);
const app = (
  await query("select id from applications where receipt=$1", [receipt.receipt])
).rows[0];
const download = await fetch(c.APP_URL + `/api/applications/${app.id}/cv`, {
  headers: { Cookie: cookie() },
});
assert.ok(download.ok);
assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
const unauthorized = await fetch(c.APP_URL + `/api/applications/${app.id}/cv`);
assert.equal(unauthorized.status, 401);
await waitForState('select processing_status from applications where id=$1',app.id,'processing_status','completed');
await post(
  `/api/applications/${app.id}/invite`,
  { interviewer_id: data.user.id, reason: "Synthetic human review completed." },
  true,
);
await post(
  `/api/applications/${app.id}/invite`,
  { interviewer_id: data.user.id, reason: "Synthetic human review completed." },
  true,
);
await dispatchBatch();
const inv = (
  await query(
    "select id,version from invitations where application_id=$1 and revoked_at is null",
    [app.id],
  )
).rows[0];
const token = signBooking(
  { id: inv.id, version: inv.version },
  c.BOOKING_SIGNING_KEY,
);
const slot = await post(
  "/api/slots",
  {
    interviewer_id: data.user.id,
    starts_at: new Date(
      Date.now() + 4 * 86400000 + Math.floor(Math.random() * 1000) * 3600000,
    ).toISOString(),
    timezone: "Africa/Cairo",
  },
  true,
);
const slots = await fetch(c.APP_URL + "/api/booking/" + token + "/slots");
assert.equal(slots.status, 200);
const booking = { token, slot_id: slot.id, idempotency_key: randomUUID() };
const booked = await post("/api/interviews/book", booking);
assert.equal(booked.status, "calendar_pending");
assert.equal(
  (await post("/api/interviews/book", booking)).receipt,
  booked.receipt,
);
await waitForState('select state from interviews where application_id=$1',app.id,'state','confirmed');
const handle = await attachment(
  syntheticPdf(
    c.STAGING_SYNTHETIC_ONLY === "true" ? "Email CV" : "Unmatched smoke",
  ),
);
const intake = {
  schema_version: 1,
  mailbox_id: "smoke",
  message_id: randomUUID(),
  attachment_id: "one",
  subject: "No job code",
  candidate_name: "Synthetic Email Applicant",
  candidate_email: "email-smoke@example.test",
  contact_ambiguous: false,
  upload_handle: handle,
};
const email = await internal("/api/internal/intake/gmail", "wf01", intake);
assert.equal(
  (await internal("/api/internal/intake/gmail", "wf01", intake)).application_id,
  email.application_id,
);
await post(
  `/api/applications/${email.application_id}/assign-job`,
  { job_id: job.id },
  true,
);
await waitForState('select processing_status from applications where id=$1',email.application_id,'processing_status','completed');
console.log(
  JSON.stringify({
    status: "passed",
    checks: [
      "real local Supabase sign-in",
      "job via HTTP",
      "private upload/download byte identity",
      "public idempotent submission",
      "unsigned CV denied",
      "signed simulator analysis",
      "idempotent human invitation",
      "atomic booking receipt",
      "simulated Calendar confirmation",
      "deduplicated unmatched Gmail assignment",
    ],
    synthetic_providers: true,
    job_code: code,
  }),
);
await pool().end();
