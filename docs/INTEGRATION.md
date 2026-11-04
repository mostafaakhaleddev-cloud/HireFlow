# HireFlow HTTP contract v1

The web owns persistence, authorization, human decisions and booking. n8n owns extraction/delivery/provider calls. The separate simulator uses the same HTTP contracts; it does not replace Supabase. No real provider is verified live. See STATUS.md.

## Configuration and ownership

Hosted continuation has an explicit dedicated-project path in STAGING.md (`setup:staging`, `staging:inspect`, `staging:bootstrap`). Docker is unnecessary. Real hosted Auth/PostgreSQL/private Storage passed the smoke and HTTP concurrency/recovery cycle; provider results are **simulated**, never live verification. New server/operator fields: STAGING_PROJECT_REF, STAGING_SYNTHETIC_ONLY, STAGING_ADMIN_DATABASE_URL and optional SUPABASE_ACCESS_TOKEN. General unscanned uploads remain forbidden against hosted Supabase; the explicit staging mode accepts only the three exact synthetic PDF fixtures until a scanner is available. Runtime and migration connections stay separate; inspection verified no runtime superuser/BYPASSRLS/CREATEROLE and actual auth.users denial. Run `npm run test:db`, `npm run smoke` and `npm run staging:contracts` with web/worker/simulator running. The contract checks use synthetic records only; uncertain-send and Calendar reconciliation checks do not prove actual provider behavior.

`.env.example` contains names only. No public client environment variables. Local setup writes ignored `.env.local` from local Supabase status + random secrets.

| Variable                                         | Owner / use                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| APP_URL                                          | Web: exact canonical origin; loopback locally, HTTPS in staging                                  |
| SUPABASE_URL / SUPABASE_ANON_KEY                 | Web: verified Auth via Supabase SSR                                                              |
| SUPABASE_SERVICE_ROLE_KEY                        | Web/operator only: private Storage; **never n8n**                                                |
| DATABASE_URL                                     | Web/operator: bounded PG pool; dedicated login granted hireflow_backend in staging, verified TLS |
| INTEGRATION_MODE                                 | Web: simulator/live; labels only, same persistence/business logic                                |
| N8N_WEBHOOK_BASE_URL                             | Teammate: receiver origin; simulator http://127.0.0.1:4001; hosted HTTPS                         |
| WEB_TO_N8N_SECRET                                | Dispatcher → receiver only, random ≥32 chars                                                     |
| WF01_KEY / WF02_KEY / WF03_KEY / WF04_KEY        | Web + only corresponding workflow; separate HMAC keys ≥32 chars                                  |
| BOOKING_SIGNING_KEY                              | Web only: versioned booking capability                                                           |
| UPLOAD_MAX_BYTES                                 | Web: default/max 5242880                                                                         |
| INVITATION_TTL_HOURS                             | Web: default 48, 1–168                                                                           |
| TRUST_PROXY                                      | Operator: false by default; true only behind a proxy replacing untrusted forwarded IP headers    |
| SCANNER_URL                                      | Operator: trusted scanner adapter; TLS except loopback; see Operations                           |
| ALLOW_SYNTHETIC_UNSCANNED                        | Web: false default; true only loopback and synthetic data                                        |
| BOOTSTRAP_EMAIL / BOOTSTRAP_PASSWORD             | Local operator only, synthetic staff                                                             |
| RETENTION_DAYS                                   | Client/operator decision; no default; execute local cleanup only                                 |
| PROVISION_ADMIN_EMAIL / PROVISION_ADMIN_PASSWORD | Admin operator sign-in for staff:provision; server-only, never workflow/client                   |
| BENCH_URL                                        | Local benchmark driver only, optional trusted test proxy origin; never deployed                  |

Distinct secrets per environment. Rotation: pause dispatcher, reconcile in-flight sends, update each scoped key at both web and its workflow, restart and re-sign retries with fresh timestamps while keeping IDs. Key IDs currently `wf01`–`wf04`; coordinated cutover, no dual-key grace period. Rotate booking key deliberately: old links invalidate; revoke/reissue invitations. Rotate service role via Supabase and restart web; never send it to n8n.

