import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { config } from "../src/lib/config";
import { assertStagingTarget } from "../src/lib/test-target";
import { query, pool } from "../src/lib/db";
import { storageClient } from "../src/lib/auth";
import {
  saveJob,
  submitApplication,
  applicationAction,
} from "../src/lib/domain";
import { saveUpload } from "../src/lib/uploads";
import { internal } from "./client";
import { syntheticPdf, syntheticAnalysis } from "./fixtures";
const c = config();
assertStagingTarget(c);
const login = await storageClient().auth.signInWithPassword({
  email: process.env.BOOTSTRAP_EMAIL!,
  password: process.env.BOOTSTRAP_PASSWORD!,
});
assert.equal(login.error, null);
const actor = login.data.user!.id;
const code = "JOB-RETRY-" + String(Date.now()).slice(-6),
  requestId = randomUUID;
const job = {
  job_code: code,
  title: "Synthetic retry regression",
  description: "Synthetic retry stale callback verification.",
  required_skills: ["TypeScript"],
  preferred_skills: [],
  minimum_years: 0,
  status: "open" as const,
};
const j = await saveJob(actor, job, requestId());
const file = await saveUpload(
  syntheticPdf("Backend CV v1"),
  "synthetic.pdf",
  "application/pdf",
  "public",
  code,
);
const receipt = await submitApplication(
  {
    job_code: code,
    name: "Synthetic Retry",
    email: "retry@example.test",
    consent: true,
    privacy_version: "2026-11-v1",
    upload_handle: file.upload_handle,
    idempotency_key: randomUUID(),
  },
  requestId(),
);
const app = (
  await query("select * from applications where receipt=$1", [receipt.receipt])
).rows[0];
const old = (
  await query("select * from analysis_runs where id=$1", [app.active_run_id])
).rows[0];
const failed = {
  schema_version: 1,
  event_id: old.event_id,
  application_id: app.id,
  analysis_run_id: old.id,
  requirements_version: 1,
  outcome: "failed_retryable",
  error_code: "PROVIDER_TIMEOUT",
};
await internal(
  `/api/internal/applications/${app.id}/analysis-result`,
  "wf01",
  failed,
);
await saveJob(
  actor,
  { ...job, required_skills: ["PostgreSQL"] },
  requestId(),
  j.id,
);
await applicationAction(actor, app.id, "retry-analysis", {}, requestId());
let staleStatus = 200;
try {
  await internal(
    `/api/internal/applications/${app.id}/analysis-result`,
    "wf01",
    failed,
  );
} catch (e) {
  staleStatus = (e as { status: number }).status;
}
const current = (
  await query(
    "select r.* from analysis_runs r join applications a on a.active_run_id=r.id where a.id=$1",
    [app.id],
  )
).rows[0];
const report = {
  stale_callback_status: staleStatus,
  new_attempt_identity: current.id !== old.id,
  same_snapshot:
    JSON.stringify(current.job_snapshot) === JSON.stringify(old.job_snapshot),
  old_result_retained:
    (await query("select result_hash from analysis_runs where id=$1", [old.id]))
      .rows[0].result_hash !== null,
};
await writeFile(
  "test-results/review-analysis-retry.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
if (!process.argv.includes("--reproduce")) {
  assert.equal(staleStatus, 409);
  assert.notEqual(current.id, old.id);
  assert.deepEqual(current.job_snapshot, old.job_snapshot);
  assert.ok(report.old_result_retained);
  await internal(
    `/api/internal/applications/${app.id}/analysis-result`,
    "wf01",
    {
      schema_version: 1,
      event_id: current.event_id,
      application_id: app.id,
      analysis_run_id: current.id,
      requirements_version: 1,
      outcome: "completed",
      analysis: syntheticAnalysis(current.job_snapshot),
    },
  );
}
await pool().end();
