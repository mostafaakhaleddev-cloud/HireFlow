import { randomUUID } from "node:crypto";
import { config } from "./config";
import { transaction, query } from "./db";
import type { IntegrationEvent } from "./contracts";

export function webhookPath(type: IntegrationEvent["event_type"]) {
  return type.startsWith("application.")
    ? "/webhook/hireflow/application-created"
    : type === "interview.invitation_requested"
      ? "/webhook/hireflow/invitation-requested"
      : "/webhook/hireflow/interview-sync";
}
export async function dispatchBatch() {
  const lease = randomUUID();
  const events = await transaction(async (db) => {
    await db.query(
      "update integration_events set state='exhausted',safe_error='RETRIES_EXHAUSTED' where attempts>=8 and (state='pending' or (state='leased' and lease_until<now()))",
    );
    const { rows } = await db.query(
      `with ready as (select id from integration_events where attempts<8 and available_at<=now() and (state='pending' or (state='leased' and lease_until<now())) order by available_at,created_at limit 4 for update skip locked)
      update integration_events e set state='leased',lease_id=$1,lease_until=now()+interval '60 seconds',attempts=e.attempts+1 from ready where e.id=ready.id returning e.*`,
      [lease],
    );
    return rows;
  });
  await Promise.all(
    events.map(async (event) => {
      const c = config();
      try {
        const response = await fetch(
          new URL(webhookPath(event.event_type), c.N8N_WEBHOOK_BASE_URL),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-HireFlow-Secret": c.WEB_TO_N8N_SECRET,
            },
            body: JSON.stringify(event.payload),
            signal: AbortSignal.timeout(8000),
            redirect: "error",
          },
        );
        if (!response.ok) throw new Error("WEBHOOK_REJECTED");
        await query(
          "update integration_events set state='acknowledged',acknowledged_at=now(),lease_until=null,safe_error=null where id=$1 and lease_id=$2 and state='leased'",
          [event.id, lease],
        );
      } catch {
        const delay =
          Math.min(900, 2 ** event.attempts * 3) + Math.random() * 5;
        await query(
          "update integration_events set state=case when attempts>=8 then 'exhausted' else 'pending' end,available_at=now()+make_interval(secs=>$3),lease_until=null,safe_error='WEBHOOK_UNAVAILABLE' where id=$1 and lease_id=$2 and state='leased'",
          [event.id, lease, delay],
        );
      }
    }),
  );
  await query(`with stuck as (update analysis_runs r set status='failed_retryable' where r.status in ('queued','processing') and ((r.started_at<now()-interval '30 minutes') or exists(select 1 from integration_events e where e.id=r.event_id and e.state='exhausted')) returning id,application_id)
    update applications a set processing_status='failed_retryable' from stuck s where a.id=s.application_id and a.active_run_id=s.id`);
  await query(
    "update notifications set state='unknown',safe_error='SEND_LEASE_EXPIRED' where state='sending' and lease_until<now()",
  );
  return events.length;
}
