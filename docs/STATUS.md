# HireFlow — actual evidence

Updated 2026-11-04 UTC. The hosted staging project is now connected. **Full deliverable acceptance remains incomplete:** HTTP flow is verified, populated browser/mobile acceptance and operational/performance checks remain outstanding.

## Verified this continuation

- `.env.local` exists, is ignored/untracked, and values were not printed. Project/role claims and actual Supabase Auth endpoints validated the legacy API keys. Runtime credentials and integration/test passwords were generated locally and saved only in this ignored file.
- Admin connection uses `sslmode=verify-full` + the public Supabase CA (`supabase/certificates/prod-ca-2021.crt`). No TLS verification bypass. pg_stat_ssl reported false for the provider pooler→DB backend leg; do not mistake client certificate/hostname verification for proof of provider upstream encryption.
- Read-only plan found empty application tables/history. Applied **202611040001 / 202611040002** in one transaction with CLI-compatible migration history; no reset/drop or replacement of real Auth/Storage schemas.
- Created NOINHERIT `hireflow_web`, only membership in NOLOGIN `hireflow_backend`. Real runtime has no superuser/BYPASSRLS/CREATEROLE and is denied auth.users. Backend explicit RLS policies active on all 15 application tables; no anon/authenticated grants; audit only SELECT/INSERT for backend.
- Verified real private candidate-cvs bucket, 5 MiB PDF/DOCX limits. Verified **disable_signup=true** after owner changes. Site URL/redirect configuration was owner-reported; callback recovery still requires its own acceptance check.
- Created synthetic confirmed staff Admin without mail. Secure access: BOOTSTRAP_EMAIL/PASSWORD in ignored .env.local. App/worker/simulator running on loopback. Synthetic file gate permits only exact generated PDFs until scanning is configured.
- `npm run test:db`: **5/5 passed on hosted Supabase**, using actual anonymous/nonmember/disabled/HR/Admin identities and restricted runtime transactions.
- `npm run smoke`: **passed**: real sign-in, job, private file exact byte identity, idempotent application, signed analysis context/result, saved human invite/replay, booking receipt/replay, **simulated** Calendar confirmation, unmatched Gmail intake/dedupe/assignment/analysis.
- `npm run staging:contracts`: **8 grouped HTTP checks passed**: simultaneous submission replays; two CVs for one internal person; payload/key/handle/closed-form/protected-field negatives; swapped/stale signed analysis; duplicate approval + uncertain-send recovery; competing bookings/receipt/expired/revoked links; failed reschedule holds/reconciliation; reminder invalidation/cancellation/stale callbacks. Sanitized evidence in ignored test-results/staging-contract-checks.json.
- Final `npm run check`: **passed** — strict TypeScript, lint, **18/18 unit tests**, production build. `git diff --check` passed (line-ending notices only). Scan of production/development browser JS/maps found **no configured server secrets**.

## Browser boundary / current handoff

Owner confirmed successful sign-in to Jobs in an external Edge window. The agent's in-app localhost tab remained at login. Selecting the external Edge window caused Computer Use to stop because it could not determine its current URL confidently enough to enforce policy. No further browser input attempted. **Agent has not verified the populated browser journey.** Resume in an authenticated in-app browser tab or a browser connection exposing verified URLs. Local URL: http://127.0.0.1:3000/jobs.

A transient automatic-approval reviewer usage failure initially prevented staging:plan; the same normally reviewed command later succeeded, followed by authorized apply. That earlier review failure is resolved and is not the present blocker.

## Requirements → evidence

