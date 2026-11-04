# HireFlow actual implementation status

Updated 2026-11-04 UTC. Started with root brief only; supplied pasted brief matches. No separate screenshot/handoff supplied.

## Actual checks

- Node22.23.4, npm10.9.9, Next16.4.5, exact dependencies+lockfile. npm audit after targeted minimatch fix: **0 vulnerabilities** (8 earlier moderate dev-tool warnings resolved).
- Typecheck, lint and production build passed before latest proxy/docs changes; final rerun pending.
- `npm test`: **12/12 passed** — HMAC/scopes/expiry/raw binary, strict inputs/evidence, PDF/DOCX rejection, byte bounds, safe Meet host, Cairo DST.
- `npm run test:postgres`: **14/14 passed** on native PostgreSQL17 with actual migration, temporary isolated DB. Minimal auth/users and storage/buckets test schemas are **not real Supabase services**. Includes submission race/replay, separate application CVs, stale forms, Gmail dedupe/assignment, immutable/stale analysis, invitation dedupe, uncertain send reconciliation, slot race, link expiry/revocation, schedule revisions/reservations, reminder cancellation, overlap exclusion, receiver outage/two-worker/lease recovery.
- Real browser: login rendered visually; recovery navigation and accessible headings/labels observed. Initial navigation timed out then loaded. **No authenticated recruiting journey completed.** No mobile/lab metrics yet.
- Full Supabase unavailable: Docker daemon access denied; elevated Docker request declined. Supabase CLI3.0.0 installed/help/version checked. No hosted service or fabricated .env.local. Real Auth/Storage, smoke and Supabase identity/API tests **not run**.

## Milestones

| Milestone | Implemented | Actual acceptance |
|---|---|---|
| 1 Foundation/first slice | Auth/recovery, jobs, validated private upload, transactional application, scoped CV, migration/bootstrap/seed | SQL passes; full Supabase/browser **blocked** |
| 2 Review/WF01 | Gmail/assignment, immutable snapshots, evidence/history, retry/reanalysis, signed endpoints/simulator/outbox | Boundary+DB passes; real HTTP simulator cycle **not run** |
| 3 Decisions/WF02 | Hold/reject/invite, atomic intent, claim/result/recovery/audit | DB passes; Gmail/full HTTP **unverified** |
| 4 Booking/WF03/04 | Signed links, atomic reservations, revision sync, reschedule/cancel/reminders | DB races/revisions pass; provider/browser **unverified** |
| 5 Quality/handoff | Validation/contract/smoke/performance/ops scripts and docs | Partial checks above; remaining acceptance below |

## Requirements to evidence

| ID | Route/test/check | Actual status |
|---|---|---|
| FR01 | /login,/recover,/api/auth/*,proxy; native membership tests; test:db suite | DB membership verified; Supabase Auth/recovery/session **not run** |
| FR02 | /jobs,/jobs/new,/jobs/[id]; saveJob; closed-form/version DB tests | DB verified; browser **blocked** |
| FR03 | /apply/[jobCode],/api/uploads,/api/applications; bounded-body/idempotency tests | Boundary+DB verified; Storage HTTP **not run** |
| FR04 | internal/attachments,intake/gmail,assign-job; Gmail DB tests | Dedupe/assignment verified; attachment HTTP/live Gmail **unverified** |
| FR05 | /candidates,/applications/[id]; context/result/retry/reanalyse | Snapshot/IDs/evidence schemas verified; populated UI **not run** |
| FR06 | hold/reject/invite,notification claim/result/recover | DB dedupe/uncertainty verified; external delivery **unverified** |
| FR07 | /book/[token],booking slots,interviews/book | DB race/replay/expiry/revocation verified; browser **not run** |
| FR08 | /interviews,sync callbacks,reminders | DB revisions/reservations/reminders verified; Calendar/Meet/sends **unverified** |
| SEC01 | RLS/grants/private bucket,no browser RPC; native role tests,test:db | Native table grants verified; real REST/Storage/Auth **blocked** |
| SEC02 | uploads.ts + unit rejection/byte tests,scanner gate | Some negatives verified; scanner **unconfigured**; positive DOCX/zip-bomb tests pending |
| SEC03 | Server secrets,private read/fresh5min URL,synthetic files | Implementation+smoke supplied; Storage access **unverified** |
| SEC04 | strict Zod,Origin,shared DB limits,no-store/security headers | Unit boundaries verified; HTTP abuse/CSRF/rate **not run** |
| SEC05 | signing.ts,scoped internal routes,stale-run tests | Unit+DB verified; real workflow HTTP **not run** |
| SEC06 | Signed versioned tokens,revocation,append-only audit,local retention | Booking/audit DB verified; cleanup **not run**, hosted audit retention/privacy unresolved |
| NFR01 | Outbox/leases/dispatcher; outage/two-worker/expired-lease test | **Verified locally SQL+HTTP receiver harness**; simulator/Supabase cycle not run |
| NFR02 | Exclusion/reservations/claims/revisions; race/reconcile tests | **DB verified locally**; external reconciliation unverified |
| NFR03 | perf:seed,perf,perf -- --public | **Not run**:100/10k,20 clients,1m+5m; targets not claimed |
| NFR04 | Bounded pool/worker,pagination,indexes | Two workers verified; large-data query plans/load **not run** |
| NFR05 | Responsive CSS,labels/focus,browser login/recovery | Partial desktop only;360px/tablet/keyboard apply+book/LCP/CLS/INP **not run** |
| NFR06 | Health/ready/operations,recovery,cleanup,backup procedure | Queue DB recovery verified; DB+objects backup restore **not run** |

## Next exact actions and external dependencies

1. Make Docker Linux engine accessible; `npm run db:start`, `npm run setup:local`, `npm run bootstrap`, `npm run seed`. Start web,worker,simulator. Docker permission was declined and has not been bypassed.
2. `npm run test:db`, `npm run smoke`, then actual browser journeys in README; fix Supabase-specific findings before accepting milestone1.
3. Production-load/query-plan checks, mobile keyboard journeys+lab metrics, synthetic DB+private-object backup/restore.
4. Operating malware scanner; owner-approved retention/privacy/audit policy and hosted cleanup job. Native SQL harness is not a Supabase/production substitute.
5. Teammate: approved test Gmail mailbox/send identity, Gemini/OCR,Calendar/Meet/free-busy/reconciliation. All real integrations **unverified**. No production publication or real-person messages sent.
