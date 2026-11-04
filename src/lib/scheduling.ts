import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { config } from "./config";
import { audit, lock, query, transaction } from "./db";
import { staffTransaction } from "./auth";
import {
  bookSchema,
  decisionSchema,
  inviteSchema,
  slotSchema,
  notificationResultSchema,
  syncResultSchema,
} from "./contracts";
import { invariant } from "./errors";
import { digest, signBooking, verifyBooking } from "./signing";
import { outbox } from "./domain";

export async function decide(
  actor: string,
  id: string,
  decision: "hold" | "rejected",
  raw: unknown,
  requestId: string,
) {
  const p = decisionSchema.parse(raw);
  return staffTransaction(actor, async (db) => {
    const app = (
      await db.query("select * from applications where id=$1 for update", [id])
    ).rows[0];
    invariant(app, "NOT_FOUND", "Application not found.", 404);
    invariant(app.job_id, "JOB_REQUIRED", "Assign this application first.");
    const active = (
      await db.query(
        "select id from interviews where application_id=$1 and state<>'cancelled'",
        [id],
      )
    ).rows[0];
    invariant(
      !active,
      "ACTIVE_INTERVIEW",
      "Cancel and reconcile the active interview before changing this decision.",
    );
    if (app.review_status === decision) return { status: decision };
    await db.query("update applications set review_status=$2 where id=$1", [
      id,
      decision,
    ]);
    await db.query(
      "update invitations set revoked_at=now() where application_id=$1 and revoked_at is null",
      [id],
    );
    await db.query(
      "update notifications set state=case when state='sending' then 'unknown' else 'cancelled' end where application_id=$1 and type='invitation' and state in ('pending','failed','sending')",
      [id],
    );
    await audit(db, actor, "review." + decision, id, requestId, {
      reason: p.reason,
    });
    return { status: decision };
  });
}
export async function invite(
  actor: string,
  id: string,
  raw: unknown,
  requestId: string,
) {
  const p = inviteSchema.parse(raw);
  return staffTransaction(actor, async (db) => {
    const app = (
      await db.query("select * from applications where id=$1 for update", [id])
    ).rows[0];
    invariant(app, "NOT_FOUND", "Application not found.", 404);
    const old = (
      await db.query(
        "select * from invitations where application_id=$1 and revoked_at is null for update",
        [id],
      )
    ).rows[0];
    if (old && app.review_status === "interview_approved") {
      invariant(
        old.interviewer_id === p.interviewer_id && old.reason === p.reason,
        "INVITATION_CONFLICT",
        "The current approval uses a different interviewer or reason. Revoke it first.",
      );
      return {
        invitation_id: old.id,
        status: "interview_approved",
        duplicate: true,
      };
    }
    invariant(
      app.job_id &&
        !app.contact_ambiguous &&
        ["completed", "needs_manual_review"].includes(app.processing_status),
      "REVIEW_REQUIRED",
      "Review the processed application before approving an interview.",
    );
    const interviewer = (
      await db.query(
        "select * from staff where id=$1 and active=true for share",
        [p.interviewer_id],
      )
    ).rows[0];
    invariant(
      interviewer && interviewer.calendar_id,
      "INTERVIEWER_REQUIRED",
      "Choose an active interviewer with a configured calendar.",
    );
    const invitationId = randomUUID(),
      notificationId = randomUUID(),
      eventId = randomUUID();
    await db.query(
      "insert into invitations(id,application_id,interviewer_id,approved_by,reason,expires_at) values($1,$2,$3,$4,$5,now()+make_interval(hours=>$6))",
      [
        invitationId,
        id,
        p.interviewer_id,
        actor,
        p.reason,
        config().INVITATION_TTL_HOURS,
      ],
    );
    await db.query(
      "update applications set review_status='interview_approved' where id=$1",
      [id],
    );
    await db.query(
      "insert into notifications(id,application_id,invitation_id,type,dedupe_key) values($1,$2,$3,'invitation',$4)",
      [notificationId, id, invitationId, "invite:" + invitationId],
    );
    await outbox(db, {
      schema_version: 1,
      event_id: eventId,
      event_type: "interview.invitation_requested",
      application_id: id,
      notification_id: notificationId,
    });
    await audit(db, actor, "review.interview_approved", id, requestId, {
      invitation_id: invitationId,
      interviewer_id: p.interviewer_id,
      reason: p.reason,
    });
    return {
      invitation_id: invitationId,
      status: "interview_approved",
      duplicate: false,
    };
  });
}
export async function publishSlot(
  actor: string,
  raw: unknown,
  requestId: string,
) {
  const p = slotSchema.parse(raw);
  invariant(
    new Date(p.starts_at).getTime() > Date.now() + 60000,
    "PAST_SLOT",
    "Choose a slot at least one minute in the future.",
    400,
  );
  return staffTransaction(actor, async (db) => {
    const staff = (
      await db.query(
        "select * from staff where id=$1 and active=true for share",
        [p.interviewer_id],
      )
    ).rows[0];
    invariant(
      staff?.calendar_id,
      "INTERVIEWER_REQUIRED",
      "Interviewer needs an active membership and calendar.",
    );
    const slot = (
      await db.query(
        "insert into interviewer_slots(interviewer_id,starts_at,ends_at,timezone) values($1,$2,$2::timestamptz+interval '30 minutes',$3) returning id",
        [p.interviewer_id, p.starts_at, p.timezone],
      )
    ).rows[0];
    await audit(db, actor, "slot.published", slot.id, requestId);
    return slot;
  });
}
async function validInvitation(
  db: PoolClient,
  token: string,
  forUpdate = false,
) {
  const capability = verifyBooking(token, config().BOOKING_SIGNING_KEY);
  const inv = (
    await db.query(
      `select v.*,a.review_status,s.active as interviewer_active from invitations v join applications a on a.id=v.application_id join staff s on s.id=v.interviewer_id where v.id=$1 ${forUpdate ? "for update of v" : ""}`,
      [capability.id],
    )
  ).rows[0];
  invariant(
    inv &&
      inv.version === capability.v &&
      !inv.revoked_at &&
      !inv.consumed_at &&
      new Date(inv.expires_at) > new Date() &&
      inv.review_status === "interview_approved" &&
      inv.interviewer_active,
    "INVALID_LINK",
    "This booking link has expired, was used, or is no longer available.",
    410,
  );
  return inv;
}
export async function bookingSlots(token: string) {
  return transaction(async (db) => {
    const inv = await validInvitation(db, token);
    const { rows } = await db.query(
      `select s.id,s.starts_at,s.ends_at,s.timezone from interviewer_slots s where s.interviewer_id=$1 and s.starts_at>now()+interval '1 minute' and not exists(select 1 from reservations r where r.slot_id=s.id) order by s.starts_at,s.id limit 100`,
      [inv.interviewer_id],
    );
    return {
      slots: rows,
      expires_at: inv.expires_at,
      timezone: "Africa/Cairo",
    };
  });
}
async function syncEvent(
  db: PoolClient,
  interview: {
    id: string;
    application_id: string;
    schedule_revision: number;
    sync_operation: "create" | "reschedule" | "cancel";
  },
  eventId: string,
) {
  await outbox(db, {
    schema_version: 1,
    event_id: eventId,
    event_type: "interview.sync_requested",
    interview_id: interview.id,
    application_id: interview.application_id,
    revision: interview.schedule_revision,
    operation: interview.sync_operation,
  });
}
export async function book(raw: unknown, requestId: string) {
  const p = bookSchema.parse(raw),
    capability = verifyBooking(p.token, config().BOOKING_SIGNING_KEY),
    hash = digest(JSON.stringify(p));
  return transaction(async (db) => {
    await lock(db, "booking:" + p.idempotency_key);
    const old = (
      await db.query("select * from interviews where booking_key=$1", [
        p.idempotency_key,
      ])
    ).rows[0];
    if (old) {
      invariant(
        old.booking_hash === hash && old.invitation_id === capability.id,
        "KEY_REUSED",
        "Booking key was used with different data.",
      );
      return { receipt: old.receipt, status: old.state };
    }
    const inv = await validInvitation(db, p.token, true);
    const slot = (
      await db.query(
        "select * from interviewer_slots where id=$1 and interviewer_id=$2 and starts_at>now()+interval '1 minute' for update",
        [p.slot_id, inv.interviewer_id],
      )
    ).rows[0];
    invariant(
      slot,
      "SLOT_UNAVAILABLE",
      "This slot is no longer available. Please choose another.",
    );
    const reserved = (
      await db.query("select id from reservations where slot_id=$1", [slot.id])
    ).rows[0];
    invariant(
      !reserved,
      "SLOT_UNAVAILABLE",
      "Someone just booked this slot. Please choose another.",
    );
    const id = randomUUID(),
      eventId = randomUUID(),
      providerId = "hf" + id.replaceAll("-", "");
    const interview = (
      await db.query(
        `insert into interviews(id,application_id,invitation_id,interviewer_id,slot_id,booking_key,booking_hash,starts_at,ends_at,timezone,state,sync_operation,sync_event_id,provider_event_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'calendar_pending','create',$11,$12) returning *`,
        [
          id,
          inv.application_id,
          inv.id,
          inv.interviewer_id,
          slot.id,
          p.idempotency_key,
          hash,
          slot.starts_at,
          slot.ends_at,
          slot.timezone,
          eventId,
          providerId,
        ],
      )
    ).rows[0];
    await db.query(
      "insert into reservations(interview_id,slot_id,interviewer_id,starts_at,ends_at) values($1,$2,$3,$4,$5)",
      [id, slot.id, inv.interviewer_id, slot.starts_at, slot.ends_at],
    );
    await db.query("update invitations set consumed_at=now() where id=$1", [
      inv.id,
    ]);
    await syncEvent(db, interview, eventId);
    await audit(db, "booking-capability", "interview.reserved", id, requestId);
    return { receipt: interview.receipt, status: "calendar_pending" };
  });
}
async function notificationEligible(
  db: PoolClient,
  n: Record<string, unknown>,
) {
  if (n.type === "invitation") {
    const inv = (
      await db.query(
        `select v.*,a.submitted_name,a.submitted_email,a.review_status from invitations v join applications a on a.id=v.application_id where v.id=$1 for share of v,a`,
        [n.invitation_id],
      )
    ).rows[0];
    invariant(
      inv &&
        !inv.revoked_at &&
        !inv.consumed_at &&
        new Date(inv.expires_at) > new Date() &&
        inv.review_status === "interview_approved",
      "NOTIFICATION_INELIGIBLE",
      "This invitation is no longer eligible for delivery.",
      410,
    );
    return {
      recipient: inv.submitted_email,
      name: inv.submitted_name,
      booking_url:
        config().APP_URL +
        "/book/" +
        signBooking(inv, config().BOOKING_SIGNING_KEY),
      expires_at: inv.expires_at,
    };
  }
  const interview = (
    await db.query(
      `select i.*,a.submitted_name,a.submitted_email from interviews i join applications a on a.id=i.application_id where i.id=$1 for share of i`,
      [n.interview_id],
    )
  ).rows[0];
  invariant(
    interview &&
      interview.state === "confirmed" &&
      interview.schedule_revision === n.schedule_revision &&
      new Date(interview.starts_at) > new Date(),
    "NOTIFICATION_INELIGIBLE",
    "Appointment changed or was cancelled.",
    410,
  );
  return {
    recipient: interview.submitted_email,
    name: interview.submitted_name,
    starts_at: interview.starts_at,
    timezone: interview.timezone,
    meet_url: interview.meet_url,
  };
}
export async function claimNotification(
  id: string,
  workflow: string,
  requestId: string,
) {
  return transaction(async (db) => {
    const n = (
      await db.query("select * from notifications where id=$1 for update", [id])
    ).rows[0];
    invariant(n, "NOT_FOUND", "Notification not found.", 404);
    invariant(
      (n.type === "invitation" && workflow === "wf02") ||
        (n.type !== "invitation" && workflow === "wf04"),
      "WORKFLOW_SCOPE",
      "Workflow cannot send this notification.",
      403,
    );
    if (n.state === "sent" || n.state === "cancelled")
      return { status: n.state };
    if (n.state === "sending" && new Date(n.lease_until) < new Date()) {
      await db.query(
        "update notifications set state='unknown',safe_error='SEND_LEASE_EXPIRED' where id=$1",
        [id],
      );
      return { status: "unknown", requires_reconciliation: true };
    }
    invariant(
      n.state === "pending",
      "DELIVERY_STATE",
      "Delivery is already claimed or requires staff reconciliation.",
    );
    const context = await notificationEligible(db, n),
      claim = randomUUID();
    await db.query(
      "update notifications set state='sending',claim_id=$2,lease_until=now()+interval '2 minutes',attempts=attempts+1,result_hash=null where id=$1",
      [id, claim],
    );
    await audit(db, workflow, "notification.claimed", id, requestId);
    return {
      schema_version: 1,
      status: "claimed",
      notification_id: id,
      claim_id: claim,
      type: n.type,
      dedupe_key: n.dedupe_key,
      template: context,
    };
  });
}
export async function notificationResult(
  id: string,
  raw: unknown,
  workflow: string,
  requestId: string,
) {
  const p = notificationResultSchema.parse(raw),
    hash = digest(JSON.stringify(p));
  return transaction(async (db) => {
    const n = (
      await db.query("select * from notifications where id=$1 for update", [id])
    ).rows[0];
    invariant(n, "NOT_FOUND", "Notification not found.", 404);
    invariant(
      (n.type === "invitation" && workflow === "wf02") ||
        (n.type !== "invitation" && workflow === "wf04"),
      "WORKFLOW_SCOPE",
      "Workflow scope mismatch.",
      403,
    );
    invariant(
      n.claim_id === p.claim_id,
      "CLAIM_SCOPE",
      "Claim does not belong to this notification.",
      403,
    );
    if (n.result_hash) {
      invariant(
        n.result_hash === hash,
        "RESULT_CONFLICT",
        "Delivery already has a different outcome.",
      );
      return { status: n.state, duplicate: true };
    }
    invariant(
      ["sending", "unknown"].includes(n.state),
      "DELIVERY_STATE",
      "Notification cannot accept this result.",
    );
    // A late result may record a real send after revocation. It grants no booking rights.
    await db.query(
      "update notifications set state=$2,provider_id=$3,safe_error=$4,result_hash=$5,sent_at=case when $2='sent' then now() else null end where id=$1",
      [id, p.outcome, p.provider_id || null, p.error_code || null, hash],
    );
    await audit(db, workflow, "notification.result", id, requestId, {
      outcome: p.outcome,
    });
    return { status: p.outcome };
  });
}
export async function recoverNotification(
  actor: string,
  id: string,
  raw: unknown,
  requestId: string,
) {
  const p = z
    .object({
      outcome: z.enum([
        "retry_failed",
        "reconciled_sent",
        "reconciled_not_sent",
      ]),
      reason: z.string().min(10).max(1000),
      provider_id: z
        .string()
        .regex(/^[a-zA-Z0-9_:@.\-]{1,250}$/)
        .optional(),
    })
    .strict()
    .parse(raw);
  return staffTransaction(actor, async (db) => {
    const n = (
      await db.query("select * from notifications where id=$1 for update", [id])
    ).rows[0];
    invariant(n, "NOT_FOUND", "Notification not found.", 404);
    if (p.outcome === "retry_failed")
      invariant(
        n.state === "failed",
        "DELIVERY_STATE",
        "Only a known failed send can be retried.",
      );
    else
      invariant(
        n.state === "unknown",
        "DELIVERY_STATE",
        "Only an uncertain send can be reconciled.",
      );
    if (p.outcome === "reconciled_sent") {
      invariant(
        p.provider_id,
        "PROVIDER_ID_REQUIRED",
        "Reconciliation requires the verified provider message ID.",
        400,
      );
      await db.query(
        "update notifications set state='sent',provider_id=$2,sent_at=now(),reconciled_by=$3 where id=$1",
        [id, p.provider_id, actor],
      );
    } else {
      await notificationEligible(db, n);
      await db.query(
        "update notifications set state='pending',claim_id=null,lease_until=null,result_hash=null,safe_error=null,reconciled_by=$2 where id=$1",
        [id, actor],
      );
      if (n.type === "invitation")
        await outbox(db, {
          schema_version: 1,
          event_id: randomUUID(),
          event_type: "interview.invitation_requested",
          application_id: n.application_id,
          notification_id: id,
        });
    }
    await audit(db, actor, "notification.reconciled", id, requestId, {
      outcome: p.outcome,
      reason: p.reason,
    });
    return { status: "recorded" };
  });
}
export async function syncContext(
  id: string,
  revision: number,
  eventId: string,
) {
  const row = (
    await query(
      `select i.*,s.display_name as interviewer_name,s.calendar_id,a.submitted_name,a.submitted_email,ns.starts_at as pending_starts_at,ns.ends_at as pending_ends_at,ns.timezone as pending_timezone from interviews i join staff s on s.id=i.interviewer_id join applications a on a.id=i.application_id left join interviewer_slots ns on ns.id=i.pending_slot_id where i.id=$1`,
      [id],
    )
  ).rows[0];
  invariant(row, "NOT_FOUND", "Interview not found.", 404);
  invariant(
    row.schedule_revision === revision && row.sync_event_id === eventId,
    "STALE_REVISION",
    "This sync request has been superseded.",
  );
  invariant(
    row.state !== "cancelled",
    "INTERVIEW_CANCELLED",
    "Appointment is cancelled.",
    410,
  );
  return {
    schema_version: 1,
    interview_id: id,
    revision,
    operation: row.sync_operation,
    event_id: row.sync_event_id,
    provider_event_id: row.provider_event_id,
    calendar_id: row.calendar_id,
    interviewer_name: row.interviewer_name,
    recipient: row.submitted_email,
    candidate_name: row.submitted_name,
    starts_at: row.pending_starts_at || row.starts_at,
    ends_at: row.pending_ends_at || row.ends_at,
    timezone: row.pending_timezone || row.timezone,
    previous_starts_at: row.starts_at,
    reconcile_before_retry: true,
    require_free_busy_check: row.sync_operation !== "cancel",
  };
}
export function safeMeetUrl(value: string | undefined) {
  if (!value) return null;
  const url = new URL(value);
  invariant(
    url.protocol === "https:" &&
      url.hostname === "meet.google.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url.pathname) &&
      !url.search &&
      !url.hash,
    "INVALID_MEET_URL",
    "Invalid Meet URL.",
    400,
  );
  return url.toString();
}
export async function syncResult(id: string, raw: unknown, requestId: string) {
  const p = syncResultSchema.parse(raw),
    hash = digest(JSON.stringify(p)),
    meet = safeMeetUrl(p.meet_url);
  return transaction(async (db) => {
    const i = (
      await db.query("select * from interviews where id=$1 for update", [id])
    ).rows[0];
    invariant(i, "NOT_FOUND", "Interview not found.", 404);
    invariant(
      i.schedule_revision === p.revision &&
        i.sync_event_id === p.event_id &&
        i.sync_operation === p.operation,
      "STALE_REVISION",
      "This calendar result is stale.",
    );
    invariant(
      i.provider_event_id === p.provider_event_id,
      "PROVIDER_SCOPE",
      "Provider event ID must match the stable reserved ID.",
      403,
    );
    const staff = (
      await db.query("select calendar_id from staff where id=$1", [
        i.interviewer_id,
      ])
    ).rows[0];
    invariant(
      staff.calendar_id === p.calendar_id,
      "CALENDAR_SCOPE",
      "Calendar does not match the interviewer.",
      403,
    );
    if (i.last_result_hash === hash)
      return { status: i.state, duplicate: true };
    invariant(
      !["confirmed", "cancelled"].includes(i.state),
      "RESULT_CONFLICT",
      "A definitive calendar result is already recorded.",
    );
    invariant(
      (p.operation === "cancel" && p.outcome !== "confirmed") ||
        (p.operation !== "cancel" && p.outcome !== "cancelled"),
      "INVALID_OUTCOME",
      "Outcome does not match the operation.",
      400,
    );
    let state = "sync_failed";
    if (p.outcome === "unknown") state = "sync_unknown";
    if (p.outcome === "cancelled") {
      state = "cancelled";
      await db.query("delete from reservations where interview_id=$1", [id]);
    } else if (p.outcome === "confirmed") {
      state = "confirmed";
      if (i.pending_slot_id) {
        const slot = (
          await db.query("select * from interviewer_slots where id=$1", [
            i.pending_slot_id,
          ])
        ).rows[0];
        await db.query(
          "delete from reservations where interview_id=$1 and slot_id<>$2",
          [id, slot.id],
        );
        await db.query(
          "update interviews set slot_id=$2,pending_slot_id=null,starts_at=$3,ends_at=$4,timezone=$5 where id=$1",
          [id, slot.id, slot.starts_at, slot.ends_at, slot.timezone],
        );
      }
    }
    // Failed/uncertain changes retain all reservations until reconciled.
    await db.query(
      "update interviews set state=$2,provider_calendar_id=$3,meet_url=coalesce($4,meet_url),last_result_hash=$5,last_error=$6,updated_at=now() where id=$1",
      [id, state, p.calendar_id, meet, hash, p.error_code || null],
    );
    await audit(db, "wf03", "interview.sync_result", id, requestId, {
      revision: p.revision,
      outcome: p.outcome,
    });
    return { status: state };
  });
}
export async function changeInterview(
  actor: string,
  id: string,
  action: "cancel" | "reschedule" | "retry-sync",
  raw: unknown,
  requestId: string,
) {
  const p =
    action === "reschedule"
      ? z
          .object({ slot_id: z.uuid(), reason: z.string().min(3).max(1000) })
          .strict()
          .parse(raw)
      : z
          .object({ reason: z.string().min(3).max(1000) })
          .strict()
          .parse(raw);
  return staffTransaction(actor, async (db) => {
    const i = (
      await db.query("select * from interviews where id=$1 for update", [id])
    ).rows[0];
    invariant(
      i && i.state !== "cancelled",
      "NOT_ACTIVE",
      "Interview is not active.",
      409,
    );
    if (action === "retry-sync") {
      invariant(
        ["sync_failed", "sync_unknown"].includes(i.state),
        "SYNC_STATE",
        "Only failed or uncertain syncs can be reconciled.",
      );
      await db.query(
        "update integration_events set state='pending',attempts=0,available_at=now(),lease_until=null,lease_id=null where id=$1",
        [i.sync_event_id],
      );
      await audit(
        db,
        actor,
        "interview.sync_reconciliation_requested",
        id,
        requestId,
        { reason: p.reason },
      );
      return { status: i.state };
    }
    if (action === "cancel" && i.sync_operation === "cancel")
      return { status: i.state };
    if (action === "reschedule") {
      invariant(
        i.state === "confirmed",
        "SYNC_STATE",
        "Reconcile the current appointment before rescheduling.",
      );
      const slot = (
        await db.query(
          "select * from interviewer_slots where id=$1 and interviewer_id=$2 and starts_at>now()+interval '1 minute' for update",
          [(p as unknown as { slot_id: string }).slot_id, i.interviewer_id],
        )
      ).rows[0];
      invariant(
        slot && slot.id !== i.slot_id,
        "SLOT_UNAVAILABLE",
        "Choose a different available slot.",
      );
      await db.query(
        "insert into reservations(interview_id,slot_id,interviewer_id,starts_at,ends_at) values($1,$2,$3,$4,$5)",
        [id, slot.id, i.interviewer_id, slot.starts_at, slot.ends_at],
      );
      await db.query("update interviews set pending_slot_id=$2 where id=$1", [
        id,
        slot.id,
      ]);
    }
    const revision = i.schedule_revision + 1,
      eventId = randomUUID();
    await db.query(
      "update interviews set state=$2,schedule_revision=$3,sync_operation=$4,sync_event_id=$5,last_result_hash=null,last_error=null,updated_at=now() where id=$1",
      [
        id,
        action === "cancel" ? "cancel_pending" : "reschedule_pending",
        revision,
        action,
        eventId,
      ],
    );
    await db.query(
      "update notifications set state=case when state='sending' then 'unknown' else 'cancelled' end where interview_id=$1 and state in ('pending','failed','sending')",
      [id],
    );
    if (action === "cancel")
      await db.query("update invitations set revoked_at=now() where id=$1", [
        i.invitation_id,
      ]);
    await syncEvent(
      db,
      { ...i, schedule_revision: revision, sync_operation: action },
      eventId,
    );
    await audit(db, actor, "interview." + action, id, requestId, {
      revision,
      reason: p.reason,
    });
    return { status: action + "_pending" };
  });
}
export async function dueReminders(requestId: string) {
  return transaction(async (db) => {
    const { rows } = await db.query(
      `select i.* from interviews i where state='confirmed' and ((starts_at>now()+interval '23 hours 30 minutes' and starts_at<=now()+interval '24 hours') or (starts_at>now()+interval '30 minutes' and starts_at<=now()+interval '1 hour')) order by starts_at limit 100 for update skip locked`,
    );
    const ids: string[] = [];
    for (const i of rows) {
      const ms = new Date(i.starts_at).getTime() - Date.now();
      // Each reminder is eligible in a 30 minute window before its target.
      const types: ("reminder_24h" | "reminder_1h")[] = [];
      if (ms <= 24 * 3600000 && ms > 23.5 * 3600000) types.push("reminder_24h");
      if (ms <= 3600000 && ms > 1800000) types.push("reminder_1h");
      for (const type of types) {
        const result = await db.query(
          `insert into notifications(application_id,interview_id,schedule_revision,type,dedupe_key) values($1,$2,$3,$4,$5) on conflict(dedupe_key) do nothing returning id`,
          [
            i.application_id,
            i.id,
            i.schedule_revision,
            type,
            `${i.id}:${i.schedule_revision}:${type}`,
          ],
        );
        if (result.rows[0]) {
          ids.push(result.rows[0].id);
          await audit(
            db,
            "wf04",
            "reminder.intent_created",
            result.rows[0].id,
            requestId,
            { revision: i.schedule_revision },
          );
        }
      }
    }
    // Return pending IDs only. A separate claim immediately before sending rechecks cancellation.
    const pending = await db.query(
      "select id from notifications where type<>'invitation' and state='pending' order by created_at limit 100",
    );
    return {
      schema_version: 1,
      notification_ids: pending.rows.map((n) => n.id),
    };
  });
}
