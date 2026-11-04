# Operations and recovery

Procedures are local/synthetic unless reviewed for private staging. STATUS.md records actual results. Configuration does not prove external health.

## Services and security

`npm run dev` (or build + start), `npm run worker` (optional `-- --once`), `npm run simulator`, `npm run db:start`. Migrations in supabase/migrations. db:reset is for a disposable local project only.

`/api/health` minimal configuration status. `/api/ready` checks DB connectivity, returns503 on missing setup/unavailable DB; scanner is configured/unconfigured, **never declared healthy**. Auth/Storage/providers need smoke/integration evidence. Staff `/operations` shows queue depth/oldest timestamp, stuck runs, failed/unknown notifications. Logs contain code/request/event IDs, not URLs/contacts/tokens/CVs/SQL values/provider text. Proxy/platform logs must redact booking paths, signed Storage queries and Auth recovery links.

Pool8 per process; worker concurrency4; statement/HTTP timeout8s; list pagination25, deterministic ordering. Workers coordinate through DB leases. Add a bounded worker only after measured ready-event age persistently exceeds the agreed SLA while DB has headroom. Account for multiplied connection budgets; use Supabase pooling with verified TLS. Large-dataset query plans are not yet verified.

Staging operator must create a dedicated LOGIN role with generated secret and grant only membership in NOLOGIN `hireflow_backend`; use it in DATABASE_URL. Verify it cannot SET ROLE postgres or read auth.users. Never use a hosted superuser for web processes. App switches role only within transactions. Browser identities get no table/RPC/Storage privileges; storage service key stays server-only. Trigger search_path is restricted.

Local bootstrap provisions only synthetic loopback admin and never promotes existing users. Hosted staff provisioning needs reviewed server-side Auth Admin create/invite + membership insert + audit, no shipped reusable password. Existing access uses admin-only `/api/staff`, self-change blocked. Calendar mapping is an operator action.

## Recovery

- Queued: start worker/receiver. State + event remain committed during outage. Same event IDs retry. Acknowledgement differs from completion.
- Stuck processing: worker marks >30min/exhausted-event runs failed_retryable. Application page Retry saved snapshot preserves snapshot/event; Reanalyse explicitly uses current requirements/new run.
- Exhausted event: inspect ID/state and resolve cause, then local `npm run outbox:replay -- UUID`. Original ID requeued; no dedupe bypass.
- Failed invite: HR decision stays saved. Retry known failure after checking provider rejection.
- Unknown send: look up logical dedupe marker in authorized Gmail/provider logs. Record verified provider ID if sent; proof of definite non-send before retry. Time elapsed/restart is not proof. Application page has reconciliation controls. Real provider reconciliation remains unverified.
- Calendar failed/unknown: retain old/proposed reservations, look up stable event ID, request reconciliation from Interviews. WF03 must reconcile before recreate/update/delete; current revision callback may settle uncertain state. Stale callbacks409.
- Cancel: old reminders invalidate immediately; slots stay held until provider confirms deletion. Cancel/reconcile before changing an approved review decision. Unbooked hold/reject revokes link; approve again deliberately for a new invitation.

## Scanning, privacy and cleanup

5MiB maximum; opaque paths, no overwrite, private bucket. Structure validation is **not malware scanning or guaranteed sanitization**. Original files download with nosniff/sandbox. PDF active/encrypted indicators rejected; DOCX checks Office members, total/entry decompression, entry count, duplicates/traversal/encryption, macros/embeddings, XML entities/external relationships. Only local synthetic mode permits no scanner.

Scanner adapter: POST raw bytes to trusted SCANNER_URL with X-Content-SHA256;20s timeout; accept only2xx JSON `{clean:true,sha256:<exact hash>}`. Configure authenticated private adapter to chosen scanner and record clean/blocked fixture evidence before real data. No scanner is currently operating/verified.

