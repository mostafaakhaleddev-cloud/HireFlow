import { randomUUID } from "node:crypto";
import { config, isLoopback } from "../src/lib/config";
import { query, pool } from "../src/lib/db";
import { saveJob, submitApplication } from "../src/lib/domain";
import { saveUpload } from "../src/lib/uploads";
import { syntheticPdf } from "./fixtures";
const c = config();
if (!isLoopback(c.APP_URL) || !isLoopback(c.SUPABASE_URL))
  throw new Error("Performance seed is local synthetic-only.");
const actor = (
  await query(
    "select id from staff where active=true and role='admin' order by created_at limit 1",
  )
).rows[0]?.id;
if (!actor) throw new Error("Run bootstrap first.");
for (let i = 1; i <= 100; i++) {
  const code = "JOB-PERF-" + String(i).padStart(3, "0");
  if (!(await query("select id from jobs where job_code=$1", [code])).rowCount)
    await saveJob(
      actor,
      {
        job_code: code,
        title: "Synthetic Performance Role " + i,
        description:
          "Synthetic performance dataset for local benchmark verification only.",
        required_skills: ["ASP.NET Core"],
        preferred_skills: ["Docker"],
        minimum_years: 2,
        status: "open",
      },
      randomUUID(),
    );
}
let next = 0;
async function seed() {
  while (next < 10000) {
    const i = next++,
      key = `01900001-0000-4000-8000-${String(i).padStart(12, "0")}`;
    if (
      (
        await query("select id from applications where submission_key=$1", [
          key,
        ])
      ).rowCount
    )
      continue;
    const code = "JOB-PERF-" + String((i % 100) + 1).padStart(3, "0"),
      file = await saveUpload(
        syntheticPdf("Performance CV " + i),
        "synthetic-performance.pdf",
        "application/pdf",
        "public",
        code,
      );
    await submitApplication(
      {
        job_code: code,
        name: "Synthetic Perf Candidate " + i,
        email: `perf-${i}@example.test`,
        phone: "",
        consent: true,
        privacy_version: "2026-11-v1",
        upload_handle: file.upload_handle,
        idempotency_key: key,
      },
      randomUUID(),
    );
    if (i % 500 === 0) console.log(JSON.stringify({ seeded_up_to: i }));
  }
}
await Promise.all(Array.from({ length: 4 }, seed));
console.log(
  "Seeded 100 performance jobs and 10,000 synthetic applications with real private objects. Stop the worker while benchmarking queue-independent web paths.",
);
await pool().end();
