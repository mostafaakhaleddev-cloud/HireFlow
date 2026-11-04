import { cpus, platform, arch, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createServerClient } from "@supabase/ssr";
import { config, isLoopback } from "../src/lib/config";
import { syntheticPdf } from "./fixtures";
const c = config();
if (!isLoopback(c.APP_URL) || !isLoopback(c.SUPABASE_URL))
  throw new Error("Benchmark is local synthetic-only.");
const workload = process.argv.includes("--public") ? "public" : "staff",
  warmupMs = 60000,
  measureMs = 300000,
  concurrency = 20;
const jar = new Map<string, string>(),
  auth = createServerClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) => items.forEach((i) => jar.set(i.name, i.value)),
    },
  });
const login = await auth.auth.signInWithPassword({
  email: process.env.BOOTSTRAP_EMAIL || "",
  password: process.env.BOOTSTRAP_PASSWORD || "",
});
if (login.error) throw new Error("Benchmark needs provisioned local staff.");
const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  samples: number[] = [],
  uploadTimes: number[] = [],
  statuses: Record<string, number> = {};
const bytes = new Uint8Array(syntheticPdf("Synthetic benchmark")),
  start = performance.now();
let sequence = 0;
const stats = (a: number[]) => {
  a.sort((x, y) => x - y);
  return {
    n: a.length,
    p50_ms: a.length
      ? Number(a[Math.floor((a.length - 1) * 0.5)].toFixed(2))
      : null,
    p95_ms: a.length
      ? Number(a[Math.floor((a.length - 1) * 0.95)].toFixed(2))
      : null,
  };
};
async function client() {
  while (performance.now() - start < warmupMs + measureMs) {
    let response: Response;
    let elapsed = 0;
    const measured = performance.now() - start >= warmupMs;
    try {
      if (workload === "staff") {
        const path =
          sequence++ % 2
            ? "/jobs?status=open"
            : "/candidates?q=Synthetic&source=form";
        const t = performance.now();
        response = await fetch(c.APP_URL + path, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(10000),
        });
        await response.arrayBuffer();
        elapsed = performance.now() - t;
      } else {
        const t = performance.now(),
          upload = await fetch(
            c.APP_URL + "/api/uploads?job_code=JOB-PERF-001",
            {
              method: "POST",
              headers: {
                Origin: c.APP_URL,
                "Content-Type": "application/pdf",
                "X-File-Name": "synthetic-benchmark.pdf",
              },
              body: bytes,
              signal: AbortSignal.timeout(20000),
            },
          ),
          file = await upload.json();
        if (measured) uploadTimes.push(performance.now() - t);
        if (!upload.ok) {
          if (measured)
            statuses["upload_" + upload.status] =
              (statuses["upload_" + upload.status] || 0) + 1;
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const finalize = performance.now();
        response = await fetch(c.APP_URL + "/api/applications", {
          method: "POST",
          headers: { Origin: c.APP_URL, "Content-Type": "application/json" },
          body: JSON.stringify({
            job_code: "JOB-PERF-001",
            name: "Synthetic Benchmark",
            email: "benchmark@example.test",
            phone: "",
            consent: true,
            privacy_version: "2026-11-v1",
            upload_handle: file.upload_handle,
            idempotency_key: randomUUID(),
          }),
          signal: AbortSignal.timeout(10000),
        });
        await response.arrayBuffer();
        elapsed = performance.now() - finalize;
      }
      if (measured) {
        statuses[String(response.status)] =
          (statuses[String(response.status)] || 0) + 1;
        if (response.ok) samples.push(elapsed);
      }
      if (response.status === 429)
        await new Promise((r) => setTimeout(r, 1000));
    } catch {
      if (measured)
        statuses.transport_error = (statuses.transport_error || 0) + 1;
    }
  }
}
console.log(
  `Running ${workload}: 20 clients, 60 seconds warm-up, 300 seconds measured. Rate limits remain enabled.`,
);
await Promise.all(Array.from({ length: concurrency }, client));
const total = Object.values(statuses).reduce((a, b) => a + b, 0),
  unexpected = Object.entries(statuses)
    .filter(([key]) => /^5\d\d$/.test(key) || key === "transport_error")
    .reduce((a, [, v]) => a + v, 0);
const report = {
  recorded_at: new Date().toISOString(),
  workload,
  build:
    "Run against npm run build + npm start; operator must confirm production server",
  machine: {
    os: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logical_cpus: cpus().length,
    memory_gib: Math.round(totalmem() / 2 ** 30),
    region: "local",
  },
  dataset: {
    jobs: 100,
    applications: 10000,
    verified_by:
      "Run perf:seed and record actual counts before reporting objectives",
  },
  concurrency,
  warmup_seconds: 60,
  measured_seconds: 300,
  actual_total_seconds: (performance.now() - start) / 1000,
  statuses,
  success_latency: stats(samples),
  file_transfer_and_validation: stats(uploadTimes),
  unexpected_error_rate: total ? unexpected / total : null,
  rate_limits_enabled: true,
  cold_start: "not measured",
  external_provider_latency: "excluded; providers not exercised",
  objective_met:
    samples.length > 0 &&
    stats(samples).p95_ms! <= (workload === "staff" ? 500 : 1000) &&
    unexpected / Math.max(total, 1) < 0.01,
};
await mkdir("test-results", { recursive: true });
await writeFile(
  `test-results/performance-${workload}.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