## Authentication

Hosted transport requires TLS. Cookie/public writes require `Origin` exactly APP_URL (script clients too). No permissive CORS. Internal routes use HMAC, no cookie or browser call.

Web → n8n: `X-HireFlow-Secret` checked in constant time. Event JSON includes `schema_version:1` and IDs only:

| Event                                                | Receiver suffix                        | Fields besides version/type                                                          |
| ---------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| application.created / application.analysis_requested | /webhook/hireflow/application-created  | event_id, application_id, analysis_run_id, job_id, source                            |
| interview.invitation_requested                       | /webhook/hireflow/invitation-requested | event_id, application_id, notification_id                                            |
| interview.sync_requested                             | /webhook/hireflow/interview-sync       | event_id, application_id, interview_id, revision, operation=create/reschedule/cancel |

No CV/contact/token/signed URL in outbox. Return 2xx only after durable acceptance; acknowledgement is separate from completion. Local simulator performs callbacks before acknowledgement so failures retry.

n8n → web headers: `X-HireFlow-Key-Id` (`wf01`…`wf04`), `X-HireFlow-Timestamp` (10-digit Unix seconds), `X-HireFlow-Signature` (lowercase hex HMAC-SHA256). Sign UTF-8 with LF and **no final newline**:

```text
<timestamp>
<UPPERCASE method>
<canonical pathname + query>
<lowercase hex SHA256 of exact raw body bytes>
```

Canonical query uses WHATWG URL, `searchParams.sort()` then `.toString()` (including `+` spaces). No trailing `?` for empty query. Path is the encoded WHATWG pathname. GET hashes empty bytes. Sign JSON after serialization; whitespace matters. Binary attachment signing hashes original bytes, not UTF-8 text. ±300s clock skew, constant-time comparison. New signature per retry, same business IDs. Working implementation: `src/lib/signing.ts`, `scripts/client.ts`.

```ts
const body = JSON.stringify(payload);
const path = `/api/internal/applications/${applicationId}/analysis-result`;
const headers = signRequest("wf01", process.env.WF01_KEY!, "POST", path, body);
await fetch(process.env.APP_URL + path, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body,
});
```

WF01 cannot change review decisions or call WF02/03/04 routes. A valid HMAC still needs matching path IDs, active run/event/snapshot version, notification claim, interview/revision and operation.

## Canonical routes

For Unicode filenames, percent-encode `X-File-Name` using `encodeURIComponent`; web decodes it before validation. Simple ASCII fixture filenames work unchanged. Staff provisioning without sending mail is available through the admin-authenticated `npm run staff:provision` command; see STAFF.md. Hosted provisioning and invitation password setup remain unverified.

`docs/contracts/openapi.json`, individual schemas and fixtures are machine-readable. Shared Zod schemas are strict; extra fields rejected. Evidence and DB relationships also need server refinements beyond JSON Schema.

