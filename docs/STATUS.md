# HireFlow actual implementation status

Updated 2026-11-04 UTC. Started with root brief only; supplied pasted brief matches. No separate screenshot/handoff supplied.

## Actual checks

Final native PostgreSQL rerun: **15/15 passed with `hireflow_backend.rolbypassrls = false`**, exercising the explicit server-only RLS policies. Browser roles remain denied. No Supabase service or provider verification is inferred from this result.

- Node22.23.4, npm10.9.9, Next16.4.5, exact dependencies+lockfile. npm audit after targeted minimatch fix: **0 vulnerabilities** (8 earlier moderate dev-tool warnings resolved).
- Final `npm run check`: **passed** — strict typecheck, lint (no warnings/errors), 14 unit tests, production build including Proxy and all routes. `git diff --check`: passed (Windows line-ending notices only).
- `npm test`: **14/14 passed** — HMAC/scopes/expiry/raw binary, strict event variants/inputs/evidence, valid PDF/DOCX plus hostile ZIP traversal/bomb/duplicate/macros/XML/external-link rejection, byte bounds, safe Meet host, Cairo DST.
- `npm run test:postgres`: **15/15 passed** on native PostgreSQL17, applying **both actual migrations** to a temporary isolated DB. Minimal auth/users and storage/buckets test schemas are **not real Supabase services**. Includes submission race/replay, separate immutable CVs, cross-application run FK, stale forms, Gmail dedupe/assignment, immutable/stale analysis, invitation dedupe, uncertain send reconciliation, slot race, expiry/revocation, revisions/reservations/reminder cancellation, overlap exclusion, human hold racing booking, receiver outage/two-worker/lease recovery.
- Real browser: login/recovery navigation and accessible headings/labels observed. At **360×800**, login submit showed busy → explicit setup error → enabled retry button; login and Jobs setup DOM width345px within viewport360px (no horizontal overflow). At **1280×900**, workspace setup visually checked. Temporary viewport reset. Initial navigation timed out then loaded. **No authenticated recruiting journey completed.** No public apply/booking keyboard journey or LCP/CLS/INP measurements.
- Full Supabase unavailable: Docker daemon access denied; elevated Docker request declined. Supabase CLI3.0.0 installed/help/version checked. No hosted service or fabricated .env.local. Real Auth/Storage, smoke and Supabase identity/API tests **not run**.

## Milestones

| Milestone                | Implemented                                                                                                   | Actual acceptance                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1 Foundation/first slice | Auth/recovery, jobs, validated private upload, transactional application, scoped CV, migration/bootstrap/seed | SQL passes; full Supabase/browser **blocked**             |
| 2 Review/WF01            | Gmail/assignment, immutable snapshots, evidence/history, retry/reanalysis, signed endpoints/simulator/outbox  | Boundary+DB passes; real HTTP simulator cycle **not run** |
| 3 Decisions/WF02         | Hold/reject/invite, atomic intent, claim/result/recovery/audit                                                | DB passes; Gmail/full HTTP **unverified**                 |
| 4 Booking/WF03/04        | Signed links, atomic reservations, revision sync, reschedule/cancel/reminders                                 | DB races/revisions pass; provider/browser **unverified**  |
| 5 Quality/handoff        | Validation/contract/smoke/performance/ops scripts and docs                                                    | Partial checks above; remaining acceptance below          |

## Requirements to evidence

| ID    | Route/test/check                                                                | Actual status                                                                             |
| ----- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| FR01  | /login,/recover,/api/auth/*,proxy; native membership tests; test:db suite       | DB membership verified; Supabase Auth/recovery/session **not run**                        |
| FR02  | /jobs,/jobs/new,/jobs/[id]; saveJob; closed-form/version DB tests               | DB verified; browser **blocked**                                                          |
| FR03  | /apply/[jobCode],/api/uploads,/api/applications; bounded-body/idempotency tests | Boundary+DB verified; Storage HTTP **not run**                                            |
| FR04  | internal/attachments,intake/gmail,assign-job; Gmail DB tests                    | Dedupe/assignment verified; attachment HTTP/live Gmail **unverified**                     |
| FR05  | /candidates,/applications/[id]; context/result/retry/reanalyse                  | Snapshot/IDs/evidence schemas verified; populated UI **not run**                          |
| FR06  | hold/reject/invite,notification claim/result/recover                            | DB dedupe/uncertainty verified; external delivery **unverified**                          |
| FR07  | /book/[token],booking slots,interviews/book                                     | DB race/replay/expiry/revocation verified; browser **not run**                            |
| FR08  | /interviews,sync callbacks,reminders                                            | DB revisions/reservations/reminders verified; Calendar/Meet/sends **unverified**          |
| SEC01 | RLS/grants/private bucket,no browser RPC; native role tests,test:db             | Native table grants verified; real REST/Storage/Auth **blocked**                          |
| SEC02 | uploads.ts + valid PDF/DOCX and hostile ZIP/PDF unit tests,scanner gate         | Structure/size checks verified locally; malware scanner **unconfigured/unverified**      |
| SEC03 | Server secrets,private read/fresh5min URL,synthetic files                       | Implementation+smoke supplied; Storage access **unverified**                              |
| SEC04 | strict Zod,Origin,shared DB limits,no-store/security headers                    | Unit boundaries verified; HTTP abuse/CSRF/rate **not run**                                |
| SEC05 | signing.ts,scoped internal routes,stale-run tests                               | Unit+DB verified; real workflow HTTP **not run**                                          |
| SEC06 | Signed versioned tokens,revocation,append-only audit,local retention            | Booking/audit DB verified; cleanup **not run**, hosted audit retention/privacy unresolved |
| NFR01 | Outbox/leases/dispatcher; outage/two-worker/expired-lease test                  | **Verified locally SQL+HTTP receiver harness**; simulator/Supabase cycle not run          |
| NFR02 | Exclusion/reservations/claims/revisions; race/reconcile tests                   | **DB verified locally**; external reconciliation unverified                               |
| NFR03 | perf:seed,perf,perf -- --public                                                 | **Not run**:100/10k,20 clients,1m+5m; targets not claimed                                 |
| NFR04 | Bounded pool/worker,pagination,indexes                                          | Two workers verified; large-data query plans/load **not run**                             |
| NFR05 | Responsive CSS,labels/focus,browser login/recovery/setup                        | Desktop + 360px setup/error states verified; tablet/keyboard apply+book/lab+field metrics **not run** |
| NFR06 | Health/ready/operations,recovery,cleanup,backup procedure                       | Queue DB recovery verified; DB+objects backup restore **not run**                         |

## Next exact actions and external dependencies

Owned dev server stopped after browser QA; native SQL test cluster is stopped after checks. Test databases were dropped by the harness; ignored local cluster files remain for reproducibility. No .env.local or hosted credentials were fabricated.

1. Make Docker Linux engine accessible; `npm run db:start`, `npm run setup:local`, `npm run bootstrap`, `npm run seed`. Start web,worker,simulator. Docker permission was declined and has not been bypassed.
2. `npm run test:db`, `npm run smoke`, then actual browser journeys in README; fix Supabase-specific findings before accepting milestone1.
3. Production-load/query-plan checks, mobile keyboard journeys+lab metrics, synthetic DB+private-object backup/restore.
4. Operating malware scanner; owner-approved retention/privacy/audit policy and hosted cleanup job. Native SQL harness is not a Supabase/production substitute.
5. Teammate: approved test Gmail mailbox/send identity, Gemini/OCR,Calendar/Meet/free-busy/reconciliation. All real integrations **unverified**. No production publication or real-person messages sent.