| ID | Actual evidence | Status / remaining limits |
|---|---|---|
| FR01 | Real Auth sign-in; 5-identity API tests; current membership/role denials; signup disabled | Hosted HTTP verified; owner observed Jobs login; agent browser/recovery/session-renewal acceptance still incomplete |
| FR02 | HTTP create/edit/version/close/reopen and stale-form rejection in staging:contracts | Hosted HTTP verified; populated Jobs controls/browser copy-link not yet verified |
| FR03 | Real private upload/download bytes + idempotent simultaneous submissions; bad handles/fields/files rejected | Hosted PDF HTTP verified; mobile/keyboard upload still not run; DOCX structure unit-tested |
| FR04 | WF01 attachment+Gmail fixture dedupe, unmatched assignment and completed analysis through signed HTTP | Hosted web contract + simulated extraction verified; live Gmail/OCR unverified |
| FR05 | Separate application CVs; immutable requirements/reanalysis; swapped/stale results rejected; evidence callbacks complete | Hosted HTTP/data verified; populated candidate evidence UI not agent-verified |
| FR06 | Concurrent approval → one intent; delivery unknown blocks blind retry; explicit recovery succeeds | Hosted HTTP + simulated provider behavior verified; live send/reconciliation unverified |
| FR07 | Competing HTTP bookings → one reservation; receipt replay; expired/revoked link denial | Hosted atomic flow verified; real browser booking not run |
| FR08 | Simulated create/reschedule failure/retry/cancel; held reservations and revisions/reminder invalidation checked | Hosted HTTP + simulated provider behavior verified; live Calendar/free-busy/Meet/reminder send unverified |
| SEC01 | Restricted runtime, RLS/grants; actual browser identities denied REST/private Storage/API; self-promotion403 | Hosted boundaries verified in stated tests; dedicated direct-RPC negative still not run |
| SEC02 | Unit valid PDF/DOCX + hostile ZIP/PDF; HTTP size/type negatives; exact fixture gate | Verified stated checks; real malware scanner unconfigured/unverified |
| SEC03 | Private bucket/byte-specific reads; fresh context access; ignored env; browser bundle secret scan | Hosted file/secrets checks passed; real-data launch remains gated |
| SEC04 | Origin403, strict fields, bounded bytes; DB-shared rate limiter implementation | Stated hosted negatives passed; rate-limit workload and full public accessibility not run |
| SEC05 | Unit HMAC/raw bytes/expiry/scope; actual unsigned/wrong-scope/swapped-run/stale callbacks rejected | Hosted signed contract verified; live teammate endpoints not connected |
| SEC06 | Signed scoped links, expiry/revocation, append-only audit grants, revision-bound booking | Hosted links verified; retention cleanup execution and owner audit/privacy policy unresolved |
| NFR01 | Real web→worker→simulator→signed callback completes; prior native outage/two-worker/lease tests15/15 | Hosted happy path verified; actual hosted receiver-stop/worker-kill recovery still not run |
| NFR02 | Real HTTP booking race, unknown send/reconcile, failed reschedule holds, stale callbacks/reminders | Hosted DB/HTTP + simulated uncertainty verified; external provider reconciliation unverified |
| NFR03 | Bounded benchmark scripts supplied | 100 jobs/10k applications/20 clients/60s+300s **not run**; p50/p95/error targets not claimed |
| NFR04 | Bounded runtime pool/worker, indexed/paginated lists; prior native two-worker checks | Hosted large dataset/query plans and scale metrics not run |
| NFR05 | Prior login/setup 360px/1280px observations; current manual login user-reported | Populated desktop/tablet/mobile/keyboard apply+book and LCP/CLS/INP not run |
| NFR06 | Readiness/operations and recovery controls; hosted reconciliation scenarios passed | Isolated DB+private-object backup/restore not run; operations documentation supplied |

## Next actions

1. Resume the actual browser journey in a URL-verifiable authenticated browser: create/copy/apply/refresh/download/evidence/invite/book/confirmed/reschedule/cancel, plus Gmail assignment. User retains credentials privately in .env.local.
2. Verify recovery callback and session renewal; actual receiver outage and worker lease restart; dedicated RPC/rate-limit negatives.
3. Provide/configure an isolated restore target; complete synthetic DB+object backup/restore. Run bounded performance dataset/workloads/query plans and lab mobile metrics under stated profiles/quotas.
4. Owner decisions: retention/privacy/audit redaction and operating malware scanner. Teammate: approved test Gmail identity/mailbox, Gemini/OCR, Calendar/Meet/free-busy and external uncertainty reconciliation. **No live provider or production readiness claim.**

## Reproducible commands

Existing .env.local is already configured. Keep its credentials private. Three terminals: `npm run dev`, `npm run simulator`, `npm run worker`. Checks: `npm run test:db`, `npm run smoke`, `npm run staging:contracts`, `npm run check`. Review STAGING.md before operator commands; local reset/native destructive harness remain local-only. All new fixture data is synthetic; no real applicant messages or public publication performed.