| Route                                                                   | Contract and observable behavior                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /api/uploads?job_code=JOB-BE-001                                   | Public raw PDF/DOCX, exact MIME + X-File-Name, same Origin. Bounded bytes + structure + scan, opaque private storage. Returns upload_handle/expiry. Binds one job, 30min, single consume. Node hosting must accept 5 MiB.                                                                                                                       |
| POST /api/applications                                                  | application.schema.json: submitted contact, consent true, privacy_version=2026-11-v1, upload_handle, UUID idempotency_key. Atomic application/snapshot/run/outbox. Returns only receipt/status=received; no AI wait.                                                                                                                            |
| POST /api/internal/attachments                                          | WF01 signed raw file, same verifier/scanner/private bucket. Returns Gmail-purpose handle. Never accept arbitrary attachment URLs/object paths.                                                                                                                                                                                                  |
| POST /api/internal/intake/gmail                                         | WF01 gmail_intake schema: mailbox/message/attachment IDs, subject, candidate contact/ambiguity, handle. Exact one valid open [JOB-CODE] matches; missing/ambiguous/unusable → assignment. Ambiguous contact → manual review; no analysis/invite. No invented consent. Web exclusively owns analysis dispatch. Returns application_id/duplicate. |
| GET /api/internal/applications/{id}/analysis-context?run_id=UUID        | WF01: immutable job_snapshot, run/event/application IDs, status, cv.url with expires_in_seconds=300. Checks run belongs to application and active run. Queued→processing. Fetch CV promptly, never log URL/text.                                                                                                                                |
| POST /api/internal/applications/{id}/analysis-result                    | WF01 analysis_result schema. completed/manual/retryable/final outcomes. Completed requires each snapshot skill exactly once; positive text + cv_page_N/docx_section_N/docx_paragraph_N source. Unsupported years null/UNVERIFIED. Strict output excludes traits/scores/rankings/decisions. Stale IDs/version conflicts. Exact replay succeeds.  |
| POST /api/internal/notifications/{id}/claim                             | WF02 invitation / WF04 reminder; {schema_version:1}. Atomic pending→sending; 2min claim_id, dedupe_key, authorized template/recipient. Invite booking_url only after human approval. Sent/cancelled returns status without recipient/token; concurrent claim 409; expired lease→unknown.                                                        |
| POST /api/internal/notifications/{id}/result                            | Matching WF02/04. notification_result schema; claim_id, sent/failed/unknown; provider_id required if sent. Old claims denied; exact replay succeeds. Possible delivery timeout must be unknown, never failed.                                                                                                                                   |
| GET /api/booking/{token}/slots                                          | Does not consume token. Only eligible future slots for bound interviewer. Explicit IANA timezone and expiry. Expired/revoked/used/invalid returns 410.                                                                                                                                                                                          |
| POST /api/interviews/book                                               | booking schema: token, slot_id, idempotency_key. Atomic invitation/slot locks + reservation/interview/outbox + consume. Returns own receipt/calendar_pending, 409 slot conflict. Same successful operation recovers receipt even after link expiry.                                                                                             |
| GET /api/internal/interviews/{id}/sync-context?event_id=UUID&revision=N | WF03: bound operation/revision/stable provider ID, authorized calendar/interviewer/recipient, proposed/previous UTC instants and IANA timezone. Requires free/busy and reconciliation before retries.                                                                                                                                           |
| POST /api/internal/interviews/{id}/sync-result                          | WF03 calendar_result schema. Stable provider ID + configured calendar match; confirmed/cancelled/failed/unknown. Safe HTTPS meet.google.com/aaa-bbbb-ccc only. Revision checks; exact repeat success. Unknown/failed may reconcile to definitive; definitive result cannot be rewritten.                                                        |
| POST /api/internal/reminders/claim                                      | WF04 {schema_version:1}, every15–30min. Creates/dedupes due 24h/1h intents and returns notification_ids. Claim each ID through notification endpoint immediately before send; rechecks cancellation/revision/confirmed state.                                                                                                                   |

Staff routes: POST `/api/jobs[/{id}]`; `/api/applications/{id}/assign-job`, `/retry-analysis`, `/reanalyse`, `/hold`, `/reject`, `/invite`; GET `/api/applications/{id}/cv`; POST `/api/slots`, `/api/interviews/{id}/reschedule`, `/cancel`, `/retry-sync`; `/api/notifications/{id}/recover`. Active membership on every action. Hold/reject require reason; invite reason+interviewer, reviewed processing and unambiguous contact. Cancel/reconcile an active interview before changing its approval. Admin GET/POST `/api/staff` changes existing role/active only, self-change blocked. Provisioning uses reviewed operator Auth Admin + membership insert; local runnable command is bootstrap.

## Idempotency, states and retries

