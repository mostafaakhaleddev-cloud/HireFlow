# Dedicated hosted Supabase verification

Status: **real hosted infrastructure and HTTP cycle verified**. `.env.local` is ignored/untracked. Admin PostgreSQL uses verify-full + the Supabase CA; plan inspection found an empty application schema/history, then both migrations were applied transactionally with CLI-compatible history. Restricted NOINHERIT hireflow_web is active and denied auth.users; no superuser/BYPASSRLS/CREATEROLE. Private bucket and signup-disabled setting verified. Synthetic test Admin provisioned without mail. 5/5 hosted identity/API tests, smoke cycle, and 8 grouped HTTP race/recovery checks passed. No production publication or actual Gmail/Gemini/Calendar calls. Browser automation stopped on an external Edge URL-verification guard; the full browser journey remains unverified. See STATUS.md for remaining acceptance. Docker is not required.

## Secure configuration

Put secrets directly in ignored `.env.local` on the operator machine; do not paste them into chat, shell arguments, browser code or commits:

- `STAGING_PROJECT_REF`: the exact 20-character dedicated test project reference, not a production project.
- `SUPABASE_URL`: `https://<ref>.supabase.co`.
- `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: project API keys; only server-side use.
- `DATABASE_URL`: restricted runtime login, direct or **session** pooler, `sslmode=verify-full`; use `sslrootcert` for the project CA if needed. Pooler username must bind to the selected reference, e.g. `hireflow_web.<ref>`; direct host must be `db.<ref>.supabase.co`.
- `STAGING_ADMIN_DATABASE_URL`: separate migration/operator connection to that same reference, verified TLS. Never substitute it for runtime DATABASE_URL to make a failing permission test pass.
- Optional `SUPABASE_ACCESS_TOKEN`: project-scoped management/CLI access for project selection/Auth settings/migrations. A management token does not replace runtime API keys or the DB password.

If the restricted runtime login does not exist yet, provide the operator connection and project reference first; inspect existing roles/history before creating it. The runtime role must have no superuser/BYPASSRLS/CREATEROLE privileges, must be unable to read auth.users, and may SET ROLE only to the application's `hireflow_backend` as authorized. Do not run the native destructive harness against staging.

```powershell
npm run setup:staging
npm run staging:inspect
```

Setup preserves supplied secrets and fills missing local integration keys/password with random values without printing them. It generates three canonical synthetic PDFs under ignored test-results. Inspect is read-only: current role/TLS, real managed schema presence, migration versions, existing public tables, grants/RLS, bucket metadata and Auth signup setting. No Auth/Storage stubs, resets or schema drops.

## Apply infrastructure only after inspection

Inspect official migration history and existing application tables before applying the two migrations. Use the connected Supabase migration capability or the authenticated CLI after checking its help. CLI 3.0.0 defaults to local; hosted targets require explicit `--remote=<project-ref>`. For CLI, first `migration list --remote=<ref>`, then `db push --remote=<ref> --dry-run --skip-vault`; apply only the reviewed pending application migrations without seed/reset. Provide secrets through secure environment/credential storage, never password/URL arguments. If history and tables disagree, stop and reconcile deliberately instead of rerunning CREATE TABLE or altering history blindly.

Verify the role grant and explicit backend-only RLS policies, no anon/authenticated table privileges, and private candidate-cvs bucket (5 MiB, PDF/DOCX). Preserve all Supabase-managed Auth/Storage schemas and existing data. A restricted runtime account must pass business reads/writes while actual anon/nonmember/disabled/HR/Admin clients fail direct protected REST/Storage/RPC access as intended.

Hosted Auth does not read local config.toml. Inspect/update through Management API or dashboard: Site URL `http://127.0.0.1:3000`, exact recovery callback `http://127.0.0.1:3000/auth/callback` plus required password-reset redirect, signup disabled, approved email settings. No messages to real people. Local web uses HttpOnly/SameSite session cookies, verified Auth user and current membership checks.

## Synthetic fixture gate and test staff

`STAGING_SYNTHETIC_ONLY=true` + exact project binding + loopback web + simulator mode is required by staging test commands. General `ALLOW_SYNTHETIC_UNSCANNED=true` remains forbidden for hosted Supabase. Until a scanner is configured, staging accepts **only exact bytes** of the three generated PDFs; other files are rejected. This is a synthetic verification path, not malware-scanner verification or permission for real CVs. Contact fields must also use synthetic names and @example.test addresses during all testing.

```powershell
npm run staging:bootstrap
npm run dev
# Separate terminals, same ignored environment:
npm run simulator
npm run worker
# After inspection/migrations/bootstrap and services:
npm run test:db
npm run smoke
```

Staging bootstrap creates a new synthetic, confirmed Auth user and admin membership without sending email. It never resets/promotes an existing identity. Access the test account via BOOTSTRAP_EMAIL/PASSWORD in ignored .env.local, not chat. The original local bootstrap/seed/reset guards remain unchanged.

Use test-results/synthetic-cv-v1.pdf and v2.pdf in the actual browser. Follow the README acceptance journey, then reschedule/cancel, Gmail assignment, scoped callback/replay/uncertainty/outage checks. Refresh and session-renewal checks are required. Existing local seed/performance/retention/backup commands must not have their guards removed to run remotely; prepare dedicated isolated staging workloads and restore destination after the target and quotas are known.

Not yet run: hosted inspection/migrations/Auth/bucket/role verification, populated browser journey, staging API/HTTP race/failure checks, isolated DB+objects restore, bounded 100/10k benchmark, lab metrics. Real Gemini/Gmail/Calendar remain teammate-owned and separate from simulated outcomes.

Connection guidance: [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [verified TLS and project certificate](https://supabase.com/docs/guides/database/psql). These instructions are preparation, not evidence that this project has connected.
