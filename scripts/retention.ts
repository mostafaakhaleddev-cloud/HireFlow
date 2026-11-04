import { pool, query, transaction, audit } from "../src/lib/db";
import { storageClient } from "../src/lib/auth";
import { config, isLoopback } from "../src/lib/config";
import { randomUUID } from "node:crypto";
const c = config(),
  days = Number(process.env.RETENTION_DAYS);
if (!Number.isInteger(days) || days < 1)
  throw new Error(
    "RETENTION_DAYS requires an owner-approved positive day count. No deletion performed.",
  );
if (!process.argv.includes("--execute")) {
  const result = await query(
    "select count(*)::int as eligible from applications where created_at<now()-make_interval(days=>$1) and review_status='rejected'",
    [days],
  );
  console.log(JSON.stringify({ mode: "dry_run", ...result.rows[0], days }));
  await pool().end();
  process.exit(0);
}
// Live policy approval is an operator responsibility. The shipped command refuses hosted deletion.
if (!isLoopback(c.APP_URL) || !isLoopback(c.SUPABASE_URL))
  throw new Error(
    "This cleanup command is local-only. Implement approved hosted retention through a reviewed operator job.",
  );
await transaction(async (db) => {
  const expired = await db.query(
    `select a.id,a.cv_upload_id,u.object_path from applications a join uploads u on u.id=a.cv_upload_id where a.review_status='rejected' and a.created_at<now()-make_interval(days=>$1) and not exists(select 1 from interviews i where i.application_id=a.id and state<>'cancelled') limit 100 for update of a skip locked`,
    [days],
  );
  for (const a of expired.rows) {
    await db.query(
      "insert into cleanup_jobs(object_path) values($1) on conflict do nothing",
      [a.object_path],
    );
    await db.query("update applications set active_run_id=null where id=$1", [
      a.id,
    ]);
    await db.query(
      "delete from integration_events where payload->>'application_id'=$1",
      [a.id],
    );
    await db.query("delete from applications where id=$1", [a.id]);
    await db.query("delete from uploads where id=$1", [a.cv_upload_id]);
    // Audit (including review reasons) is append-only. Hosted retention/redaction
    // requires an approved owner policy; this local command does not claim that policy.
    await audit(
      db,
      "retention-operator",
      "application.deleted",
      a.id,
      randomUUID(),
    );
  }
  const abandoned = await db.query(
    "select id,object_path from uploads where consumed_at is null and expires_at<now() limit 100 for update skip locked",
  );
  for (const u of abandoned.rows) {
    await db.query(
      "insert into cleanup_jobs(object_path) values($1) on conflict do nothing",
      [u.object_path],
    );
    await db.query("delete from uploads where id=$1", [u.id]);
  }
  await db.query(
    "delete from candidates c where not exists(select 1 from applications a where a.candidate_id=c.id)",
  );
  await db.query(
    "delete from rate_limits where window_start<now()-interval '1 day'",
  );
});
const pending = await query(
  "select id,object_path from cleanup_jobs where done_at is null and attempts<10 order by created_at limit 100",
);
for (const item of pending.rows) {
  const { error } = await storageClient()
    .storage.from("candidate-cvs")
    .remove([item.object_path]);
  await query(
    "update cleanup_jobs set attempts=attempts+1,done_at=case when $2 then now() else null end,safe_error=case when $2 then null else 'STORAGE_CLEANUP_FAILED' end where id=$1",
    [item.id, !error],
  );
}
console.log(
  JSON.stringify({
    mode: "executed_local",
    cleanup_attempts: pending.rowCount,
  }),
);
await pool().end();