| Operation     | Durable scope / lifetime                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Public submit | submission UUID + parsed payload hash, retained with application. Original successful receipt lookup before consuming upload again. |
| Gmail         | hash of JSON [mailbox_id,message_id,attachment_id] + parsed payload hash, retained with application                                 |
| Analysis      | application + active run + event + snapshot version + result hash, retained with run; reanalysis preserves prior runs               |
| Invitation    | one unrevoked per application + unique invite:UUID notification; replay same approval succeeds, changed approval data conflicts     |
| Send          | notification dedupe_key + claim UUID + result hash, retained with notification                                                      |
| Booking       | booking UUID + token/slot hash, retained with interview; one reservation per slot/capability                                        |
| Calendar      | interview + revision + event + operation + stable provider ID; current revision only                                                |
| Reminder      | interview + revision + reminder type, retained with notification                                                                    |

Key reuse with different payload→409. Retention removes receipts too; do not retry deleted operations. Tokens sign invitation ID/version, database checks decision, interviewer, expiry, revocation and consumption. No reusable plaintext token is persisted. Signed URLs/tokens must be redacted by hosting proxies; Next incoming request logging is disabled.

Central rules are in domain.ts/scheduling.ts. Processing queued→processing→completed/manual/failed; only active run updates current state. Retry failed_retryable reuses snapshot/event. Explicit reanalysis creates new run. Human review awaiting_review/hold/rejected/interview_approved is independent. Decision approval atomically creates notification. Delivery pending→sending→sent/failed/unknown; unknown needs reconciliation. Scheduling calendar_pending/confirmed/reschedule_pending/cancel_pending/sync_failed/sync_unknown/cancelled uses revision-bound callbacks. Cancelled cannot reopen from stale callback.

Dispatcher: 4 concurrent, DB SKIP LOCKED claims, 60s lease, 8s HTTP timeout, 8 attempts, exponential backoff capped900s + jitter. Same event ID after crash. Acknowledged is not workflow-completed. Processing >30min or exhausted event→failed_retryable. Exhausted events retained for operator replay.

Invitation send: provider dedupe marker + actual provider ID. Possible send→unknown; HR must query provider sent records/logs before reconciled_sent (verified ID) or reconciled_not_sent (proof) permits recovery. No blind resends. Simulator demonstrates contracts only; real Gmail reconciliation unverified.

Calendar: stable Google-compatible ID `hf` + UUID without hyphens. **Check external free/busy** independently of DB slots. Timeout→GET/reconcile stable event ID before retries, never a new random ID. Keep reservations on uncertainty/failure. Reschedule holds old+new until confirmation; cancel holds until confirmed deletion. Old callbacks409. Provider conflict must remain actionable, not silently release a slot.

Reminder windows:24h→23.5h and1h→0.5h. Prefer15min schedule. A missed window does not auto-send late. Send already released before cancellation can race; no new claim passes after invalidation. Minimize claim→send delay.

## Errors

`{error:{code,message,request_id,retryable,fields?}}`. 400 invalid/schema/evidence;401 session/signature;403 membership/workflow/origin/scope;404 missing;409 state/slot/key/run/revision;410 capability;413 bytes;415 file/type/structure/scan rejection;429 shared rate limit with Retry-After:60;503 missing setup/dependency/unavailable. No SQL/CV/provider detail leakage. Retry429/5xx boundedly; resolve400/403/409/410. External send/calendar transport failure may be uncertain: reconcile first.

## Teammate live wiring

1. WF01: approved recruitment mailbox/label; download Gmail bytes, signed attachment upload, metadata intake. Conservative forwarded-contact handling. Use web-dispatched run, fetch context, Gemini extraction/OCR fallback, restrict result to schema/snapshot; CV text is untrusted data. No protected traits/decisions/scores.
2. WF02: approved Gmail send identity and approved test recipient. Claim, send template with supplied URL/dedupe marker, report actual ID. Prove failure and uncertain delivery reconciliation before staging retries.
3. WF03: approved interviewer Calendar/Meet account and authorized calendar_id. Free/busy, stable event/conference dedupe, timeout/conflict reconciliation, bound revision callback. External availability is separate from DB availability.
4. WF04: every15min pull IDs, claim immediately before send, versioned dedupe + delivery result; test cancel/reschedule between pull and claim.
5. Run local smoke first, then approved private staging checks. Web needs no Gemini/OpenAI key or Gmail/Calendar OAuth. Real messages/publication need separate owner instruction. No provider has been verified live here.
