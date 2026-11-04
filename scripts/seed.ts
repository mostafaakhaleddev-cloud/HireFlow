import { randomUUID } from "node:crypto";
import { config, isLoopback } from "../src/lib/config";
import { query, pool } from "../src/lib/db";
import { saveJob, submitApplication, gmailIntake } from "../src/lib/domain";
import { publishSlot } from "../src/lib/scheduling";
import { saveUpload } from "../src/lib/uploads";
import { syntheticPdf } from "./fixtures";
const c = config();
if (!isLoopback(c.SUPABASE_URL) || !isLoopback(c.APP_URL))
  throw new Error("Synthetic seed is local-only.");
const staff = (
  await query(
    "select id from staff where role='admin' and active=true order by created_at limit 1",
  )
).rows[0];
if (!staff) throw new Error("Run npm run bootstrap first.");
const jobs = [
  {
    job_code: "JOB-BE-001",
    title: "Backend Engineer",
    description:
      "Build dependable APIs for a thoughtful software product. Work with our engineering team on maintainable services and reliable delivery.",
    required_skills: ["ASP.NET Core"],
    preferred_skills: ["Docker"],
    minimum_years: 2,
    status: "open" as const,
  },
  {
    job_code: "JOB-FE-001",
    title: "Frontend Engineer",
    description:
      "Create accessible and responsive interfaces for our software products. Collaborate on thoughtful interactions and usable design systems.",
    required_skills: ["React", "TypeScript"],
    preferred_skills: ["Testing Library"],
    minimum_years: 1,
    status: "open" as const,
  },
];
for (const job of jobs) {
  const exists = (
    await query("select id from jobs where job_code=$1", [job.job_code])
  ).rows[0];
  if (!exists) await saveJob(staff.id, job, randomUUID());
}
const keys = [
  "01900000-0000-4000-8000-000000000011",
  "01900000-0000-4000-8000-000000000012",
];
for (const [i, job] of jobs.entries()) {
  if (
    (
      await query("select id from applications where submission_key=$1", [
        keys[i],
      ])
    ).rowCount
  )
    continue;
  const handle = await saveUpload(
    syntheticPdf(i ? "Frontend CV v2" : "Backend CV v1"),
    "synthetic-cv-v" + (i + 1) + ".pdf",
    "application/pdf",
    "public",
    job.job_code,
  );
  await submitApplication(
    {
      job_code: job.job_code,
      name: "Synthetic Example Candidate",
      email: "candidate@example.test",
      phone: "",
      consent: true,
      privacy_version: "2026-11-v1",
      upload_handle: handle.upload_handle,
      idempotency_key: keys[i],
    },
    randomUUID(),
  );
}
const external = {
  mailbox_id: "synthetic-mailbox",
  message_id: "seed-unmatched-001",
  attachment_id: "cv-1",
};
const { digest } = await import("../src/lib/signing");
if (
  !(
    await query("select id from applications where source_external_id=$1", [
      digest(JSON.stringify(Object.values(external))),
    ])
  ).rowCount
) {
  const file = await saveUpload(
    syntheticPdf("Email CV"),
    "synthetic-email-cv.pdf",
    "application/pdf",
    "gmail",
  );
  await gmailIntake(
    {
      schema_version: 1,
      ...external,
      subject: "Application — please assign a role",
      candidate_name: "Synthetic Email Applicant",
      candidate_email: "email-applicant@example.test",
      contact_ambiguous: false,
      upload_handle: file.upload_handle,
    },
    randomUUID(),
  );
}
if (
  !(
    await query(
      "select id from interviewer_slots where interviewer_id=$1 and starts_at>now() limit 1",
      [staff.id],
    )
  ).rowCount
) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 3);
  start.setUTCHours(10, 0, 0, 0);
  for (let i = 0; i < 4; i++)
    await publishSlot(
      staff.id,
      {
        interviewer_id: staff.id,
        starts_at: new Date(start.getTime() + i * 3600000).toISOString(),
        timezone: "Africa/Cairo",
      },
      randomUUID(),
    );
}
console.log(
  "Synthetic demo ready: two jobs, two distinct CV applications for one candidate, an unmatched Gmail item, future slots.",
);
await pool().end();