RETENTION_DAYS has no default. Client owns duration, lawful basis, privacy wording and justified audit facts. `npm run retention` dry-runs. `-- --execute` only local: old rejected applications without active interview, derived records and orphan internal person lookup are deleted transactionally; file removals use durable cleanup_jobs. Expired unconsumed uploads also queued. Batches100, cleanup max10 attempts retained for operator review. Hosted execution refuses until an approved hosted job exists. Append-only audit **including free-text reasons is retained**; audit retention/redaction remains unresolved. Do not describe this as a verified production deletion policy.

Storage success + DB failure attempts immediate removal. After prolonged outages reconcile bucket inventory against upload references: objects created before failed cleanup may need reviewed orphan removal. Never bulk-delete a live bucket.

## Backup and restore

Back up DB **and private object bytes**, encrypted, with path/MIME/SHA256 manifest. SQL dumps do not contain CV files. Restrict access/retention; backups contain HR data; never Git. In a maintenance window stop writes/dispatcher, settle/reconcile leases, capture DB+object snapshots, resume. External providers require reconciliation after restore before replay.

```powershell
New-Item -ItemType Directory -Path backups -Force
# Use restricted pgpass or set PGPASSWORD outside recorded history.
pg_dump --host=127.0.0.1 --port=54322 --username=postgres --format=custom --file=backups/hireflow.dump postgres
```

Server-side Storage client must list with pagination and download every referenced object, recording digests. Restore into a **separate disposable Supabase project**, create private bucket, upload same paths with upsert:false, then pg_restore --exit-on-error. Verify row counts/FKs/access denials/object digests/application-to-CV mapping, smoke and provider reconciliation. DB+object backup/restore is **not run**; actual configured backup destination/automated restore remains staging work.

## Native SQL harness (optional Windows)

No Docker needed for this separate PG constraint test; auth/storage schemas are stubs, not Supabase services. New test-only data directory; never reuse existing/shared DB:

```powershell
New-Item -ItemType Directory -Path test-results -Force
& 'C:/Program Files/PostgreSQL/17/bin/initdb.exe' -D "$PWD/test-results/pgdata" -U postgres --auth=trust --no-locale --encoding=UTF8
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' -D "$PWD/test-results/pgdata" -l "$PWD/test-results/postgres.log" -o '-p 55432 -h 127.0.0.1' -w start
npm run test:postgres
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' -D "$PWD/test-results/pgdata" -m fast -w stop
```

Loopback trust is strictly for this disposable cluster, with synthetic data only. Harness creates/drops only uniquely named hireflow_test_* DB. In this session initdb succeeded; pg_ctl needed approved execution due sandbox token error. Stop owned services after checks.

## Performance and browser acceptance

Full bounded benchmark, opt-in, worker stopped during seed/measurement:

```powershell
npm run perf:seed
npm run build
npm start
# Separate terminal, one workload at a time:
npm run perf
# For meaningful separate client limits on the local public workload:
# Stop web first. Loopback/synthetic only; never deploy this proxy.
$env:TRUST_PROXY = 'true'
npm start
# Another terminal, with TRUST_PROXY=true as well:
npm run perf:proxy
# Benchmark terminal:
$env:TRUST_PROXY = 'true'
$env:BENCH_URL = 'http://127.0.0.1:3001'
npm run perf -- --public
# Stop proxy/web and remove these process overrides afterward.
```

100 jobs/10k applications and real private synthetic objects;20 clients;60s warmup+300s measured. Staff/public separate; rate limits stay enabled,429 separate. Public finalization starts after bytes saved; transfer/validation separately reported. Fresh rate-limit window; don't disable protection. Report actual counts/sample sizes/p50/p95/unexpected5xx/machine/region. Zero successes cannot meet objectives. Cold start and external provider time not measured by current script. Targets **unverified** without results.

Real Supabase browser journeys still needed: login→job create/edit/status→public apply→refresh→correct CV→evidence→human approve→slot→confirmed, and Gmail→assign→review. Repeat desktop/tablet/360px, keyboard apply/booking, errors/retries/expiry/races. Lighthouse lab LCP/CLS on production public apply under documented mobile profile; field INP only actual field data. Login screenshot/CSS queries are not substitutes.
